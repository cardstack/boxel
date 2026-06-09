import {
  type AffinityType,
  type RenderRouteOptions,
  type ModuleRenderResponse,
  type PrerenderVisitArgs,
  type ReleaseBatchArgs,
  type RenderVisitResponse,
  logger,
  type RunCommandResponse,
  type ScreenshotPrerenderResponse,
} from '@cardstack/runtime-common';
import { BrowserManager } from './browser-manager';
import {
  PagePool,
  StandbyTargetNotReadyError,
  type ConsoleErrorEntry,
} from './page-pool';
import { RenderRunner, type Timings } from './render-runner';
import { isEnvironmentMode, serviceURL } from '../lib/dev-service-registry';
import { toAffinityKey } from './affinity';
import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel';
import { AffinityActivityTracker } from './affinity-activity';
import { AsyncSemaphore } from './async-semaphore';
import {
  type BatchOwner,
  computeBatchClearCacheGate,
} from './batch-ownership-gate';
import {
  AffinitySnapshotSampler,
  type PeakRegistration,
  decorateRenderErrorsWithTimings,
} from './render-settlement';

const log = logger('prerenderer');
const defaultHostURL = isEnvironmentMode()
  ? serviceURL('host')
  : 'https://localhost:4200';
const boxelHostURL = process.env.BOXEL_HOST_URL ?? defaultHostURL;
const DEFAULT_AFFINITY_IDLE_EVICT_MS = 12 * 60 * 60 * 1000;

type PoolMeta = {
  pageId: string;
  affinityType: AffinityType;
  affinityValue: string;
  reused: boolean;
  evicted: boolean;
  timedOut: boolean;
};

export class Prerenderer {
  #stopped = false;
  #browserManager: BrowserManager;
  #pagePool: PagePool;
  #renderRunner: RenderRunner;
  #cleanupInterval: NodeJS.Timeout | undefined;
  // CS-10872: periodic queue-depth snapshot log timer. Quick visibility
  // into fleet health (tabs, per-affinity pending) without chasing an
  // incident. `unref()` so the timer never blocks process exit; cleared
  // on `stop()` for test isolation.
  #queueSnapshotInterval: NodeJS.Timeout | undefined;
  #affinityIdleEvictMs: number;
  #semaphore: AsyncSemaphore;
  #restartInFlight: Promise<void> | null = null;
  // `clearCache` batch ownership (CS-10758 step 3). Maps affinityKey to
  // `{ batchId, since }` for the batch that currently owns the affinity's
  // warm loader. See `#gateClearCache` for the full policy. Populated on
  // any batch'd `clearCache: true` visit and cleared on `releaseBatch`,
  // successor-batch replacement, or affinity disposal.
  #batchOwnership = new Map<string, BatchOwner>();

  // CS-10872 (affinity-snapshot diagnostic): per-affinity tracker of
  // in-flight + queued Prerenderer calls. Populated on every
  // `prerenderVisit` / `prerenderModule` entry and read by
  // `#affinitySnapshotSampler` at render-settle time.
  #affinityActivity = new AffinityActivityTracker();

  // CS-10872 (affinity-snapshot diagnostic): peak-sampling state lives
  // in its own class now — see `render-settlement.ts`. The Prerenderer
  // holds one sampler, registers each `prerenderVisit` / `prerenderModule`
  // with it, and hands the resulting `PeakRegistration` to the method's
  // finally block.
  #affinitySnapshotSampler!: AffinitySnapshotSampler;

