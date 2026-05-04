import { Realm as RuntimeRealm } from '@cardstack/runtime-common';
import { PagePool } from '../../prerender/page-pool';

export function installRealmServerAssertOwnRealmServerBypassPatch(): {
  restore: () => Promise<void>;
} {
  // Chrome patch setup:
  // We need a browser-side patch because prerender tests can run the host app
  // against dynamic realm origins (for example 127.0.0.1:4450), while the host's
  // RealmServerService.assertOwnRealmServer check assumes a single configured
  // realm server origin. Query-field search calls through that assertion before
  // it performs federated search, so without this patch search can bail out too
  // early and we never get to exercise query-load tracking behavior.
  let originalGetPage = PagePool.prototype.getPage;
  let patchedPages = new Map<any, (...args: any[]) => Promise<any>>();

  // Intercept page acquisition so we can inject one browser-runtime patch
  // before route transitions/captures run.
  PagePool.prototype.getPage = async function (this: PagePool, realm: string) {
    let pageInfo = await originalGetPage.call(this, realm);
    let page = pageInfo.page as any;
    let originalEvaluate = page?.evaluate?.bind(page);

    if (originalEvaluate && !patchedPages.has(page)) {
      patchedPages.set(page, originalEvaluate);
      // Per-page guard. A single page can be reused by the page pool; we only
      // need to install our patch once for that page instance.
      let injected = false;
      page.evaluate = async (...args: any[]) => {
        if (!injected) {
          injected = true;
          await originalEvaluate(() => {
            // Global guard in page context in case evaluate wrappers are
            // re-entered or patched multiple times.
            if ((globalThis as any).__boxelAssertOwnRealmServerPatched) {
              return;
            }
            // Vite builds the host as pure ESM — there is no classic AMD
            // module registry (window.requirejs.entries / _eak_seen) to walk.
            // The export-application-global instance-initializer stashes the
            // Ember ApplicationInstance on window['@cardstack/host'], so we
            // reach service classes through Ember's owner.factoryFor instead.
            let appInstance = (window as any)['@cardstack/host'];
            let RealmServerClass = appInstance?.factoryFor?.(
              'service:realm-server',
            )?.class;
            if (!RealmServerClass?.prototype) {
              return;
            }
            // Save original behavior so restore() can put it back and avoid
            // cross-test contamination.
            (globalThis as any).__boxelOriginalAssertOwnRealmServer =
              RealmServerClass.prototype.assertOwnRealmServer;
            // Patch objective:
            // Allow query-field search requests to proceed for dynamic test
            // realm origins. We are not changing search logic itself; this only
            // removes the single-origin assertion gate for this test runtime.
            RealmServerClass.prototype.assertOwnRealmServer = function () {
              return;
            };
            (globalThis as any).__boxelAssertOwnRealmServerPatched = true;
          });
        }
        // Delegate every evaluate call back to original behavior after patching.
        return originalEvaluate(...args);
      };
    }

    return { ...pageInfo, page };
  };

  return {
    restore: async () => {
      for (let [page, originalEvaluate] of patchedPages) {
        try {
          // Restore the original evaluate first to avoid leaving wrapped
          // evaluate functions behind on pooled pages that survive this test.
          page.evaluate = originalEvaluate;
          await originalEvaluate(() => {
            // Cleanup mirrors setup above: locate the same service class via
            // the Ember ApplicationInstance's factoryFor, then restore.
            let appInstance = (window as any)['@cardstack/host'];
            let RealmServerClass = appInstance?.factoryFor?.(
              'service:realm-server',
            )?.class;
            let originalAssertOwnRealmServer = (globalThis as any)
              .__boxelOriginalAssertOwnRealmServer;
            if (RealmServerClass?.prototype && originalAssertOwnRealmServer) {
              RealmServerClass.prototype.assertOwnRealmServer =
                originalAssertOwnRealmServer;
            }
            // Remove page globals used by this patch to keep runtime clean.
            delete (globalThis as any).__boxelOriginalAssertOwnRealmServer;
            delete (globalThis as any).__boxelAssertOwnRealmServerPatched;
          });
        } catch {
          // best effort cleanup: page may already be gone
        }
      }
      patchedPages.clear();
      // Always restore Node-side monkeypatch as well.
      PagePool.prototype.getPage = originalGetPage;
    },
  };
}

