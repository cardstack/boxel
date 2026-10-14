import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';

// The pool holds at most `maxPages` live tabs plus one warm standby. Every
// brand-new affinity waits on the shared standby refill for its first tab, so
// the refill must never wait on anything a render controls: it only fills
// free budget and never evicts. The cap is enforced where tabs change hands,
// by evicting idle affinities without waiting on their close. LRU order is
// "last acquired", so the oldest affinity can be one whose tab is mid-render
// — and a render in an unresponsive tab can hold its tab for minutes — which
// is why a busy affinity is never an eviction victim.
//
// These tests pin the contract:
//
//   1. A brand-new affinity gets a tab while the LRU affinity is mid-render,
//      and the busy affinity is left alone.
//   2. With every resident affinity busy, the refill disposes nothing and
//      settles instead of waiting on any of them.
//   3. An awaited `disposeAffinity` of a busy affinity returns within its
//      teardown budget, and the busy tab is closed only once its render
//      releases it — never out from under the render.
//   4. Live tabs stay within `maxPages` across a standby commandeered at the
//      cap and across a contraction. A pool pushed over the cap while every
//      tab was busy is trimmed by the next hand-out that finds an idle
//      affinity, not by a release, which would cost a returning caller its
//      warm tab.

interface StubPage {
  closed: boolean;
}

interface StubContext {
  closed: boolean;
  pages: StubPage[];
}