  constructor(options: { serverURL: string; maxPages?: number }) {
    let maxPages = options.maxPages ?? 5;
    this.#semaphore = new AsyncSemaphore(maxPages);
    this.#browserManager = new BrowserManager();
    // Local HTTPS dev (vite on https://localhost:4200 with HTTP/2) needs
    // a more generous standby navigation timeout than the 30s default.
    // The host bundle's first cold-start over h2 multiplexes ~1000+
    // module requests through vite's optimizer; on a cold runner the
    // initial `_standby` load can comfortably exceed 30s even though
    // the server is healthy. Configurable via env so production /
    // hosted runners can keep the tighter default.
    let standbyTimeoutMs =
      parseInt(process.env.PRERENDER_STANDBY_TIMEOUT_MS ?? '', 10) || undefined;
    this.#pagePool = new PagePool({
      maxPages,
      serverURL: options.serverURL,
      browserManager: this.#browserManager,
      boxelHostURL,
      renderSemaphore: this.#semaphore,
      ...(standbyTimeoutMs ? { standbyTimeoutMs } : {}),
      onAffinityDisposed: (affinityKey) => {
        // Affinity tear-down implies the warm loader is gone, so any
        // owner entry for that affinity is now meaningless. Clear it
        // proactively so the next batch doesn't inherit a stale owner.
        if (this.#batchOwnership.delete(affinityKey)) {
          log.debug(
            `batch ownership cleared for ${affinityKey} due to affinity disposal`,
          );
        }
      },
    });
    this.#renderRunner = new RenderRunner({
      pagePool: this.#pagePool,
      boxelHostURL,
    });
    this.#affinitySnapshotSampler = new AffinitySnapshotSampler({
      pagePool: this.#pagePool,
      tracker: this.#affinityActivity,
    });
    this.#affinityIdleEvictMs = this.#resolveAffinityIdleEvictMs();
    this.#startCleanupLoop();
    this.#startQueueSnapshotLoop();
    void this.#pagePool.warmStandbys().catch((e) => {
      if (e instanceof StandbyTargetNotReadyError) {
        log.debug(
          'Prerenderer startup skipped standby warmup because the Boxel host target is not ready yet:',
          e,
        );
        return;
      }
      log.warn('Failed to warm standby pages during prerenderer startup:', e);
    });
  }

  set serverURL(url: string) {
    this.#pagePool.serverURL = url;
  }

  getWarmAffinities(): string[] {
    return this.#pagePool.getWarmAffinities();
  }

  getVacancySnapshot(): Record<
    string,
    { idle: boolean; tabCount: number; maxPendingPriority?: number }
  > {
    return this.#pagePool.getVacancySnapshot();
  }

  // CS-10872: richer-than-vacancy snapshot used by prerender-app's
  // periodic fleet-health log line. Kept off the manager heartbeat
  // (operators read this locally) so we don't inflate every heartbeat.
  getQueueDepthSnapshot() {
    return this.#pagePool.getQueueDepthSnapshot();
  }

  // Manager heartbeats should reflect the pool's live tab capacity, not
  // the constructor fallback. Under the dynamic-pool config this value
  // mutates between MIN and MAX as expansion / contraction runs.
  get currentPoolCapacity(): number {
    return this.#pagePool.currentMaxPages;
  }

  // Test-only seam — see PagePool.__test_seedRevokedException.
  __test_seedRevokedException(
    pageId: string,
    entry: ConsoleErrorEntry,
    exceptionId: number,
  ): void {
    this.#pagePool.__test_seedRevokedException(pageId, entry, exceptionId);
  }

  // Test-only seam — see PagePool.__test_poisonPage.
  __test_poisonPage(pageId: string, moduleURL: string): void {
    this.#pagePool.__test_poisonPage(pageId, moduleURL);
  }

  // Test-only seam — see PagePool.__test_clearPoisonedPages.
  __test_clearPoisonedPages(): void {
    this.#pagePool.__test_clearPoisonedPages();
  }

  async stop(): Promise<void> {
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = undefined;
    }
    if (this.#queueSnapshotInterval) {
      clearInterval(this.#queueSnapshotInterval);
      this.#queueSnapshotInterval = undefined;
    }
    this.#affinitySnapshotSampler.shutdown();
    await this.#pagePool.closeAll();
    await this.#browserManager.stop();
    this.#stopped = true;
  }

  async disposeAffinity({
    affinityType,
    affinityValue,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
  }): Promise<void> {
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    this.#renderRunner.clearAuthCache(affinityKey);
    await this.#pagePool.disposeAffinity(affinityKey);
  }

  // Block until the standby pool has reached its desired count. The
  // constructor and `disposeAffinity` both kick refill fire-and-forget;
  // tests that need a fresh tab in their *next* `prerenderVisit` call
  // (rather than racing the kicked refill) await this instead. Wraps
  // `PagePool.warmStandbys`, which dedupes against any in-flight kick.
  async warmStandbys(): Promise<void> {
    await this.#pagePool.warmStandbys();
  }

  // Emit the `render cancelled` log line (format from CS-10872)
  // and, on a `rendering`-state cancel, tear down the affinity so
  // the next request gets a fresh tab rather than one whose
  // Puppeteer ops are still running from the cancelled render.
  // Best-effort: disposal failure is logged but not propagated —
  // the caller already left, there's no response to fail.
  async #handlePrerenderCancel(
    err: PrerenderCancelledError,
    affinityKey: string,
    startedAt: number,
    target: string,
  ): Promise<void> {
    let elapsed = Date.now() - startedAt;
    log.info(
      `render cancelled after ${elapsed}ms in state=${err.state} ` +
        `affinity=${affinityKey} target=${target}`,
    );
    if (err.state === 'rendering') {
      try {
        await this.#pagePool.disposeAffinity(affinityKey);
        this.#renderRunner.clearAuthCache(affinityKey);
      } catch (disposeErr: any) {
        log.warn(
          `failed to dispose affinity ${affinityKey} after cancel: ${
            disposeErr?.message ?? disposeErr
          }`,
        );
      }
    }
  }

  // Release this batch's ownership of an affinity's warm loader (CS-10758
  // step 3). Called from `IndexRunner`'s `finally` blocks and via the
  // `/release-batch` HTTP endpoint. No-ops if the caller isn't the current
  // owner — a successor batch that acquired ownership before the prior
  // batch got around to releasing should not have its ownership cleared.
  async releaseBatch({
    batchId,
    affinityType,
    affinityValue,
  }: ReleaseBatchArgs): Promise<void> {
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    let owner = this.#batchOwnership.get(affinityKey);
    if (owner?.batchId === batchId) {
      this.#batchOwnership.delete(affinityKey);
      log.debug(`batch ${batchId} released ownership of ${affinityKey}`);
    }
  }

  // Read-only observability accessor used by tests. Callers outside of
  // tests should not rely on this shape; it's a debugging surface, not a
  // stable API.
  getBatchOwnership(
    affinityKey: string,
  ): { batchId: string; since: number } | undefined {
    let owner = this.#batchOwnership.get(affinityKey);
    return owner ? { batchId: owner.batchId, since: owner.since } : undefined;
  }

  // Back-compat static re-export: older callers / tests reference
  // `Prerenderer.decorateRenderErrorsWithTimings`. Delegates to the free
  // function in `render-settlement.ts`.
  static decorateRenderErrorsWithTimings = decorateRenderErrorsWithTimings;

  #gateClearCache<
    T extends PrerenderVisitArgs & {
      opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    },
  >(args: T): T {
    let affinityKey = toAffinityKey({
      affinityType: args.affinityType,
      affinityValue: args.affinityValue,
    });
    let owner = this.#batchOwnership.get(affinityKey);
    let decision = computeBatchClearCacheGate(args, owner, Date.now());
    if (decision.newOwner === null) {
      this.#batchOwnership.delete(affinityKey);
    } else if (decision.newOwner) {
      this.#batchOwnership.set(affinityKey, decision.newOwner);
    }
    if (decision.log) {
      if (decision.log.level === 'info') {
        log.info(decision.log.message);
      } else if (decision.log.level === 'warn') {
        log.warn(decision.log.message);
      }
    }
    return decision.gatedArgs as T;
  }

  async prerenderModule({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    opts,
    renderOptions,
    priority,
    signal,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
    // Priority threaded from the producer side. Stamped into
    // `response.meta.diagnostics.priority` for telemetry, and honored
    // by PagePool's tab queue / per-affinity admission semaphore /
    // global render semaphore for priority-aware dequeue.
    priority?: number;
    signal?: AbortSignal;
  }): Promise<{
    response: ModuleRenderResponse;
    timings: Timings;
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    let activity = this.#affinityActivity.record(
      affinityKey,
      url,
      'module',
      'module',
      priority,
    );
    // Declared before the try so the finally releases both even if the
    // register call itself throws synchronously (e.g. setInterval
    // fails under pressure). Without this, `activity` would leak.
    let poller: PeakRegistration | undefined;
    try {
      poller = this.#affinitySnapshotSampler.register(
        affinityKey,
        activity.handle,
      );
      let overallStart = Date.now();
      let attemptOptions = renderOptions;
      let lastResult:
        | {
            response: ModuleRenderResponse;
            timings: Timings;
            pool: PoolMeta;
          }
        | undefined;
      // CS-10872: `totalElapsedMs` must cover only the attempt whose
      // result we return, not earlier retries. Reset the marker at the
      // top of each iteration so launch+render still sums to ~total.
      let attemptStart = Date.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        throwIfAborted(signal);
        attemptStart = Date.now();
        let result: {
          response: ModuleRenderResponse;
          timings: Timings;
          pool: PoolMeta;
        };
        try {
          result = await this.#renderRunner.prerenderModuleAttempt({
            affinityType,
            affinityValue,
            realm,
            url,
            auth,
            opts,
            renderOptions: attemptOptions,
            priority,
            signal,
            onTabAcquired: activity.markRunning,
          });
        } catch (e) {
          // Caller cancelled — log + conditionally evict, then
          // propagate. Don't restart the browser.
          if (e instanceof PrerenderCancelledError) {
            await this.#handlePrerenderCancel(
              e,
              affinityKey,
              overallStart,
              url,
            );
            throw e;
          }
          log.error(
            `module prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
            e,
          );
          await this.#restartBrowser();
          try {
            result = await this.#renderRunner.prerenderModuleAttempt({
              affinityType,
              affinityValue,
              realm,
              url,
              auth,
              opts,
              renderOptions: attemptOptions,
              priority,
              signal,
              onTabAcquired: activity.markRunning,
            });
          } catch (e2) {
            if (e2 instanceof PrerenderCancelledError) {
              await this.#handlePrerenderCancel(
                e2,
                affinityKey,
                overallStart,
                url,
              );
              throw e2;
            }
            log.error(
              `module prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
              e2,
            );
            throw e2;
          }
        }
        lastResult = result;

        let retrySignature = this.#renderRunner.shouldRetryWithClearCache(
          result.response,
        );
        let isClearCacheAttempt = attemptOptions?.clearCache === true;

        if (!isClearCacheAttempt && retrySignature) {
          log.warn(
            `retrying module prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
              ' | ',
            )}`,
          );
          attemptOptions = {
            ...(attemptOptions ?? {}),
            clearCache: true,
          };
          continue;
        }

        if (isClearCacheAttempt && retrySignature && result.response.error) {
          log.warn(
            `module prerender retry with clearCache did not resolve error signature ${retrySignature.join(
              ' | ',
            )} for ${url}`,
          );
        }

        Prerenderer.decorateRenderErrorsWithTimings(
          result.response,
          result.timings,
          Date.now() - attemptStart,
          {
            affinitySnapshot: poller.currentPeak(),
            priority,
            tabReused: result.pool?.reused,
          },
        );
        return result;
      }
      if (lastResult) {
        if (lastResult.response.error) {
          log.error(
            `module prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
          );
        }
        Prerenderer.decorateRenderErrorsWithTimings(
          lastResult.response,
          lastResult.timings,
          Date.now() - attemptStart,
          {
            affinitySnapshot: poller.currentPeak(),
            priority,
            tabReused: lastResult.pool?.reused,
          },
        );
        return lastResult;
      }
      throw new Error(`module prerender attempts exhausted for ${url}`);
    } finally {
      poller?.stop();
      activity.release();
    }
  }

  async runCommand({
    userId,
    auth,
    command,
    commandInput,
    opts,
    priority,
    signal,
  }: {
    userId: string;
    auth: string;
    command: string;
    commandInput?: Record<string, unknown> | null;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    // See prerenderModule for the priority contract.
    priority?: number;
    signal?: AbortSignal;
  }): Promise<{
    response: RunCommandResponse;
    timings: Timings;
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let commandStart = Date.now();
    let affinityKey = toAffinityKey({
      affinityType: 'user',
      affinityValue: userId,
    });
    try {
      let result = await this.#renderRunner.runCommandAttempt({
        affinityType: 'user',
        affinityValue: userId,
        auth,
        command,
        commandInput,
        opts,
        priority,
        signal,
      });
      Prerenderer.decorateRenderErrorsWithTimings(
        result.response,
        result.timings,
        Date.now() - commandStart,
        { priority, tabReused: result.pool?.reused },
      );
      return result;
    } catch (e) {
      if (e instanceof PrerenderCancelledError) {
        await this.#handlePrerenderCancel(
          e,
          affinityKey,
          commandStart,
          command,
        );
        throw e;
      }
      log.error(`command run attempt failed (user ${userId})`, e);
      throw e;
    }
  }

  async prerenderScreenshot({
    realm,
    url,
    auth,
    format,
    priority,
    opts,
    signal,
  }: {
    realm: string;
    url: string;
    auth: string;
    format: 'isolated' | 'embedded';
    priority?: number;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    signal?: AbortSignal;
  }): Promise<{
    response: ScreenshotPrerenderResponse;
    timings: Timings;
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let screenshotStart = Date.now();
    let affinityKey = toAffinityKey({
      affinityType: 'realm',
      affinityValue: realm,
    });
    try {
      let result = await this.#renderRunner.captureScreenshotAttempt({
        affinityType: 'realm',
        affinityValue: realm,
        realm,
        url,
        auth,
        format,
        priority,
        opts,
        signal,
      });
      Prerenderer.decorateRenderErrorsWithTimings(
        result.response,
        result.timings,
        Date.now() - screenshotStart,
      );
      return result;
    } catch (e) {
      if (e instanceof PrerenderCancelledError) {
        await this.#handlePrerenderCancel(e, affinityKey, screenshotStart, url);
        throw e;
      }
      log.error(`screenshot attempt failed (url ${url})`, e);
      throw e;
    }
  }

  async prerenderVisit(
    rawArgs: PrerenderVisitArgs & {
      opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
      signal?: AbortSignal;
      // Test-only hook fired right after a page is acquired and its
      // bucket has been reset. Used by tests that need to seed the
      // bucket via `__test_seedRevokedException` so the seed survives
      // into the merge step. Production callers don't pass this.
      onTabAcquired?: (info: { pageId: string }) => void;
    },
  ): Promise<{
    response: RenderVisitResponse;
    timings: Timings;
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    // Apply batch-ownership gating before the retry loop so the internal
    // retry-with-clearCache (see `retrySignature` handling below) operates
    // on options that have already been through the gate. The retry still
    // works regardless of ownership — it's the external caller's
    // clearCache that's policy-checked, not the server's own recovery.
    let {
      affinityType,
      affinityValue,
      realm,
      url,
      auth,
      renderOptions,
      fileData,
      types,
      opts,
      priority,
      jobId,
    } = this.#gateClearCache(rawArgs);
    let signal = (rawArgs as { signal?: AbortSignal }).signal;
    let testOnTabAcquired = (
      rawArgs as { onTabAcquired?: (info: { pageId: string }) => void }
    ).onTabAcquired;
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
    let activity = this.#affinityActivity.record(
      affinityKey,
      url,
      'visit',
      'file',
      priority,
    );
    let onTabAcquired = (info: { pageId: string }) => {
      activity.markRunning();
      testOnTabAcquired?.(info);
    };
    // See `prerenderModule` — declared before the try so a synchronous
    // throw from `#registerPeakSampling` can't leak the activity entry.
    let poller: PeakRegistration | undefined;
    try {
      poller = this.#affinitySnapshotSampler.register(
        affinityKey,
        activity.handle,
      );
      let overallStart = Date.now();
      let attemptOptions = renderOptions;
      let lastResult:
        | {
            response: RenderVisitResponse;
            timings: Timings;
            pool: PoolMeta;
          }
        | undefined;
      // CS-10872: see prerenderModule for why totalElapsedMs is
      // attempt-local rather than loop-wide.
      let attemptStart = Date.now();
      for (let attempt = 0; attempt < 3; attempt++) {
        throwIfAborted(signal);
        attemptStart = Date.now();
        let result: {
          response: RenderVisitResponse;
          timings: Timings;
          pool: PoolMeta;
        };
        try {
          result = await this.#renderRunner.prerenderVisitAttempt({
            affinityType,
            affinityValue,
            realm,
            url,
            auth,
            opts,
            renderOptions: attemptOptions,
            fileData,
            types,
            priority,
            jobId,
            signal,
            onTabAcquired,
          });
        } catch (e) {
          // Caller cancelled — log + conditionally evict, then
          // propagate. Don't restart the browser.
          if (e instanceof PrerenderCancelledError) {
            await this.#handlePrerenderCancel(
              e,
              affinityKey,
              overallStart,
              url,
            );
            throw e;
          }
          log.error(
            `visit prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
            e,
          );
          await this.#restartBrowser();
          try {
            result = await this.#renderRunner.prerenderVisitAttempt({
              affinityType,
              affinityValue,
              realm,
              url,
              auth,
              opts,
              renderOptions: attemptOptions,
              fileData,
              types,
              priority,
              jobId,
              signal,
              onTabAcquired,
            });
          } catch (e2) {
            if (e2 instanceof PrerenderCancelledError) {
              await this.#handlePrerenderCancel(
                e2,
                affinityKey,
                overallStart,
                url,
              );
              throw e2;
            }
            log.error(
              `visit prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
              e2,
            );
            throw e2;
          }
        }
        lastResult = result;

        // Retry with clearCache if any sub-pass produced a retry-worthy
        // signature. The retry re-runs all requested passes — matches
        // the existing per-call retry semantics.
        let retrySignature = this.#visitRetrySignature(result.response);
        let isClearCacheAttempt = attemptOptions?.clearCache === true;
        if (!isClearCacheAttempt && retrySignature) {
          log.warn(
            `retrying visit prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
              ' | ',
            )}`,
          );
          attemptOptions = {
            ...(attemptOptions ?? {}),
            clearCache: true,
          };
          continue;
        }
        if (isClearCacheAttempt && retrySignature) {
          log.warn(
            `visit prerender retry with clearCache did not resolve error signature ${retrySignature.join(
              ' | ',
            )} for ${url}`,
          );
        }
        Prerenderer.decorateRenderErrorsWithTimings(
          result.response,
          result.timings,
          Date.now() - attemptStart,
          {
            affinitySnapshot: poller.currentPeak(),
            priority,
            tabReused: result.pool?.reused,
          },
        );
        return result;
      }
      if (lastResult) {
        Prerenderer.decorateRenderErrorsWithTimings(
          lastResult.response,
          lastResult.timings,
          Date.now() - attemptStart,
          {
            affinitySnapshot: poller.currentPeak(),
            priority,
            tabReused: lastResult.pool?.reused,
          },
        );
        return lastResult;
      }
      throw new Error(`visit prerender attempts exhausted for ${url}`);
    } finally {
      poller?.stop();
      activity.release();
    }
  }

  #visitRetrySignature(
    response: RenderVisitResponse,
  ): readonly string[] | undefined {
    // Consider any sub-response's error signature when deciding whether to
    // retry the whole visit with clearCache.
    for (let sub of [
      response.card,
      response.fileExtract,
      response.fileRender,
    ]) {
      if (!sub) continue;
      let signature = this.#renderRunner.shouldRetryWithClearCache(sub);
      if (signature) return signature;
    }
    return undefined;
  }

  async #restartBrowser(): Promise<void> {
    // Coalesce concurrent callers onto a single in-flight restart. Without
    // this, multiple failing visits in the same tick each trigger their own
    // closeAll + browser.close, which race on the same BrowserContexts and
    // produce "Failed to find context with id <X>" CDP errors as the second
    // caller tries to dispose contexts the first already disposed. Sharing
    // the promise also avoids redundantly tearing down + re-warming the
    // standby pool.
    if (this.#restartInFlight) {
      return this.#restartInFlight;
    }
    this.#restartInFlight = this.#runRestart().finally(() => {
      this.#restartInFlight = null;
    });
    return this.#restartInFlight;
  }

  async #runRestart(): Promise<void> {
    log.warn('Restarting prerender browser');
    await this.#pagePool.closeAll();
    await this.#browserManager.restartBrowser();
    await this.#pagePool.warmStandbys().catch((e) => {
      log.error('Failed to warm standby pages after browser restart:', e);
    });
  }

  #resolveAffinityIdleEvictMs(): number {
    let envIdle = process.env.PRERENDER_AFFINITY_IDLE_EVICT_MS;
    let idleMs =
      envIdle !== undefined ? Number(envIdle) : DEFAULT_AFFINITY_IDLE_EVICT_MS;
    if (!Number.isFinite(idleMs) || idleMs <= 0) {
      log.warn(
        'PRERENDER_AFFINITY_IDLE_EVICT_MS is invalid; defaulting to 12 hours',
      );
      idleMs = DEFAULT_AFFINITY_IDLE_EVICT_MS;
    }
    return idleMs;
  }

  #startCleanupLoop(): void {
    let envInterval = process.env.PRERENDER_USERDATA_CLEAN_INTERVAL_MS;
    let intervalMs =
      envInterval !== undefined ? Number(envInterval) : 30 * 60 * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      log.warn(
        'PRERENDER_USERDATA_CLEAN_INTERVAL_MS is invalid; defaulting to 30 minutes',
      );
      intervalMs = 30 * 60 * 1000;
    }
    if (intervalMs < 5 * 60 * 1000) {
      log.warn(
        'PRERENDER_USERDATA_CLEAN_INTERVAL_MS is less than 5 minutes; using 5 minutes for safety',
      );
      intervalMs = 5 * 60 * 1000;
    }
    this.#cleanupInterval = setInterval(() => {
      void this.#browserManager.cleanupUserDataDirs();
      void this.#pagePool
        .evictIdleAffinities(this.#affinityIdleEvictMs)
        .then((evictedAffinities) => {
          for (let affinityKey of evictedAffinities) {
            this.#renderRunner.clearAuthCache(affinityKey);
          }
        })
        .catch((e) => {
          log.warn('Error evicting idle prerender affinities:', e);
        });
    }, intervalMs);
    this.#cleanupInterval.unref?.();
  }

  #startQueueSnapshotLoop(): void {
    // Default to 30 s — slow enough not to spam logs during idle, fast
    // enough that a saturation-triggered 150 s abort (CS-10820) lands at
    // least two snapshot rows to diagnose from. Disable with 0/negative.
    let envInterval = process.env.PRERENDER_QUEUE_SNAPSHOT_INTERVAL_MS;
    let intervalMs = envInterval !== undefined ? Number(envInterval) : 30_000;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      return;
    }
    this.#queueSnapshotInterval = setInterval(() => {
      try {
        let snap = this.#pagePool.getQueueDepthSnapshot();
        if (snap.affinities.length === 0 && snap.totalPending === 0) {
          // Quiet path: no active affinities and no pending work. Skip the
          // log entirely so grep-able lines all describe real load.
          return;
        }
        let perAffinity = snap.affinities
          .map((a) => {
            let q = a.byQueue;
            let busy = q.file + q.module + q.command;
            // Only append the per-queue breakdown when the affinity has
            // tabs checked out for work. Idle affinities keep the compact
            // form to preserve log scannability. Labelled `busy=` (not
            // `running=`) because a tab is tagged with its queue from
            // acquisition until release — it may be waiting on the global
            // render semaphore for part of that window rather than
            // actively executing.
            let queueDetail =
              busy > 0
                ? `, busy=file:${q.file}/module:${q.module}/command:${q.command}`
                : '';
            // File-admission backpressure. `pending` = file callers
            // currently queued behind an exhausted semaphore. Only
            // printed when the semaphore has been created (affinity
            // has seen a file call) and something is actually waiting
            // — idle admission stays out of the log.
            let admissionDetail =
              a.admission.cap > 0 && a.admission.pending > 0
                ? `, admission=pending=${a.admission.pending}/cap=${a.admission.cap}`
                : '';
            // Priority breakdown of *queued* waiters for this affinity
            // (does NOT count the in-flight holder, which is what
            // `pending=` above includes). Format:
            // `priorities=<src>:<p>:<n>,<p>:<n>` where `<src>` is `tab`
            // for tab-queue waiters or `adm` for file-admission
            // waiters. Skipped when nothing is queued — idle affinities
            // stay compact. Format chosen so a single grep can pull
            // priority distributions out of the logs.
            let priorityDetail = formatQueuedByPriority(
              a.tabQueuedByPriority,
              a.admissionQueuedByPriority,
            );
            return `${a.affinityKey}(tabs=${a.tabCount}, pending=${a.pendingTotal}, max=${a.maxPending}${queueDetail}${admissionDetail}${priorityDetail})`;
          })
          .join(' ');
        log.info(
          'prerender-queue-snapshot totalTabs=%d totalPending=%d affinities=%d | %s',
          snap.totalTabs,
          snap.totalPending,
          snap.affinities.length,
          perAffinity,
        );
      } catch (e) {
        log.warn('queue snapshot log failed:', e);
      }
    }, intervalMs);
    this.#queueSnapshotInterval.unref?.();
  }
}

// Format helper for the `prerender-queue-snapshot` log line's priority
// breakdown. Counts queued waiters only; the in-flight holder is
// reflected separately in the `pending=` field on the same log entry.
// Returns `, priorities=tab:10:3,0:1` when the affinity has 3
// priority-10 + 1 priority-0 tab-queue waiters and no admission
// waiters. Returns `, priorities=tab:10:3|adm:0:2` when the breakdown
// also includes admission-queue waiters. Returns the empty string when
// nothing is queued. Numeric keys sort descending within each source
// (highest priority first), matching dequeue order.
function formatQueuedByPriority(
  tab: Record<number, number>,
  admission: Record<number, number>,
): string {
  let segments: string[] = [];
  let tabSegment = formatPriorityCounts(tab);
  if (tabSegment) segments.push(`tab:${tabSegment}`);
  let admSegment = formatPriorityCounts(admission);
  if (admSegment) segments.push(`adm:${admSegment}`);
  if (segments.length === 0) return '';
  return `, priorities=${segments.join('|')}`;
}

function formatPriorityCounts(counts: Record<number, number>): string {
  let entries = Object.entries(counts)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[0] - a[0]);
  return entries.map(([prio, n]) => `${prio}:${n}`).join(',');
}