export function installDelayedRuntimeRealmSearchPatch(delayMs: number): {
  getRequestCount: () => number;
  restore: () => void;
} {
  // Server-side deterministic delay:
  // This makes query timing explicit/reproducible so tests can assert that
  // prerender waited for query resolution instead of "winning a race" by chance.
  let originalSearch = RuntimeRealm.prototype.search;
  let delayedSearchRequestCount = 0;
  let restored = false;
  // Sleeps that have not yet resolved. On restore() we wake them early so
  // they skip the underlying search; otherwise a long delay (e.g. 8s) can
  // outlive the realm/db fixture and the resumed call hits a closed pg pool.
  let pendingSleepCancels = new Set<() => void>();

  RuntimeRealm.prototype.search = async function (
    this: RuntimeRealm,
    query: Parameters<RuntimeRealm['search']>[0],
  ): Promise<Awaited<ReturnType<RuntimeRealm['search']>>> {
    // Exposed to tests as a stable signal that fallback search actually ran.
    delayedSearchRequestCount++;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let wake = () => {
        pendingSleepCancels.delete(wake);
        clearTimeout(timer);
        resolve();
      };
      pendingSleepCancels.add(wake);
      timer = setTimeout(wake, delayMs);
    });
    if (restored) {
      // The patch has been torn down — the test no longer cares about this
      // search and the realm fixture (including its pg pool) may already be
      // closed. Return an empty collection rather than reaching into a
      // potentially-dead adapter; the caller (handle-search/searchRealms)
      // will discard the result.
      return {
        data: [],
        meta: { page: { total: 0 } },
      } as Awaited<ReturnType<RuntimeRealm['search']>>;
    }
    return await originalSearch.call(this, query);
  };

  return {
    getRequestCount: () => delayedSearchRequestCount,
    restore: () => {
      restored = true;
      // Wake any in-flight sleepers immediately; the `restored` guard above
      // makes them skip originalSearch() so they don't query a closed pool.
      let cancels = [...pendingSleepCancels];
      pendingSleepCancels.clear();
      for (let wake of cancels) {
        wake();
      }
      RuntimeRealm.prototype.search = originalSearch;
    },
  };
}

export function installSearchRequestObserverPatch(): {
  getRequests: () => Array<{
    url: string;
    method: string;
    hasAuthorization: boolean;
  }>;
  restore: () => void;
} {
  let originalGetPage = PagePool.prototype.getPage;
  let observedRequests: Array<{
    url: string;
    method: string;
    hasAuthorization: boolean;
  }> = [];
  let pageRequestListeners = new Map<any, (request: any) => void>();

  PagePool.prototype.getPage = async function (this: PagePool, realm: string) {
    let pageInfo = await originalGetPage.call(this, realm);
    let page = pageInfo.page as any;
    if (page && !pageRequestListeners.has(page)) {
      let listener = (request: any) => {
        let url = request.url?.();
        if (
          !url ||
          (!url.endsWith('/_federated-search') && !url.endsWith('/_search'))
        ) {
          return;
        }
        let headers =
          (request.headers?.() as Record<string, string> | undefined) ?? {};
        observedRequests.push({
          url,
          method: request.method?.() ?? 'UNKNOWN',
          hasAuthorization: Boolean(
            headers.authorization ?? headers.Authorization,
          ),
        });
      };
      pageRequestListeners.set(page, listener);
      page.on?.('request', listener);
    }
    return { ...pageInfo, page };
  };

  return {
    getRequests: () => [...observedRequests],
    restore: () => {
      for (let [page, listener] of pageRequestListeners) {
        try {
          page.off?.('request', listener);
        } catch {
          // best-effort cleanup
        }
      }
      pageRequestListeners.clear();
      observedRequests = [];
      PagePool.prototype.getPage = originalGetPage;
    },
  };
}

/**
 * Inject transient 5xx responses for a chosen subset of fetches inside the
 * prerender chrome page. The patch enables Puppeteer request interception
 * once per page; matched URLs return the configured status until the
 * `failuresBeforeSuccess` budget is exhausted, after which they pass
 * through. Used to assert that the loader's transient-retry path actually
 * fires during prerender — without the native-sleep wiring in
 * loader-service the retry hangs at `await sleep(delay)` and the render
 * times out instead of recovering on the next attempt.
 */
