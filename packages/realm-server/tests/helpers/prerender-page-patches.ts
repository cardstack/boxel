import { Realm as RuntimeRealm } from '@cardstack/runtime-common';
import { PagePool } from '../../prerender/page-pool.ts';

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
  // prerender waited for query resolution instead of "winning a race" by
  // chance. The prerender tab's host reaches the realm through the
  // federated search, so the hook point is `searchEntries`.
  let originalSearchEntries = RuntimeRealm.prototype.searchEntries;
  let delayedSearchRequestCount = 0;
  let restored = false;
  // Sleeps that have not yet resolved. On restore() we wake them early so
  // they skip the underlying search; otherwise a long delay (e.g. 8s) can
  // outlive the realm/db fixture and the resumed call hits a closed pg pool.
  let pendingSleepCancels = new Set<() => void>();

  RuntimeRealm.prototype.searchEntries = async function (
    this: RuntimeRealm,
    ...args: Parameters<RuntimeRealm['searchEntries']>
  ): Promise<Awaited<ReturnType<RuntimeRealm['searchEntries']>>> {
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
      // potentially-dead adapter; the caller (handle-search/
      // searchEntryRealms) will discard the result.
      return {
        data: [],
        meta: { page: { total: 0 } },
      } as Awaited<ReturnType<RuntimeRealm['searchEntries']>>;
    }
    return await originalSearchEntries.apply(this, args);
  };

  return {
    getRequestCount: () => delayedSearchRequestCount,
    restore: () => {
      restored = true;
      // Wake any in-flight sleepers immediately; the `restored` guard above
      // makes them skip the original searchEntries() so they don't query a
      // closed pool.
      let cancels = [...pendingSleepCancels];
      pendingSleepCancels.clear();
      for (let wake of cancels) {
        wake();
      }
      RuntimeRealm.prototype.searchEntries = originalSearchEntries;
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
 * prerender chrome page. Used to assert that the loader's transient-retry
 * path actually fires during prerender — without the native-sleep wiring in
 * loader-service the retry hangs at `await sleep(delay)` and the render times
 * out instead of recovering on the next attempt.
 *
 * Only requests whose URL matches `urlPattern` (CDP `Fetch` pattern syntax:
 * `*` and `?` wildcards) are paused, through a CDP session of the patch's own.
 * Every other request the render makes goes to the network untouched.
 * Interception that pauses every request also sits in the path of the
 * card-document fetch, a cross-origin, preflighted GET that the realm answers
 * with a redirect, and that fetch is not what the test is about.
 * `matcher` then picks, among the paused requests, the ones to fail; the rest
 * continue as they were.
 */
export function installFlakyDepFetchPatch(opts: {
  urlPattern: string;
  matcher: (url: string) => boolean;
  failuresBeforeSuccess: number;
  status?: number;
}): {
  failuresInjected: () => number;
  trace: () => string;
  restore: () => Promise<void>;
} {
  let originalGetPage = PagePool.prototype.getPage;
  let patchedPages = new WeakSet<object>();
  let sessions: any[] = [];
  let bypassedPages: any[] = [];
  let pageListeners: { page: any; event: string; listener: any }[] = [];
  let remainingFailures = opts.failuresBeforeSuccess;
  let failuresInjected = 0;
  let status = opts.status ?? 502;
  // What the render's tab did while the patch was installed, in order: the
  // requests it paused and what it did with each, every realm response's
  // status and whether it carried a CORS allow-origin header, every request
  // Chrome reports as failed, and the tab's console errors. A test prints this
  // when it fails. A fetch the page sees as "Failed to fetch" has two very
  // different causes, a socket that failed and a response the browser refused
  // for want of CORS headers, and only this trace tells them apart.
  let traceStart = Date.now();
  let traceLines: string[] = [];
  let record = (line: string) => {
    traceLines.push(`+${Date.now() - traceStart}ms ${line}`);
  };
  // Host assets and the favicon say nothing about the realm.
  let isNoise = (url: string) =>
    url.includes('/assets/') || url.includes('favicon');
  let observe = (page: any, event: string, listener: any) => {
    page.on(event, listener);
    pageListeners.push({ page, event, listener });
  };

  PagePool.prototype.getPage = async function (this: PagePool, realm: string) {
    let pageInfo = await originalGetPage.call(this, realm);
    let page = pageInfo.page as any;
    if (page && !patchedPages.has(page)) {
      patchedPages.add(page);
      observe(page, 'response', (response: any) => {
        try {
          let url: string = response.url();
          if (isNoise(url)) {
            return;
          }
          let allowOrigin =
            response.headers()['access-control-allow-origin'] ?? 'absent';
          record(
            `RESPONSE ${response.request().method()} ${url}: ${response.status()} (access-control-allow-origin: ${allowOrigin})`,
          );
        } catch {
          record('RESPONSE (response could not be inspected)');
        }
      });
      observe(page, 'requestfailed', (request: any) => {
        try {
          if (isNoise(request.url())) {
            return;
          }
          record(
            `FAILED ${request.method()} ${request.url()}: ${
              request.failure()?.errorText ?? 'no error text'
            }`,
          );
        } catch {
          record('FAILED (request could not be inspected)');
        }
      });
      observe(page, 'console', (message: any) => {
        try {
          if (message.type() === 'error' || message.type() === 'warn') {
            record(`CONSOLE ${message.type()}: ${message.text()}`);
          }
        } catch {
          // ignore — the message outlived its page
        }
      });

      // Fail fast: a session that can't enable interception would leave the
      // test asserting on a fetch it never touched, so let the error
      // propagate and crash the test at setup with a clear stack instead.
      // The host registers its auth service worker in the shared browser, so
      // after earlier test files a pooled tab can be controlled by it. With
      // the worker in the path and this session intercepting, Chrome aborts
      // the card document fetch after its redirect (net::ERR_ABORTED), and
      // the render fails before it fetches the module this patch targets.
      // Bypassing the worker keeps the tab's fetches on the path intercepted
      // below.
      await page.setBypassServiceWorker(true);
      bypassedPages.push(page);
      let session = await page.createCDPSession();
      sessions.push(session);
      session.on('Fetch.requestPaused', (event: any) => {
        let { requestId, request } = event;
        let { url, method } = request;
        let pass = (why: string) => {
          record(`${method} ${url} -> continue (${why})`);
          session
            .send('Fetch.continueRequest', { requestId })
            .catch((err: Error) => {
              record(`${method} ${url} continue rejected: ${err?.message}`);
            });
        };
        // Let preflight pass through to the real realm-server so its CORS
        // middleware responds with the standard headers. We only want to
        // inject 5xx on the actual request, mirroring the real-world
        // transient-failure shape.
        if (method === 'OPTIONS') {
          pass('preflight');
          return;
        }
        if (remainingFailures <= 0 || !opts.matcher(url)) {
          pass(remainingFailures <= 0 ? 'budget spent' : 'not matched');
          return;
        }
        remainingFailures--;
        failuresInjected++;
        record(`${method} ${url} -> respond ${status}`);
        session
          .send('Fetch.fulfillRequest', {
            requestId,
            responseCode: status,
            // Mirror the realm-server's `cors({ origin: '*' })` so the
            // browser surfaces this 5xx to the host loader instead of
            // blocking it as a CORS-policy violation upstream of the retry
            // path. Without this header the browser would treat the response
            // as opaque and the loader would see a network error (synthetic
            // 500) rather than the retryable 502.
            responseHeaders: [
              { name: 'content-type', value: 'text/plain' },
              { name: 'access-control-allow-origin', value: '*' },
            ],
            body: Buffer.from('Bad Gateway (test injection)').toString(
              'base64',
            ),
          })
          .catch((err: Error) => {
            record(`${method} ${url} respond rejected: ${err?.message}`);
          });
      });
      await session.send('Fetch.enable', {
        patterns: [{ urlPattern: opts.urlPattern, requestStage: 'Request' }],
      });
      record(`intercepting ${opts.urlPattern}`);
    }
    return { ...pageInfo, page };
  };

  return {
    failuresInjected: () => failuresInjected,
    trace: () => traceLines.join('\n'),
    restore: async () => {
      PagePool.prototype.getPage = originalGetPage;
      for (let { page, event, listener } of pageListeners) {
        try {
          page.off(event, listener);
        } catch {
          // best-effort
        }
      }
      pageListeners = [];
      for (let session of sessions) {
        try {
          await session.detach();
        } catch {
          // best-effort: page may already be closed
        }
      }
      sessions = [];
      for (let page of bypassedPages) {
        try {
          await page.setBypassServiceWorker(false);
        } catch {
          // best-effort: page may already be closed
        }
      }
      bypassedPages = [];
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
