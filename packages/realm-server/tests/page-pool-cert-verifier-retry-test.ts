import { module, test } from 'qunit';
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool';

// Chrome reconfigures its certificate-verifier service shortly after the
// browser launches. A standby page created in that window has its in-flight
// asset fetches cancelled with net::ERR_CERT_VERIFIER_CHANGED — every script
// fails to load, the Ember app never boots, and the `#standby-ready` marker
// never appears. The transient resolves once the verifier settles: a fresh
// context loads cleanly. `#loadStandbyPage` watches for the signature on a
// critical asset and aborts the readiness wait immediately so the
// `#createStandbyWithRetries` retry lands in milliseconds instead of burning
// the full standby timeout (the wasted budget had been pushing the
// matrix-client realm-server startup probe past its own 120s deadline).
//
// These tests pin down that fast-retry contract.

interface PageStubOptions {
  // Whether the page emits a cert-verifier-cancelled `requestfailed` once a
  // listener attaches.
  emitCertVerifierFailure: boolean;
  // Resource type carried on the emitted `requestfailed`.
  failedResourceType?: string;
  // Whether the readiness marker ever appears. A page poisoned on a critical
  // asset never boots; one whose only casualty is a non-critical asset does.
  boots: boolean;
}

function makePageStub(opts: PageStubOptions, context: any) {
  let requestFailedListeners: Array<(request: any) => void> = [];
  let page = {
    async goto() {
      return { status: () => 200 };
    },
    waitForFunction() {
      if (opts.boots) {
        // Resolve a tick after the `requestfailed` macrotask below so that,
        // when a non-critical failure is emitted, the resource-type filter
        // is genuinely exercised before the marker wins the race.
        return new Promise((resolve) => setTimeout(() => resolve(true), 10));
      }
      // A standby stuck behind the verifier reconfiguration never boots; a
      // regression that drops the early-abort would await this until the
      // (deliberately large) standby timeout, blowing the QUnit per-test
      // deadline.
      return new Promise(() => {});
    },
    async evaluate(fn: any, ...args: any[]) {
      return fn(...args);
    },
    async evaluateOnNewDocument() {},
    async close() {},
    browserContext() {
      return context;
    },
    removeAllListeners() {},
    on(event: string, listener: (request: any) => void) {
      if (event !== 'requestfailed') {
        return;
      }
      requestFailedListeners.push(listener);
      if (!opts.emitCertVerifierFailure) {
        return;
      }
      // `#loadStandbyPage` attaches the listener only after `goto`
      // resolves, so by now the navigation is done — fire on the next
      // tick to mimic an asset fetch cancelled mid-load.
      setTimeout(() => {
        let request = {
          failure: () => ({ errorText: 'net::ERR_CERT_VERIFIER_CHANGED' }),
          resourceType: () => opts.failedResourceType ?? 'script',
          url: () => 'https://localhost:4200/assets/app.js',
        };
        for (let l of requestFailedListeners) {
          l(request);
        }
      }, 0);
    },
    off(event: string, listener: (request: any) => void) {
      if (event !== 'requestfailed') {
        return;
      }
      requestFailedListeners = requestFailedListeners.filter(
        (l) => l !== listener,
      );
    },
  };
  return page;
}

interface BrowserStubOptions {
  // Consulted per context-creation (0-based) to shape that attempt's page.
  pageOptionsForAttempt: (attempt: number) => PageStubOptions;
  onContextCreated?: () => void;
}

function makeBrowserStub(opts: BrowserStubOptions) {
  let attempt = 0;
  let browser = {
    async createBrowserContext() {
      let thisAttempt = attempt++;
      opts.onContextCreated?.();
      let context: any;
      context = {
        async newPage() {
          return makePageStub(opts.pageOptionsForAttempt(thisAttempt), context);
        },
        async close() {},
      };
      return context;
    },
  };
  let browserManager = {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {},
  };
  return browserManager;
}

module(basename(__filename), function (hooks) {
  let pools: PagePool[] = [];

  hooks.afterEach(async () => {
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
  });

  function makePool(browserManager: any): PagePool {
    let pool = new PagePool({
      maxPages: 1,
      serverURL: 'http://localhost',
      browserManager,
      boxelHostURL: 'http://localhost:4200',
      // Large on purpose: the early-abort must not depend on this firing.
      // If the abort regresses, the stuck first attempt waits this long and
      // the QUnit timeout below trips deterministically.
      standbyTimeoutMs: 30_000,
      disableFileAdmission: true,
    });
    pools.push(pool);
    return pool;
  }

  test('standby creation recovers fast from a transient cert-verifier change', async function (assert) {
    // The first standby is poisoned by the verifier transient and never
    // boots; with maxPages:1 it owns the only pool slot. Without the
    // early-abort, `getPage` cannot get a tab until that attempt times out
    // (`standbyTimeoutMs`, 30s above) and the retry boots. With it, the
    // poisoned attempt is discarded the instant the failure is seen and
    // the retried standby boots in milliseconds.
    let browserManager = makeBrowserStub({
      // First context poisoned on a script and never boots; the retry,
      // created once the verifier has settled, boots normally.
      pageOptionsForAttempt: (attempt) =>
        attempt === 0
          ? {
              emitCertVerifierFailure: true,
              failedResourceType: 'script',
              boots: false,
            }
          : { emitCertVerifierFailure: false, boots: true },
    });
    let pool = makePool(browserManager);

    // Race against an explicit deadline rather than `assert.timeout` so a
    // regression fails as a clean assertion here instead of letting the
    // 30s standby attempt linger and assert after the test finished. The
    // margin is generous against the sub-second happy path yet far below
    // the 30s stall a dropped early-abort would produce.
    let getPage = pool.getPage('A');
    getPage.catch(() => {}); // swallow late rejection if the deadline wins
    let result = await Promise.race([
      getPage.then((page) => ({ page })),
      new Promise<{ page: undefined }>((resolve) =>
        setTimeout(() => resolve({ page: undefined }), 8_000),
      ),
    ]);

    assert.ok(
      result.page,
      'getPage recovers and resolves well before the standby timeout',
    );
    result.page?.release();
  });

  test('a non-critical cert-verifier failure does not abort the readiness wait', async function (assert) {
    assert.timeout(10_000);

    // Every standby emits a verifier-cancelled failure, but only on an
    // image — a casualty that does not stop the app from booting. The
    // early-abort must ignore it: the marker still appears and the standby
    // is created. If the resource-type filter regressed and aborted on the
    // image, every standby would be discarded and `getPage` would throw
    // 'No standby page available' instead of resolving — failing the
    // assertion below.
    let browserManager = makeBrowserStub({
      pageOptionsForAttempt: () => ({
        emitCertVerifierFailure: true,
        failedResourceType: 'image',
        boots: true,
      }),
    });
    let pool = makePool(browserManager);

    let page = await pool.getPage('A');

    assert.ok(page, 'getPage resolves: a non-critical failure is not aborted');
    page.release();
  });
});