export function installFlakyDepFetchPatch(opts: {
  matcher: (url: string) => boolean;
  failuresBeforeSuccess: number;
  status?: number;
}): {
  failuresInjected: () => number;
  restore: () => Promise<void>;
} {
  let originalGetPage = PagePool.prototype.getPage;
  let patchedPages = new WeakSet<object>();
  let listeners = new Map<any, (request: any) => void>();
  let interceptingPages = new Set<any>();
  let remainingFailures = opts.failuresBeforeSuccess;
  let failuresInjected = 0;
  let status = opts.status ?? 502;

  PagePool.prototype.getPage = async function (this: PagePool, realm: string) {
    let pageInfo = await originalGetPage.call(this, realm);
    let page = pageInfo.page as any;
    if (page && !patchedPages.has(page)) {
      patchedPages.add(page);
      // Fail fast: request.respond()/request.continue() require interception
      // to be enabled, so attaching the listener without interception would
      // turn into a confusing error mid-render. Let the puppeteer error
      // propagate so the test crashes at setup with a clear stack instead.
      await page.setRequestInterception(true);
      interceptingPages.add(page);
      let listener = (request: any) => {
        let url: string;
        let method: string;
        try {
          url = request.url();
          method = request.method();
        } catch {
          // The request lifecycle ended before we could inspect it.
          try {
            request.continue();
          } catch {
            // ignore — request already fulfilled or aborted
          }
          return;
        }
        // Let preflight pass through to the real realm-server so its CORS
        // middleware responds with the standard headers. We only want to
        // inject 5xx on the actual request, mirroring the real-world
        // transient-failure shape.
        if (method === 'OPTIONS') {
          request.continue().catch(() => {
            // best-effort
          });
          return;
        }
        if (remainingFailures > 0 && opts.matcher(url)) {
          remainingFailures--;
          failuresInjected++;
          request
            .respond({
              status,
              contentType: 'text/plain',
              // Mirror the realm-server's `cors({ origin: '*' })` so the
              // browser surfaces this 5xx to the host loader instead of
              // blocking it as a CORS-policy violation upstream of the
              // retry path. Without this header the browser would treat
              // the response as opaque and the loader would see a network
              // error (synthetic 500) rather than the retryable 502.
              headers: {
                'access-control-allow-origin': '*',
              },
              body: 'Bad Gateway (test injection)',
            })
            .catch(() => {
              // best-effort: page may have moved on
            });
          return;
        }
        request.continue().catch(() => {
          // best-effort: another handler may have already responded
        });
      };
      listeners.set(page, listener);
      page.on('request', listener);
    }
    return { ...pageInfo, page };
  };

  return {
    failuresInjected: () => failuresInjected,
    restore: async () => {
      PagePool.prototype.getPage = originalGetPage;
      for (let [page, listener] of listeners) {
        try {
          page.off('request', listener);
        } catch {
          // best-effort
        }
      }
      for (let page of interceptingPages) {
        try {
          await page.setRequestInterception(false);
        } catch {
          // best-effort: page may already be closed
        }
      }
      listeners.clear();
      interceptingPages.clear();
    },
  };
}

/**
 * Simulate the background-tab RAF throttling that causes the render-ready
 * stability loop to stall. This replaces `requestAnimationFrame` inside
 * prerender pages with a version that delays each callback by `delayMs`.
 * With the default 20-pass stability loop this makes a card that would
 * normally settle in <1 s take 20 × delayMs.
 */
export function installThrottledRAFPatch(delayMs: number): {
  restore: () => void;
} {
  let originalGetPage = PagePool.prototype.getPage;
  let patchedPages = new WeakSet<object>();

  PagePool.prototype.getPage = async function (this: PagePool, realm: string) {
    let pageInfo = await originalGetPage.call(this, realm);
    let page = pageInfo.page as any;
    let originalEvaluate = page?.evaluate?.bind(page);

    if (originalEvaluate && !patchedPages.has(page)) {
      patchedPages.add(page);
      let injected = false;
      page.evaluate = async (...args: any[]) => {
        if (!injected) {
          injected = true;
          await originalEvaluate((delay: number) => {
            if ((globalThis as any).__boxelRAFThrottled) {
              return;
            }
            (globalThis as any).__boxelRAFThrottled = true;
            let nativeRAF = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (callback: FrameRequestCallback) => {
              return nativeRAF(() => {
                // Use the native setTimeout (before the render-timer-stub
                // replaces it) to add the delay.
                let nativeSetTimeout =
                  (globalThis as any).__boxelNativeSetTimeout ??
                  window.setTimeout;
                nativeSetTimeout(() => callback(performance.now()), delay);
              });
            };
            // Stash native setTimeout before the render-timer-stub replaces it.
            (globalThis as any).__boxelNativeSetTimeout = window.setTimeout;
          }, delayMs);
        }
        return originalEvaluate(...args);
      };
    }
    return { ...pageInfo, page };
  };

  return {
    restore: () => {
      PagePool.prototype.getPage = originalGetPage;
    },
  };
}
