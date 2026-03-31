import {
  type AffinityType,
  type RenderRouteOptions,
  type RenderResponse,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type FileRenderResponse,
  type FileRenderArgs,
  logger,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import { BrowserManager } from './browser-manager';
import { PagePool, StandbyTargetNotReadyError } from './page-pool';
import { RenderRunner } from './render-runner';
import { isEnvironmentMode, serviceURL } from '../lib/dev-service-registry';
import { toAffinityKey } from './affinity';

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
  #stopped = false;
  #browserManager: BrowserManager;
  #pagePool: PagePool;
  #renderRunner: RenderRunner;
  #cleanupInterval: NodeJS.Timeout | undefined;
  #affinityIdleEvictMs: number;
  #semaphore: AsyncSemaphore;

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
    });
    this.#renderRunner = new RenderRunner({
      pagePool: this.#pagePool,
      boxelHostURL,
    });
    this.#affinityIdleEvictMs = this.#resolveAffinityIdleEvictMs();
    this.#startCleanupLoop();
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

  getWarmAffinities(): string[] {
    return this.#pagePool.getWarmAffinities();
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

  async prerenderCard({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: RenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let attemptOptions = renderOptions;
    let lastResult:
      | {
          response: RenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: PoolMeta;
        }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let result: {
        response: RenderResponse;
        timings: { launchMs: number; renderMs: number };
        pool: PoolMeta;
      };
      try {
        result = await this.#renderRunner.prerenderCardAttempt({
          affinityType,
          affinityValue,
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
            affinityType,
            affinityValue,
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
  }

  async prerenderModule({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: ModuleRenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let attemptOptions = renderOptions;
    let lastResult:
      | {
          response: ModuleRenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: PoolMeta;
        }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let result: {
        response: ModuleRenderResponse;
        timings: { launchMs: number; renderMs: number };
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
        });
      } catch (e) {
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
  }

  async runCommand({
    userId,
    auth,
    command,
    commandInput,
    opts,
  }: {
    userId: string;
    auth: string;
    command: string;
    commandInput?: Record<string, unknown> | null;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
  }): Promise<{
    response: RunCommandResponse;
    timings: { launchMs: number; renderMs: number };
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    try {
      return await this.#renderRunner.runCommandAttempt({
        affinityType: 'user',
        affinityValue: userId,
        auth,
        command,
        commandInput,
        opts,
      });
    } catch (e) {
      log.error(`command run attempt failed (user ${userId})`, e);
      throw e;
    }
  }

  async prerenderFileExtract({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    opts,
    renderOptions,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: FileExtractResponse;
    timings: { launchMs: number; renderMs: number };
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let attemptOptions = renderOptions;
    let lastResult:
      | {
          response: FileExtractResponse;
          timings: { launchMs: number; renderMs: number };
          pool: PoolMeta;
        }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let result: {
        response: FileExtractResponse;
        timings: { launchMs: number; renderMs: number };
        pool: PoolMeta;
      };
      try {
        result = await this.#renderRunner.prerenderFileExtractAttempt({
          affinityType,
          affinityValue,
          realm,
          url,
          auth,
          opts,
          renderOptions: attemptOptions,
        });
      } catch (e) {
        log.error(
          `file extract prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
          e,
        );
        await this.#restartBrowser();
        try {
          result = await this.#renderRunner.prerenderFileExtractAttempt({
            affinityType,
            affinityValue,
            realm,
            url,
            auth,
            opts,
            renderOptions: attemptOptions,
          });
        } catch (e2) {
          log.error(
            `file extract prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
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
          `retrying file extract prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
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
          `file extract prerender retry with clearCache did not resolve error signature ${retrySignature.join(
            ' | ',
          )} for ${url}`,
        );
      }

      return result;
    }
    if (lastResult) {
      if (lastResult.response.error) {
        log.error(
          `file extract prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
        );
      }
      return lastResult;
    }
    throw new Error(`file extract prerender attempts exhausted for ${url}`);
  }

  async prerenderFileRender({
    affinityType,
    affinityValue,
    realm,
    url,
    auth,
    fileData,
    types,
    opts,
    renderOptions,
  }: {
    affinityType: AffinityType;
    affinityValue: string;
    realm: string;
    url: string;
    auth: string;
    fileData: FileRenderArgs['fileData'];
    types: string[];
    opts?: { timeoutMs?: number; simulateTimeoutMs?: number };
    renderOptions?: RenderRouteOptions;
  }): Promise<{
    response: FileRenderResponse;
    timings: { launchMs: number; renderMs: number };
    pool: PoolMeta;
  }> {
    if (this.#stopped) {
      throw new Error('Prerenderer has been stopped and cannot be used');
    }
    let attemptOptions = renderOptions;
    let lastResult:
      | {
          response: FileRenderResponse;
          timings: { launchMs: number; renderMs: number };
          pool: PoolMeta;
        }
      | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      let result: {
        response: FileRenderResponse;
        timings: { launchMs: number; renderMs: number };
        pool: PoolMeta;
      };
      try {
        result = await this.#renderRunner.prerenderFileRenderAttempt({
          affinityType,
          affinityValue,
          realm,
          url,
          auth,
          fileData,
          types,
          opts,
          renderOptions: attemptOptions,
        });
      } catch (e) {
        log.error(
          `file render prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
          e,
        );
        await this.#restartBrowser();
        try {
          result = await this.#renderRunner.prerenderFileRenderAttempt({
            affinityType,
            affinityValue,
            realm,
            url,
            auth,
            fileData,
            types,
            opts,
            renderOptions: attemptOptions,
          });
        } catch (e2) {
          log.error(
            `file render prerender attempt for ${url} (realm ${realm}) failed again after browser restart`,
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
          `retrying file render prerender for ${url} with clearCache due to error signature: ${retrySignature.join(
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
          `file render prerender retry with clearCache did not resolve error signature ${retrySignature.join(
            ' | ',
          )} for ${url}`,
        );
      }

      return result;
    }
    if (lastResult) {
      if (lastResult.response.error) {
        log.error(
          `file render prerender attempts exhausted for ${url} in realm ${realm}, returning last error response`,
        );
      }
      return lastResult;
    }
    throw new Error(`file render prerender attempts exhausted for ${url}`);
  }

  async #restartBrowser(): Promise<void> {
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
}
