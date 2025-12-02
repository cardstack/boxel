import {
  type RealmPermissions,
  type RenderRouteOptions,
  type RenderResponse,
  type ModuleRenderResponse,
  Deferred,
  logger,
} from '@cardstack/runtime-common';
import { createJWT } from '../jwt';
import { BrowserManager } from './browser-manager';
import { PagePool } from './page-pool';
import { RenderRunner } from './render-runner';

const log = logger('prerenderer');
const boxelHostURL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';

export class Prerenderer {
  #pendingByRealm = new Map<string, Promise<void>>();
  #secretSeed: string;
  #stopped = false;
  #browserManager: BrowserManager;
  #pagePool: PagePool;
  #renderRunner: RenderRunner;
  #cleanupInterval: NodeJS.Timeout | undefined;

  constructor(options: {
    secretSeed: string;
    serverURL: string;
    maxPages?: number;
    silent?: boolean;
  }) {
    this.#secretSeed = options.secretSeed;
    let maxPages = options.maxPages ?? 4;
    let silent = options.silent || process.env.PRERENDER_SILENT === 'true';
    this.#browserManager = new BrowserManager();
    this.#pagePool = new PagePool({
      maxPages,
      silent,
      serverURL: options.serverURL,
      browserManager: this.#browserManager,
    });
    this.#renderRunner = new RenderRunner({
      pagePool: this.#pagePool,
      boxelHostURL,
    });
    this.#startCleanupLoop();
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
    await this.#pagePool.disposeRealm(realm);
  }

  async prerenderCard({
    realm,
    url,
    userId,
    permissions,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
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

    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      }); // ensure chain continues even after errors

      let sessions: { [realm: string]: string } = {};
      for (let [realmURL, realmPermissions] of Object.entries(
        permissions ?? {},
      )) {
        sessions[realmURL] = createJWT(
          {
            user: userId,
            realm: realmURL,
            permissions: realmPermissions,
            sessionRoom: '',
          },
          '1d',
          this.#secretSeed,
        );
      }
      let auth = JSON.stringify(sessions);

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
            userId,
            permissions,
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
              userId,
              permissions,
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
      deferred.fulfill();
    }
  }

  async prerenderModule({
    realm,
    url,
    userId,
    permissions,
    opts,
    renderOptions,
  }: {
    realm: string;
    url: string;
    userId: string;
    permissions: RealmPermissions;
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

    try {
      await prev.catch((e) => {
        log.debug('Previous prerender in chain failed (continuing):', e);
      });

      let sessions: { [realm: string]: string } = {};
      for (let [realmURL, realmPermissions] of Object.entries(
        permissions ?? {},
      )) {
        sessions[realmURL] = createJWT(
          {
            user: userId,
            realm: realmURL,
            permissions: realmPermissions,
            sessionRoom: '',
          },
          '1d',
          this.#secretSeed,
        );
      }
      let auth = JSON.stringify(sessions);

      try {
        return await this.#renderRunner.prerenderModuleAttempt({
          realm,
          url,
          userId,
          permissions,
          auth,
          opts,
          renderOptions,
        });
      } catch (e) {
        log.error(
          `module prerender attempt for ${url} (realm ${realm}) failed with error, restarting browser`,
          e,
        );
        await this.#restartBrowser();
        return await this.#renderRunner.prerenderModuleAttempt({
          realm,
          url,
          userId,
          permissions,
          auth,
          opts,
          renderOptions,
        });
      }
    } finally {
      deferred.fulfill();
    }
  }

  async #restartBrowser(): Promise<void> {
    log.warn('Restarting prerender browser');
    await this.#pagePool.closeAll();
    await this.#browserManager.restartBrowser();
  }

  #startCleanupLoop(): void {
    let envInterval = process.env.PRERENDER_USERDATA_CLEAN_INTERVAL_MS;
    let intervalMs =
      envInterval !== undefined
        ? Number(envInterval)
        : 30 * 60 * 1000;
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
    }, intervalMs);
    this.#cleanupInterval.unref?.();
  }
}
