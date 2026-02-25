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
            // Resolve the Ember module registry from whichever loader shape
            // exists in this runtime build.
            let entries =
              (window as any).requirejs?.entries ??
              (window as any).require?.entries ??
              (window as any)._eak_seen;
            // Find the compiled realm-server service module and patch only the
            // one assertion method we need to bypass.
            let realmServerModuleName =
              entries &&
              Object.keys(entries).find((name) =>
                name.endsWith('/services/realm-server'),
              );
            if (!realmServerModuleName) {
              return;
            }
            let realmServerModule = (window as any).require(
              realmServerModuleName,
            );
            let RealmServerClass = realmServerModule?.default;
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
            // Cleanup mirrors setup above: locate the same service module and
            // restore the original assertOwnRealmServer implementation.
            let entries =
              (window as any).requirejs?.entries ??
              (window as any).require?.entries ??
              (window as any)._eak_seen;
            let realmServerModuleName =
              entries &&
              Object.keys(entries).find((name) =>
                name.endsWith('/services/realm-server'),
              );
            let originalAssertOwnRealmServer = (globalThis as any)
              .__boxelOriginalAssertOwnRealmServer;
            if (realmServerModuleName && originalAssertOwnRealmServer) {
              let realmServerModule = (window as any).require(
                realmServerModuleName,
              );
              let RealmServerClass = realmServerModule?.default;
              if (RealmServerClass?.prototype) {
                RealmServerClass.prototype.assertOwnRealmServer =
                  originalAssertOwnRealmServer;
              }
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

  RuntimeRealm.prototype.search = async function (
    this: RuntimeRealm,
    query: Parameters<RuntimeRealm['search']>[0],
  ): Promise<Awaited<ReturnType<RuntimeRealm['search']>>> {
    // Exposed to tests as a stable signal that fallback search actually ran.
    delayedSearchRequestCount++;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return await originalSearch.call(this, query);
  };

  return {
    getRequestCount: () => delayedSearchRequestCount,
    restore: () => {
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
