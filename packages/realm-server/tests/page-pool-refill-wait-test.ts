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
//   2. A module sub-render past its budget does the same, rather than
//      parking for a release that never comes — whether its affinity is
//      brand-new or its parent render holds the affinity's only tab. It
//      takes only an idle tab: with every other tab busy it parks until one
//      frees, since a busy tab may be held by the render it is blocking.
//   3. A caller woken from that park takes the freed tab at once, rather
//      than waiting out its budget on the same stalled refill a second time.
//   4. A caller's abort rejects its wait at once, while the refill runs on
//      and hands its standby to a caller that is still waiting.
//   5. A waiting caller takes each standby the moment it is created, not
//      when the refill pass that made it settles.

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
  return {
    browserManager: makeBrowserManager(async () => {
      if (created++ >= hangFrom) {
        await gate.promise;
      }
    }),
    gate,
    hangNext() {
      hangFrom = created;
    },
  };
}

// Each `createBrowserContext` call waits on its own gate, `gateFor(n)` for the
// n-th call, so a test can let one standby through while the next hangs.
// `gate` opens every one of them, including those of calls still to come.
function makeSteppedBrowserStub() {
  let callGates: Gate[] = [];
  let allOpen = false;
  let gateFor = (n: number) => {
    let gate = (callGates[n] ??= makeGate());
    if (allOpen) {
      gate.open();
    }
    return gate;
  };
  let created = 0;
  return {
    browserManager: makeBrowserManager(async () => {
      await gateFor(created++).promise;
    }),
    gateFor,
    gate: {
      promise: Promise.resolve(),
      open() {
        allOpen = true;
        for (let gate of callGates) {
          gate.open();
        }
      },
    } as Gate,
  };
}

// A browser whose `createBrowserContext` first awaits `beforeCreate`.
function makeBrowserManager(beforeCreate: () => Promise<void>) {
  let browser = {
    async createBrowserContext() {
      await beforeCreate();
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
  return {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {},
  };
  return browserManager;
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
    assert.timeout(10_000);
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
      c.waits.tabStartupMs >= 40,
      'the refill wait C paid is reported as tab startup',
    );
  });

  test('a brand-new module sub-render steals an idle tab instead of parking behind a stalled refill', async function (assert) {
    assert.timeout(10_000);
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

  test('a brand-new module sub-render past a stalled refill never queues on a busy tab', async function (assert) {
    assert.timeout(10_000);
    let stub = makeBrowserStub();
    let pool = makePool({
      maxPages: 2,
      browserManager: stub.browserManager,
      gate: stub.gate,
      standbyRefillWaitMs: 50,
    });

    let a = await pool.getPage('A');
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();

    // C takes the warm standby and the refill that follows hangs. B is the
    // idle affinity the cap evicts, leaving A and C, both mid-render.
    stub.hangNext();
    let c = await pool.getPage('C');

    let pending = pool.getPage('D', 'module');
    // A is the older of the two busy tabs, so it is the one a steal that
    // took busy tabs would queue on, and it never frees.
    await new Promise((resolve) => setTimeout(resolve, 100));
    c.release();

    let d = settled(await within(pending), "D's tab");
    d.release();
    a.release();
    assert.strictEqual(
      d.pageId,
      c.pageId,
      'D waited for a tab to free and took it, rather than queueing on a busy one',
    );
  });

  test('a module sub-render on an affinity whose only tab its parent holds steals an idle tab past a stalled refill', async function (assert) {
    assert.timeout(10_000);
    let stub = makeBrowserStub();
    let pool = makePool({
      maxPages: 3,
      browserManager: stub.browserManager,
      gate: stub.gate,
      standbyRefillWaitMs: 50,
    });

    let a = await pool.getPage('A');
    a.release();
    let b = await pool.getPage('B');
    b.release();
    // C's parent render holds C's only tab for the rest of the test.
    let c = await pool.getPage('C');
    await pool.warmStandbys();

    // D takes the warm standby, the cap evicts the least-recently-used idle
    // affinity (A), and the refill that follows hangs. B and D are idle.
    stub.hangNext();
    let d = await pool.getPage('D');
    d.release();

    let sub = settled(
      await within(pool.getPage('C', 'module')),
      "C's sub-render tab",
    );
    sub.release();
    c.release();
    assert.true(
      [b.pageId, d.pageId].includes(sub.pageId),
      "the sub-render took an idle tab from another affinity, not its parent's",
    );
  });

  test('a caller woken from parking takes the freed tab without waiting on the stalled refill again', async function (assert) {
    assert.timeout(10_000);
    let stub = makeBrowserStub();
    let pool = makePool({
      maxPages: 2,
      browserManager: stub.browserManager,
      gate: stub.gate,
      standbyRefillWaitMs: 1000,
    });

    let a = await pool.getPage('A');
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();

    // C takes the warm standby and the refill that follows hangs. B is
    // evicted, leaving A and C, both mid-render, so D parks once its wait
    // on the refill runs out.
    stub.hangNext();
    let c = await pool.getPage('C');
    let pending = pool.getPage('D', 'module');
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // C frees its tab, then comes back for it shortly after. D has to take
    // the tab in that window, which a second budget-long wait would miss.
    c.release();
    let releasedAt = Date.now();
    let cAgain = new Promise<Awaited<ReturnType<PagePool['getPage']>>>(
      (resolve, reject) =>
        setTimeout(() => pool.getPage('C').then(resolve, reject), 200),
    );

    let d = settled(await within(pending), "D's tab");
    let tookMs = Date.now() - releasedAt;
    d.release();
    let again = settled(await within(cAgain), "C's second tab");
    again.release();
    a.release();
    assert.strictEqual(d.pageId, c.pageId, 'D took the tab C freed');
    assert.true(
      tookMs < 200,
      `D took it before C came back for it (${tookMs}ms after the release)`,
    );
  });

  test("an aborted caller stops waiting on the refill at once, and the refill still serves the callers that didn't abort", async function (assert) {
    assert.timeout(10_000);
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

  test('a waiting caller takes a standby as soon as it is created, while the refill that made it is still running', async function (assert) {
    assert.timeout(10_000);
    let stub = makeSteppedBrowserStub();
    let pool = makePool({
      maxPages: 4,
      browserManager: stub.browserManager,
      gate: stub.gate,
      // Long enough that only a standby ends the wait.
      standbyRefillWaitMs: 60_000,
    });

    // The pool starts empty, so A waits on the refill's first creation.
    let pending = pool.getPage('A');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The first standby is made; the refill's next creation hangs, so the
    // refill pass never settles.
    stub.gateFor(0).open();
    let a = settled(await within(pending), "A's standby");
    a.release();
    assert.false(a.reused, 'A got a fresh standby');
  });
});
