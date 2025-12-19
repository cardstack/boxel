import {
  type RenderRouteOptions,
  type RenderResponse,
  type ModuleRenderResponse,
  Deferred,
  logger,
} from '@cardstack/runtime-common';
import { BrowserManager } from './browser-manager';
import { PagePool } from './page-pool';
import { RenderRunner } from './render-runner';

const log = logger('prerenderer');
const boxelHostURL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';
const DEFAULT_REALM_IDLE_EVICT_MS = 12 * 60 * 60 * 1000;

class AsyncSemaphore {
  #available: number;
  #queue: Array<(release: () => void) => void> = [];

  constructor(max: number) {
    this.#available = Math.max(1, max);
  }

  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
      return this.#release;
    }
    return await new Promise<() => void>((resolve) => {
      this.#queue.push(resolve);
    });
  }

  #release = () => {
    let next = this.#queue.shift();
    if (next) {
      next(this.#release);
      return;
    }
    this.#available++;
  };
}

export class Prerenderer {
  #pendingByRealm = new Map<string, Promise<void>>();
  #stopped = false;
  #browserManager: BrowserManager;
  #pagePool: PagePool;
  #renderRunner: RenderRunner;
  #cleanupInterval: NodeJS.Timeout | undefined;
  #realmIdleEvictMs: number;
  #semaphore: AsyncSemaphore;