function makeBrowserStub(opts: { closeDelayMs?: number } = {}) {
  let contexts: StubContext[] = [];
  let open = { now: 0, peak: 0 };
  let closeDelay = () =>
    opts.closeDelayMs
      ? new Promise((resolve) => setTimeout(resolve, opts.closeDelayMs))
      : Promise.resolve();
  let browser = {
    async createBrowserContext() {
      let record: StubContext = { closed: false, pages: [] };
      contexts.push(record);
      open.now++;
      open.peak = Math.max(open.peak, open.now);
      let context: any = {
        async newPage() {
          let pageRecord: StubPage = { closed: false };
          record.pages.push(pageRecord);
          return {
            async goto() {},
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              return fn(...args);
            },
            async close() {
              await closeDelay();
              pageRecord.closed = true;
            },
            browserContext() {
              return context;
            },
            removeAllListeners() {},
            on() {},
          };
        },
        async close() {
          if (record.closed) return;
          await closeDelay();
          if (record.closed) return;
          record.closed = true;
          open.now--;
          for (let page of record.pages) {
            page.closed = true;
          }
        },
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
  return { browserManager, contexts, open };
}

// Poll for a condition instead of sleeping a guessed interval, so a test that
// needs the pool to reach a state waits exactly as long as that takes.
async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  let deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  let prev: Record<string, string | undefined> = {};
  for (let key of Object.keys(vars)) {
    prev[key] = process.env[key];
  }
  try {
    for (let [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fn();
  } finally {
    for (let [key, value] of Object.entries(prev)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  // Leases a test holds to model an in-flight render. Released in
  // `afterEach` so a failing test can't leave a close parked on one.
  let held: Array<() => void> = [];
  // The dynamic-pool env vars override `maxPages`, and a dev shell sets
  // them, so each test starts from a fixed-size pool unless it opts in.
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
    for (let release of held.splice(0)) {
      release();
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
    affinityTeardownWaitMs?: number;
  }): PagePool {
    let pool = new PagePool({
      maxPages: opts.maxPages,
      serverURL: 'http://localhost',
      browserManager: opts.browserManager,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      registerWithManager: false,
      ...(opts.affinityTeardownWaitMs !== undefined
        ? { affinityTeardownWaitMs: opts.affinityTeardownWaitMs }
        : {}),
    });
    pools.push(pool);
    return pool;
  }

  async function hold(pool: PagePool, affinityKey: string) {
    let page = await pool.getPage(affinityKey);
    held.push(page.release);
    return page;
  }

  test('a brand-new affinity gets a tab while the LRU affinity is mid-render', async function (assert) {
    let { browserManager, contexts } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    // A is acquired first, so it is the least-recently-used affinity, and
    // its render never finishes.
    await hold(pool, 'A');
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();

    // C takes the standby, which puts the pool one tab over its cap; the
    // refill that follows has to dispose an affinity to make room.
    let c = await pool.getPage('C');
    c.release();

    let d = await within(pool.getPage('D'));
    assert.notStrictEqual(
      d,
      'timeout',
      'a brand-new affinity got a tab rather than waiting on the busy LRU affinity',
    );
    if (d !== 'timeout') {
      d.release();
    }

    assert.true(
      pool.getAffinityKeys().includes('A'),
      'the busy affinity was not disposed',
    );
    await waitUntil(
      () => !pool.getAffinityKeys().includes('B'),
      'the least-recently-used idle affinity to be disposed instead',
    );
    assert.false(
      contexts[0].pages[0].closed,
      "the busy affinity's tab was not closed under its render",
    );
  });

  test('with every affinity busy, the refill disposes nothing and settles', async function (assert) {
    let { browserManager, contexts } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    await hold(pool, 'A');
    await hold(pool, 'B');
    await pool.warmStandbys();
    // C takes the standby, so the pool is over its cap with every tab busy.
    await hold(pool, 'C');

    let refill = await within(pool.warmStandbys());
    assert.notStrictEqual(
      refill,
      'timeout',
      'the refill settled instead of waiting on a busy affinity',
    );
    assert.deepEqual(
      pool.getAffinityKeys().sort(),
      ['A', 'B', 'C'],
      'no busy affinity was disposed',
    );
    assert.true(
      contexts.every((context) => !context.closed),
      'no tab or context was closed',
    );
    assert.strictEqual(
      pool.__test_liveTabCount(),
      3,
      'with no idle affinity to give back, the pool runs one tab over its cap',
    );
    assert.strictEqual(
      contexts.length,
      3,
      'and the refill created no further standby past the context budget',
    );
  });

  test('disposing a busy affinity returns within its budget and closes the tab once the render releases', async function (assert) {
    let { browserManager, contexts } = makeBrowserStub();
    let pool = makePool({
      maxPages: 2,
      browserManager,
      affinityTeardownWaitMs: 50,
    });

    let a = await pool.getPage('A');
    let aContext = contexts[0];

    let disposed = await within(pool.disposeAffinity('A'));
    assert.notStrictEqual(
      disposed,
      'timeout',
      'disposeAffinity returned without waiting out the render',
    );
    assert.false(
      pool.getWarmAffinities().includes('A'),
      'the affinity is no longer routable',
    );
    assert.false(
      aContext.pages[0].closed,
      'the tab was not closed out from under the render',
    );
    assert.false(aContext.closed, 'neither was its context');

    a.release();
    await waitUntil(
      () => aContext.closed,
      "the busy tab's context to close once its render released",
    );
    assert.true(aContext.pages[0].closed, 'the tab closed after the release');
  });

  test('a standby commandeered at the cap is paid for by an idle affinity in the same step', async function (assert) {
    let { browserManager } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    let a = await pool.getPage('A');
    a.release();
    let b = await pool.getPage('B');
    b.release();
    await pool.warmStandbys();
    assert.strictEqual(pool.__test_liveTabCount(), 2, 'the pool is at its cap');

    let c = await pool.getPage('C');
    assert.strictEqual(
      pool.__test_liveTabCount(),
      2,
      'live tabs are back at the cap by the time the caller has its tab',
    );
    await waitUntil(
      () => !pool.getAffinityKeys().includes('A'),
      'the least-recently-used idle affinity to be evicted',
    );
    assert.true(
      pool.getAffinityKeys().includes('B'),
      'the more recently used affinity was kept',
    );
    c.release();

    // The evicted tab's close frees its budget, and the refill fills it.
    await pool.warmStandbys();
    assert.strictEqual(
      pool.__test_liveTabCount(),
      2,
      'live tabs stay at the cap once the standby is replaced',
    );
  });

  test('an over-cap pool is trimmed by the next hand-out, not by the release that made an affinity idle', async function (assert) {
    let { browserManager } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    let a = await pool.getPage('A');
    let b = await pool.getPage('B');
    await pool.warmStandbys();
    await hold(pool, 'C');
    assert.strictEqual(
      pool.__test_liveTabCount(),
      3,
      'every tab is busy, so the commandeered standby left the pool over its cap',
    );

    a.release();
    b.release();
    assert.strictEqual(
      pool.__test_liveTabCount(),
      3,
      "releasing doesn't evict, so a caller coming back to its warm tab still finds it",
    );

    let againA = await pool.getPage('A');
    held.push(againA.release);
    assert.true(againA.reused, 'A came back to its warm tab');
    assert.strictEqual(
      pool.__test_liveTabCount(),
      2,
      'handing A its tab trimmed the pool back to its cap',
    );
    await waitUntil(
      () => !pool.getAffinityKeys().includes('B'),
      'the idle affinity to be evicted',
    );
  });

  test('live tabs stay within the cap as contraction lowers it', async function (assert) {
    await withEnv(
      {
        PRERENDER_PAGE_POOL_MIN: '2',
        PRERENDER_PAGE_POOL_MAX: '3',
        PRERENDER_POOL_IDLE_CONTRACTION_MS: '20',
      },
      async () => {
        let { browserManager } = makeBrowserStub();
        let pool = new PagePool({
          maxPages: 3,
          serverURL: 'http://localhost',
          browserManager: browserManager as any,
          boxelHostURL: 'http://localhost:4200',
          standbyTimeoutMs: 500,
          disableFileAdmission: true,
          registerWithManager: false,
          contractionTickMs: 10,
          // Expansion and contraction resize the render semaphore in
          // lockstep, and are inert without one.
          renderSemaphore: new AsyncSemaphore(2),
        });
        pools.push(pool);
        pool.__test_tryExpand();
        assert.strictEqual(pool.currentMaxPages, 3, 'expanded to MAX');

        for (let key of ['A', 'B', 'C']) {
          let page = await pool.getPage(key);
          page.release();
        }
        await pool.warmStandbys();
        assert.strictEqual(
          pool.__test_liveTabCount(),
          3,
          'the pool is at its expanded cap with a standby',
        );

        // Sample on every turn of the event loop while contraction runs, so
        // a window where the cap dropped below the live count is caught.
        let worstOverage = 0;
        let deadline = Date.now() + 2000;
        while (pool.currentMaxPages > 2 && Date.now() < deadline) {
          worstOverage = Math.max(
            worstOverage,
            pool.__test_liveTabCount() - pool.currentMaxPages,
          );
          await new Promise((resolve) => setImmediate(resolve));
        }
        worstOverage = Math.max(
          worstOverage,
          pool.__test_liveTabCount() - pool.currentMaxPages,
        );
        assert.strictEqual(pool.currentMaxPages, 2, 'contracted to MIN');
        assert.strictEqual(
          worstOverage,
          0,
          'live tabs never exceeded the cap while it was lowered',
        );
      },
    );
  });

  test('a brand-new affinity waits for a tab, rather than throwing, when every tab is busy and spoken for', async function (assert) {
    let { browserManager } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    let a = await pool.getPage('A');
    let b = await pool.getPage('B');
    await pool.warmStandbys();
    let c = await pool.getPage('C');
    // A waiter behind every holder leaves nothing to steal, and the budget
    // is spent, so the refill can't make a tab either.
    let waiters = ['A', 'B', 'C'].map((key) => pool.getPage(key));

    let settled: 'pending' | 'resolved' | 'rejected' = 'pending';
    let d = pool.getPage('D').then(
      (page) => {
        settled = 'resolved';
        return page;
      },
      (error) => {
        settled = 'rejected';
        throw error;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(settled, 'pending', 'D waits instead of throwing');

    a.release();
    b.release();
    c.release();
    for (let waiter of waiters) {
      (await waiter).release();
    }
    let page = await within(d);
    assert.notStrictEqual(page, 'timeout', 'D got a tab once others freed');
    if (page !== 'timeout') {
      page.release();
    }
  });

  test('a module sub-render with every tab busy waits for budget instead of queueing behind its own parent render', async function (assert) {
    let { browserManager } = makeBrowserStub();
    let pool = makePool({ maxPages: 2, browserManager });

    let b = await pool.getPage('B');
    let parent = await hold(pool, 'A');
    await pool.warmStandbys();
    await hold(pool, 'C');

    let sub = pool.getPage('A', 'module');
    b.release();

    let page = await within(sub);
    assert.notStrictEqual(
      page,
      'timeout',
      'the sub-render got a tab while its parent still held the affinity’s own',
    );
    if (page !== 'timeout') {
      assert.notStrictEqual(
        page.pageId,
        parent.pageId,
        'on a tab other than the parent render’s',
      );
      page.release();
    }
  });

  test('evicted tabs stay in the context budget until their close lands', async function (assert) {
    let { browserManager, open } = makeBrowserStub({ closeDelayMs: 100 });
    let pool = makePool({ maxPages: 2, browserManager });

    for (let key of ['A', 'B', 'C', 'D', 'E', 'F']) {
      let page = await within(pool.getPage(key));
      assert.notStrictEqual(page, 'timeout', `${key} got a tab`);
      if (page !== 'timeout') {
        page.release();
      }
    }
    assert.true(
      open.peak <= 3,
      `open contexts never exceeded maxPages + 1 (peak ${open.peak})`,
    );
  });
});
