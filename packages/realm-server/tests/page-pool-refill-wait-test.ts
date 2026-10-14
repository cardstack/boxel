import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import { PrerenderCancelledError } from '../prerender/prerender-cancel.ts';

// A caller with no tab of its own waits on the shared standby refill for a
// fresh one. That refill is one promise for every caller on the server, and
// it can stall on a browser call that never answers (`createBrowserContext`,
// `newPage`). These tests pin the contract that bounds each caller's share
// of that wait:
//
//   1. Past its budget, a brand-new affinity takes an idle tab from another
//      affinity rather than waiting out the stalled refill.
//   2. A module sub-render past its budget does the same, taking only an
//      idle tab, rather than parking for a release that never comes.
//   3. A caller's abort rejects its wait at once, while the refill runs on
//      and hands its standby to a caller that is still waiting.

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function makeGate(): Gate {
  let open!: () => void;
  let promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

// `createBrowserContext` waits on `gate` from the `hangFrom`-th call on, so a
// test can stall the refill at an exact point and later let it through.
function makeBrowserStub(opts: { hangFrom?: number } = {}) {
  let gate = makeGate();
  let created = 0;
  let hangFrom = opts.hangFrom ?? Infinity;
  let browser = {
    async createBrowserContext() {
      if (created++ >= hangFrom) {
        await gate.promise;
      }
      let context: any = {
        async newPage() {
          return {
            async goto() {},
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              return fn(...args);
            },
            async close() {},
            browserContext() {
              return context;
            },
            removeAllListeners() {},
            on() {},
          };
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
  return {
    browserManager,
    gate,
    hangNext() {
      hangFrom = created;
    },
  };
}

// Resolves to the promise's value, or to `'timeout'` if it hasn't settled in
// `ms`. A regression here is a hang, and this turns it into a failed assertion
// instead of a stuck test run.
async function within<T>(
  promise: Promise<T>,
  ms = 2000,
): Promise<T | 'timeout'> {
  let handle: NodeJS.Timeout | undefined;
  let timer = new Promise<'timeout'>((resolve) => {
    handle = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    clearTimeout(handle);
  }
}

// Unwraps a `within` result, failing the test when the wait timed out.
function settled<T>(value: T | 'timeout', what: string): T {
  if (value === 'timeout') {
    throw new Error(`timed out waiting for ${what}`);
  }
  return value;
}

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  let gates: Gate[] = [];
  // The dynamic-pool env vars override `maxPages`, and a dev shell sets
  // them, so each test starts from a fixed-size pool.
  let poolEnvKeys = [
    'PRERENDER_PAGE_POOL_MIN',
    'PRERENDER_PAGE_POOL_MAX',
    'PRERENDER_PAGE_POOL_INITIAL',
    'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
    'PRERENDER_HIGH_PRIORITY_THRESHOLD',
    'PRERENDER_AFFINITY_TAB_MAX',
  ];
  let savedPoolEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of poolEnvKeys) {
      savedPoolEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  hooks.afterEach(async () => {
    for (let key of poolEnvKeys) {
      if (savedPoolEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedPoolEnv[key];
      }
    }
    // `closeAll` awaits the refill in flight, so let any stalled creation
    // through first.
    for (let gate of gates.splice(0)) {
      gate.open();
    }
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
  });

  function makePool(opts: {
    maxPages: number;
    browserManager: any;
    gate: Gate;
    standbyRefillWaitMs: number;
  }): PagePool {
    let pool = new PagePool({
      maxPages: opts.maxPages,
      serverURL: 'http://localhost',
      browserManager: opts.browserManager,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      registerWithManager: false,
      standbyRefillWaitMs: opts.standbyRefillWaitMs,
    });
    pools.push(pool);
    gates.push(opts.gate);
    return pool;
  }

  test('a brand-new affinity steals an idle tab once its wait on a stalled refill runs out', async function (assert) {
    // The first two standbys are made; the third hangs in
    // `createBrowserContext`, so the refill never settles.
    let { browserManager, gate } = makeBrowserStub({ hangFrom: 2 });
    let pool = makePool({
      maxPages: 4,
      browserManager,
      gate,
      standbyRefillWaitMs: 50,
    });

    let a = settled(await within(pool.getPage('A')), "A's standby");
    a.release();
    let b = settled(await within(pool.getPage('B')), "B's standby");
    b.release();

    let startedAt = Date.now();
    let c = settled(await within(pool.getPage('C')), "C's tab");
    let elapsedMs = Date.now() - startedAt;
    c.release();
    assert.true(
      [a.pageId, b.pageId].includes(c.pageId),
      'C took an idle tab from another affinity',
    );
    assert.true(
      elapsedMs < 1000,
      `C waited about one refill budget, not on the refill (${elapsedMs}ms)`,
    );
    assert.true(
      c.waits.tabStartupMs >= 50,
      'the refill wait C paid is reported as tab startup',
    );
  });

  test('a brand-new module sub-render steals an idle tab instead of parking behind a stalled refill', async function (assert) {
    let stub = makeBrowserStub();
    let pool = makePool({
      maxPages: 2,
      browserManager: stub.browserManager,
      gate: stub.gate,
      standbyRefillWaitMs: 50,
    });

    let a = await pool.getPage('A');
    a.release();
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();

    // C takes the warm standby, and the refill that follows hangs. A and B
    // are idle throughout, so no release will ever wake a parked caller.
    stub.hangNext();
    let c = await pool.getPage('C');
    c.release();

    let d = settled(await within(pool.getPage('D', 'module')), "D's tab");
    d.release();
    assert.true(
      [a.pageId, b.pageId, c.pageId].includes(d.pageId),
      'D took an idle tab from another affinity',
    );
  });

  test("an aborted caller stops waiting on the refill at once, and the refill still serves the callers that didn't abort", async function (assert) {
    let stub = makeBrowserStub();
    let pool = makePool({
      maxPages: 2,
      browserManager: stub.browserManager,
      gate: stub.gate,
      // Long enough that only the abort or the refill settling ends a wait.
      standbyRefillWaitMs: 60_000,
    });

    let a = await pool.getPage('A');
    a.release();
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();
    stub.hangNext();
    let c = await pool.getPage('C');
    c.release();

    // Module sub-renders always wait on the refill for a fresh tab.
    let controller = new AbortController();
    let aborted = pool.getPage('D', 'module', { signal: controller.signal });
    let patient = pool.getPage('E', 'module');
    // Let both reach the refill wait.
    await new Promise((resolve) => setTimeout(resolve, 20));

    let abortedAt = Date.now();
    controller.abort('client went away');
    let outcome = await within(
      aborted.then(
        () => 'resolved' as const,
        (error) => error,
      ),
    );
    let rejectedAfterMs = Date.now() - abortedAt;
    assert.true(
      outcome instanceof PrerenderCancelledError,
      `the aborted caller rejected with a cancellation (got ${String(outcome)})`,
    );
    if (outcome instanceof PrerenderCancelledError) {
      assert.strictEqual(outcome.state, 'queued');
      assert.strictEqual(outcome.reason, 'client went away');
    }
    assert.true(
      rejectedAfterMs < 500,
      `the abort ended the wait promptly (${rejectedAfterMs}ms)`,
    );

    // The refill is still running for E, and the standby it makes is E's.
    stub.gate.open();
    let e = settled(await within(patient), "E's standby");
    e.release();
    assert.false(e.reused, 'E got a fresh standby rather than a stolen tab');
    assert.false(
      [a.pageId, b.pageId, c.pageId].includes(e.pageId),
      'E did not take another affinity’s tab',
    );
  });
});