  constructor(options: {
    serverURL: string;
    maxPages?: number;
    silent?: boolean;
  }) {
    let maxPages = options.maxPages ?? 4;
    let silent = options.silent || process.env.PRERENDER_SILENT === 'true';
    this.#semaphore = new AsyncSemaphore(maxPages);
    this.#browserManager = new BrowserManager();
    this.#pagePool = new PagePool({
      maxPages,
      silent,
      serverURL: options.serverURL,
      browserManager: this.#browserManager,
      boxelHostURL,
    });
    this.#renderRunner = new RenderRunner({
      pagePool: this.#pagePool,
      boxelHostURL,
    });
    this.#realmIdleEvictMs = this.#resolveRealmIdleEvictMs();
    this.#startCleanupLoop();
    void this.#pagePool.warmStandbys().catch((e) => {
      log.error('Failed to warm standby pages during prerenderer startup:', e);
    });
  }

  getWarmRealms(): string[] {
    return this.#pagePool.getWarmRealms();
  }

  async stop(): Promise<void> {
    if (this.#cleanupInterval) {
      clearInterval(this.#cleanupInterval);
      this.#cleanupInterval = undefined;
    }
    await this.#pagePool.closeAll();
    await this.#browserManager.stop();
    this.#stopped = true;
  }

  async disposeRealm(realm: string): Promise<void> {
    this.#renderRunner.clearAuthCache(realm);
    await this.#pagePool.disposeRealm(realm);
  }

  async prerenderCard({
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: RenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    // chain requests for the same realm together so they happen in serial
    let prev = this.#pendingByRealm.get(realm) ?? Promise.resolve();
    let deferred = new Deferred<void>();
    this.#pendingByRealm.set(
      realm,
      prev.then(() => deferred.promise),
    );

    let releaseGlobal: (() => void) | undefined;
    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      }); // ensure chain continues even after errors
      releaseGlobal = await this.#semaphore.acquire();

      let attemptOptions = renderOptions;
      let lastResult:
        | {
            response: RenderResponse;
            timings: { launchMs: number; renderMs: number };
            pool: {
              pageId: string;
              realm: string;
              reused: boolean;
              evicted: boolean;
              timedOut: boolean;
            };
          }
        | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        let result: {
          response: RenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: {
            pageId: string;
            realm: string;
            reused: boolean;
            evicted: boolean;
            timedOut: boolean;
          };
        };
        try {
          result = await this.#renderRunner.prerenderCardAttempt({
            realm,
            url,
            auth,
            opts,
            renderOptions: attemptOptions,
          });
        } catch (e) {
          log.error(
            `prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
            e,
          );
          await this.#restartBrowser();
          try {
            result = await this.#renderRunner.prerenderCardAttempt({
              realm,
              url,
              auth,
              opts,
              renderOptions: attemptOptions,
            });
          } catch (e2) {
            log.error(
              `prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
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
            `retrying prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
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
            `prerender retry with clearCache did not resolve error signature ${retrySignature.join(
              ' | ',
            )} for ${url}`,
          );
        }

        return result;
      }
      if (lastResult) {
        if (lastResult.response.error) {
          log.error(
            `prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
          );
        }
        return lastResult;
      }
      throw new Error(`prerender attempts exhausted for ${url}`);
    } finally {
      try {
        releaseGlobal?.();
      } catch (_e) {
        // best-effort release; avoids blocking future renders
      }
      deferred.fulfill();
    }
  }

  async prerenderModule({
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: ModuleRenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: {
      pageId: string;
      realm: string;
      reused: boolean;
      evicted: boolean;
      timedOut: boolean;
    };
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let prev = this.#pendingByRealm.get(realm) ?? Promise.resolve();
    let deferred = new Deferred<void>();
    this.#pendingByRealm.set(
      realm,
      prev.then(() => deferred.promise),
    );

    let releaseGlobal: (() => void) | undefined;
    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      });
      releaseGlobal = await this.#semaphore.acquire();

      let attemptOptions = renderOptions;
      let lastResult:
        | {
            response: ModuleRenderResponse;
            timings: { launchMs: number; renderMs: number };
            pool: {
              pageId: string;
              realm: string;
              reused: boolean;
              evicted: boolean;
              timedOut: boolean;
            };
          }
        | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        let result: {
          response: ModuleRenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: {
            pageId: string;
            realm: string;
            reused: boolean;
            evicted: boolean;
            timedOut: boolean;
          };
        };
        try {
          result = await this.#renderRunner.prerenderModuleAttempt({
            realm,
            url,
            auth,
            opts,
            renderOptions: attemptOptions,
          });
        } catch (e) {
          log.error(
            `module prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
            e,
          );
          await this.#restartBrowser();
          try {
            result = await this.#renderRunner.prerenderModuleAttempt({
              realm,
              url,
              auth,
              opts,
              renderOptions: attemptOptions,
            });
          } catch (e2) {
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

        return result;
      }
      if (lastResult) {
        if (lastResult.response.error) {
          log.error(
            `module prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
          );
        }
        return lastResult;
      }
      throw new Error(`module prerender attempts exhausted for ${url}`);
    } finally {
      try {
        releaseGlobal?.();
      } catch (_e) {
        // best-effort release; avoids blocking future renders
      }
      deferred.fulfill();
    }
  }

  async #restartBrowser(): Promise<void> {
    log.warn('Restarting prerender browser');
    await this.#pagePool.closeAll();
    await this.#browserManager.restartBrowser();
    await this.#pagePool.warmStandbys().catch((e) => {
      log.error('Failed to warm standby pages after browser restart:', e);
    });
  }

  #resolveRealmIdleEvictMs(): number {
    let envIdle = process.env.PRERENDER_REALM_IDLE_EVICT_MS;
    let idleMs =
      envIdle !== undefined ? Number(envIdle) : DEFAULT_REALM_IDLE_EVICT_MS;
    if (!Number.isFinite(idleMs) || idleMs <= 0) {
      log.warn(
        'PRERENDER_REALM_IDLE_EVICT_MS is invalid; defaulting to 12 hours',
      );
      idleMs = DEFAULT_REALM_IDLE_EVICT_MS;
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
        .evictIdleRealms(this.#realmIdleEvictMs)
        .then((evictedRealms) => {
          for (let realm of evictedRealms) {
            this.#renderRunner.clearAuthCache(realm);
          }
        })
        .catch((e) => {
          log.warn('Error evicting idle prerender realms:', e);
        });
    }, intervalMs);
    this.#cleanupInterval.unref?.();
  }
}
