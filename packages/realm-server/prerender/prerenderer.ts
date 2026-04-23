import {
  type AffinityType,
  type RenderRouteOptions,
  type ModuleRenderResponse,
  type PrerenderVisitArgs,
  type ReleaseBatchArgs,
  type RenderVisitResponse,
  logger,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import { BrowserManager } from './browser-manager';
import { PagePool, StandbyTargetNotReadyError } from './page-pool';
import { RenderRunner, type Timings } from './render-runner';
import { isEnvironmentMode, serviceURL } from '../lib/dev-service-registry';
import { toAffinityKey } from './affinity';
import { PrerenderCancelledError, throwIfAborted } from './prerender-cancel';

const log = logger('prerenderer');
const defaultHostURL = isEnvironmentMode()
  ? serviceURL('host')
  : 'http://localhost:4200';
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

// Exported so cancellation-plumbing unit tests can drive it
// directly — it's a pure in-memory counting semaphore with no
// Chrome dependency.
export class AsyncSemaphore {
  #available: number;
  // `resolve` hands the acquirer the release function once a slot
  // frees. `onCancel` gives the cancellation path a way to splice
  // the entry out of the queue without racing #release.
  #queue: Array<{
    resolve: (release: () => void) => void;
    onCancel: () => void;
  }> = [];

  constructor(max: number) {
    this.#available = Math.max(1, max);
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.#available > 0) {
      this.#available--;
      return this.#release;
    }
    return await new Promise<() => void>((resolve, reject) => {
      let settled = false;
      let entry = {
        resolve: (release: () => void) => {
          if (settled) {
            // The caller cancelled right as a slot became available.
            // Hand the slot off to the next waiter (or restore the
            // count) by calling release immediately, so the queue
            // doesn't deadlock.
            release();
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(release);
        },
        onCancel: () => {
          if (settled) return;
          settled = true;
          let idx = this.#queue.indexOf(entry);
          if (idx !== -1) this.#queue.splice(idx, 1);
          reject(
            new PrerenderCancelledError({
              state: 'queued',
              reason:
                typeof signal?.reason === 'string' ? signal!.reason : undefined,
            }),
          );
        },
      };
      let onAbort = entry.onCancel;
      this.#queue.push(entry);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  #release = () => {
    let next = this.#queue.shift();
    if (next) {
      next.resolve(this.#release);
      return;
    }
    this.#available++;
  };
}

// Pure policy function for CS-10758 step 3 `clearCache` batch ownership.
// Given the incoming visit args and the current owner entry (if any),
// decides whether to strip `clearCache`, honor it, or replace the owner,
// and returns the gated args plus an optional owner mutation and log
// message. Extracted from Prerenderer.#gateClearCache so the policy table
// is unit-testable without constructing a full Prerenderer (which would
// launch Chrome via PagePool.warmStandbys during its constructor).
//
//   ┌─────────────────────────────┬─────────────┬──────────────────────┐
//   │ caller                      │ owner state │ action               │
//   ├─────────────────────────────┼─────────────┼──────────────────────┤
//   │ batchId=A + clearCache:true │ none        │ honor; owner := A    │
//   │ batchId=A + clearCache:true │ A           │ honor (same batch)   │
//   │ batchId=B + clearCache:true │ A (B ≠ A)   │ replace owner := B,  │
//   │                             │             │ honor clearCache     │
//   │                             │             │ (legit successor)    │
//   │ no batchId + clearCache:true│ any owner   │ STRIP clearCache     │
//   │ no batchId + clearCache:true│ none        │ honor (no protect)   │
//   │ any + clearCache:false/off  │ any         │ run; touch owner if  │
//   │                             │             │ batchId matches      │
//   └─────────────────────────────┴─────────────┴──────────────────────┘
//
// Rationale: indexing jobs are serialized per-realm through the queue, so
// two legitimate same-realm batches never run concurrently. The only
// source of a different-batchId + clearCache is a **successor** batch
// (crash recovery, or the next .gts-triggered run). That successor should
// win — it's the one with fresh module sources to pick up. Stripping its
// clearCache would silently regress the .gts invalidation semantic. The
// `no batchId` row covers the threat the ticket names: user-initiated
// prerenders and cross-realm traffic that happen to land on the
// indexer's warm tab.
export type BatchOwner = { batchId: string; since: number };

export interface BatchClearCacheDecision<
  T extends Pick<PrerenderVisitArgs, 'renderOptions'>,
> {
  gatedArgs: T;
  // `undefined`  — leave owner map unchanged
  // `null`       — (reserved; not used today — delete the owner entry)
  // { ... }      — set the owner entry for this affinity
  newOwner?: BatchOwner | null;
  log?: { level: 'info' | 'warn'; message: string };
}

export function computeBatchClearCacheGate<
  T extends Pick<
    PrerenderVisitArgs,
    'affinityType' | 'affinityValue' | 'renderOptions' | 'batchId'
  >,
>(
  args: T,
  owner: BatchOwner | undefined,
  nowMs: number,
): BatchClearCacheDecision<T> {
  let wantsClearCache = args.renderOptions?.clearCache === true;
  let affinityKey = toAffinityKey({
    affinityType: args.affinityType,
    affinityValue: args.affinityValue,
  });

  if (!wantsClearCache) {
    // Non-clearing visit is always OK. Touch the owner timestamp if
    // this visit belongs to the current owner (keeps-alive semantics).
    if (args.batchId && owner?.batchId === args.batchId) {
      return {
        gatedArgs: args,
        newOwner: { batchId: owner.batchId, since: nowMs },
      };
    }
    return { gatedArgs: args };
  }

  if (args.batchId) {
    // batchId + clearCache is always honored. A different batchId means
    // a legit successor; replace ownership so subsequent visits in the
    // new batch own the affinity.
    let log: BatchClearCacheDecision<T>['log'];
    if (owner && owner.batchId !== args.batchId) {
      log = {
        level: 'info',
        message: `batch owner for ${affinityKey} changing from ${owner.batchId} to ${args.batchId}`,
      };
    }
    return {
      gatedArgs: args,
      newOwner: { batchId: args.batchId, since: nowMs },
      log,
    };
  }

  // No batchId — user request / cross-realm traffic. If an active owner
  // exists, strip clearCache so the owner's warm loader survives.
  if (owner) {
    let strippedRenderOptions = {
      ...(args.renderOptions ?? {}),
      clearCache: undefined,
    };
    return {
      gatedArgs: { ...args, renderOptions: strippedRenderOptions },
      log: {
        level: 'warn',
        message: `stripping clearCache from non-batch request for ${affinityKey} (owner=${owner.batchId})`,
      },
    };
  }

  // No batchId and no owner — nothing to protect; honor.
  return { gatedArgs: args };
}

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
  #batchOwnership = new Map<string, { batchId: string; since: number }>();

  constructor(options: { serverURL: string; maxPages?: number }) {
    let maxPages = options.maxPages ?? 4;
    this.#semaphore = new AsyncSemaphore(maxPages);
    this.#browserManager = new BrowserManager();
    this.#pagePool = new PagePool({
      maxPages,
      serverURL: options.serverURL,
      browserManager: this.#browserManager,
      boxelHostURL,
      renderSemaphore: this.#semaphore,
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

  getVacancySnapshot(): Record<string, { idle: boolean; tabCount: number }> {
    return this.#pagePool.getVacancySnapshot();
  }

  // CS-10872: richer-than-vacancy snapshot used by prerender-app's
  // periodic fleet-health log line. Kept off the manager heartbeat
  // (operators read this locally) so we don't inflate every heartbeat.
  getQueueDepthSnapshot() {
    return this.#pagePool.getQueueDepthSnapshot();
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

  // CS-10872: walk any RenderError embedded in a response and merge
  // server-observed timings into its `diagnostics` block. The
  // prerender server's HTTP layer additionally attaches a
  // `requestId` via `decorateRenderErrorDiagnostics` — this method
  // covers the in-process path (test harnesses, co-located callers)
  // so the diagnostics payload is consistent regardless of how the
  // prerender was invoked.
  static decorateRenderErrorsWithTimings(
    response: unknown,
    timings: { launchMs: number; renderMs: number; waits: unknown },
    totalMs: number,
  ): void {
    if (!response || typeof response !== 'object') {
      return;
    }
    let serverContext = {
      launchMs: timings.launchMs,
      waits: timings.waits,
      renderElapsedMs: timings.renderMs,
      totalElapsedMs: totalMs,
    };
    let visit = (err: unknown) => {
      if (!err || typeof err !== 'object') return;
      let e = err as { diagnostics?: Record<string, unknown> };
      if (!e.diagnostics || typeof e.diagnostics !== 'object') {
        e.diagnostics = {};
      }
      Object.assign(e.diagnostics, serverContext);
    };
    let r = response as Record<string, unknown>;
    visit(r.error);
    visit(r.pageUnusableError);
    for (let key of ['card', 'fileExtract', 'fileRender'] as const) {
      let sub = r[key];
      if (sub && typeof sub === 'object') {
        visit((sub as { error?: unknown }).error);
      }
    }
  }

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
    signal,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
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
          signal,
        });
      } catch (e) {
        // Caller cancelled — log + conditionally evict, then
        // propagate. Don't restart the browser.
        if (e instanceof PrerenderCancelledError) {
          await this.#handlePrerenderCancel(e, affinityKey, overallStart, url);
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
            signal,
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
      );
      return lastResult;
    }
    throw new Error(`module prerender attempts exhausted for ${url}`);
  }

  async runCommand({
    userId,
    auth,
    command,
    commandInput,
    opts,
    signal,
  }: {
    userId: string;
    auth: string;
    command: string;
    commandInput?: Record<string, unknown> | null;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
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
        signal,
      });
      Prerenderer.decorateRenderErrorsWithTimings(
        result.response,
        result.timings,
        Date.now() - commandStart,
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

  async prerenderVisit(
    rawArgs: PrerenderVisitArgs & {
      opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
      signal?: AbortSignal;
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
    } = this.#gateClearCache(rawArgs);
    let signal = (rawArgs as { signal?: AbortSignal }).signal;
    let affinityKey = toAffinityKey({ affinityType, affinityValue });
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
          signal,
        });
      } catch (e) {
        // Caller cancelled — log + conditionally evict, then
        // propagate. Don't restart the browser.
        if (e instanceof PrerenderCancelledError) {
          await this.#handlePrerenderCancel(e, affinityKey, overallStart, url);
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
            signal,
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
      // signature. The retry re-runs all requested passes — matches the
      // existing per-call retry semantics.
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
      );
      return result;
    }
    if (lastResult) {
      Prerenderer.decorateRenderErrorsWithTimings(
        lastResult.response,
        lastResult.timings,
        Date.now() - attemptStart,
      );
      return lastResult;
    }
    throw new Error(`visit prerender attempts exhausted for ${url}`);
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
          .map(
            (a) =>
              `${a.affinityKey}(tabs=${a.tabCount}, pending=${a.pendingTotal}, max=${a.maxPending})`,
          )
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
