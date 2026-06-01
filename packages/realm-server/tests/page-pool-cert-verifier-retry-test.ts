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
  function emitCertVerifierFailure() {
    let request = {
      failure: () => ({ errorText: 'net::ERR_CERT_VERIFIER_CHANGED' }),
      resourceType: () => opts.failedResourceType ?? 'script',
      url: () => 'https://localhost:4200/assets/app.js',
    };
    for (let l of requestFailedListeners) {
      l(request);
    }
  }
  let page = {
    async goto() {
      // Production attaches the `requestfailed` watcher BEFORE navigating: a
      // parser-blocking boot script cert-fails while `domcontentloaded` is
      // still pending. Mirror that ordering by firing the failure during
      // `goto`, before it resolves on `domcontentloaded`.
      if (opts.emitCertVerifierFailure) {
        emitCertVerifierFailure();
      }
      return { status: () => 200 };
    },
    waitForFunction() {
      if (opts.boots) {
        return Promise.resolve(true);
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
      // If the abort regresses, each poisoned attempt waits this long and the
      // creation chain can't finish anywhere near the deadlines below.
      standbyTimeoutMs: 30_000,
      disableFileAdmission: true,
    });
    pools.push(pool);
    return pool;
  }

  test('a cert-verifier change aborts standby loading instead of stalling on the timeout', async function (assert) {
    // Every standby load is poisoned on a script and never boots, so no
    // booting standby can leak through the pool's concurrent refill — the
    // only observable is how long the creation chain takes to give up.
    // `warmStandbys` awaits that chain to completion: with the early-abort
    // each attempt is discarded the instant the failure is seen, so the
    // retries exhaust within ~a second; without it every attempt waits out
    // the full `standbyTimeoutMs` (30s above), so the chain can't finish
    // anywhere near the deadline below.
    //
    // An explicit race (rather than `assert.timeout`) keeps a regression a
    // clean assertion here instead of letting the 30s attempts linger and
    // assert after the test finished. Both branches resolve to a `settled`
    // flag so the outcome is always reported by the assertion, never thrown.
    let browserManager = makeBrowserStub({
      pageOptionsForAttempt: () => ({
        emitCertVerifierFailure: true,
        failedResourceType: 'script',
        boots: false,
      }),
    });
    let pool = makePool(browserManager);

    let outcome = await Promise.race([
      pool.warmStandbys().then(
        () => ({ settled: true }),
        () => ({ settled: true }),
      ),
      new Promise<{ settled: false }>((resolve) =>
        setTimeout(() => resolve({ settled: false }), 8_000),
      ),
    ]);

    assert.true(
      outcome.settled,
      'standby loading gives up fast (early-abort) rather than stalling on the 30s timeout',
    );
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
