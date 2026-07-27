import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';

// Responsiveness gate on tab reuse.
//
// A render that never settles leaves its tab holding the renderer's JS
// thread. The tab stays in the pool, because eviction keys off the outcome
// of the visit that ran on it — which misses a visit that reported success
// and left the thread busy behind it. The next visit routed to that tab
// then stalls from its first CDP call and only the render timeout ends it,
// minutes of capacity later.
//
// PagePool probes a warm tab's main thread before handing it back out: one
// trivial `page.evaluate` under a short budget. A tab whose thread is free
// answers in about a millisecond regardless of what its last render did, so
// a failure means the thread cannot run script at all. That one tab is
// retired — every pool entry has its own BrowserContext, so its siblings
// are on their own renderer processes and aren't implicated — and the
// caller re-selects a live tab. Retiring the affinity's last tab is an
// affinity teardown, and is skipped entirely when the pool has no
// replacement to offer.

// Observation record for one stub tab, kept beside the puppeteer-shaped page
// rather than on it so tests read live state (the page's own methods mutate
// this record). `page` / `context` let a test match a `getPage` result back to
// its tab, and tell tabs that share a renderer from tabs that don't.
type StubTab = {
  page: unknown;
  context: unknown;
  closed: boolean;
  evaluateCalls: number;
  // Flips `evaluate` between answering immediately and the failure mode
  // under test: a tab whose thread never comes back (`'hang'`) or whose
  // target is gone (`'reject'`). `undefined` restores a healthy tab.
  wedge: (mode?: 'hang' | 'reject') => void;
};

function makeBrowserStub() {
  let tabs: StubTab[] = [];
  // When set, every page the stub creates is born wedged. Racing a wedge
  // against the pool's own tab creation from the test body can't reach the
  // "no live tab anywhere" state deterministically — the pool wins often
  // enough that the test passes on a healthy replacement instead of the
  // path it names.
  let wedgeAtBirth: 'hang' | 'reject' | undefined;
  let browser = {
    async createBrowserContext() {
      let context: any;
      let contextTabs: StubTab[] = [];
      context = {
        // Closing a BrowserContext takes its pages down with it. Modelling
        // that matters: `#closeEntry` closes the context rather than the
        // page whenever the entry owns its context, so a no-op here would
        // leave `closed` false for a tab that really was torn down and any
        // assertion about a surviving tab would hold vacuously.
        async close() {
          for (let tab of contextTabs) {
            tab.closed = true;
          }
        },
        async newPage() {
          let wedged: 'hang' | 'reject' | undefined = wedgeAtBirth;
          let tab: StubTab = {
            page: undefined,
            context,
            closed: false,
            evaluateCalls: 0,
            wedge(mode?: 'hang' | 'reject') {
              wedged = mode;
            },
          };
          let page: any = {
            async goto() {
              return undefined;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              tab.evaluateCalls++;
              if (wedged === 'hang') {
                // Never settles — the probe's budget timer decides.
                return new Promise(() => {});
              }
              if (wedged === 'reject') {
                throw new Error('Target closed');
              }
              return typeof fn === 'function' ? fn(...args) : undefined;
            },
            async close() {
              tab.closed = true;
            },
            browserContext() {
              return context;
            },
            on() {},
            off() {},
            removeAllListeners() {},
          };
          tab.page = page;
          tabs.push(tab);
          contextTabs.push(tab);
          return page;
        },
      };
      return context;
    },
  };
  return {
    manager: {
      async getBrowser() {
        return browser as any;
      },
      async cleanupUserDataDirs() {},
    },
    tabs,
    wedgeEveryNewPage(mode: 'hang' | 'reject') {
      wedgeAtBirth = mode;
      for (let tab of tabs) {
        tab.wedge(mode);
      }
    },
  };
}

// Env vars that reshape the pool envelope. The dev-stack shell sets some of
// these, which would change how many tabs an affinity may hold and thus
// which selection branch the re-selection lands on. Clear them so the pool
// runs in the deterministic shape these tests drive, then restore.
const POOL_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_AFFINITY_TAB_MAX',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_HIGH_PRIORITY_THRESHOLD',
  'PRERENDER_AFFINITY_FILE_CONCURRENCY',
  'PRERENDER_POOL_IDLE_CONTRACTION_MS',
  'PRERENDER_SHARED_CONTEXT_CAP',
  'PRERENDER_TAB_HEALTH_PROBE_MS',
];

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of POOL_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // One tab per affinity, with a standby slot available for the
    // re-selection to land on.
    process.env.PRERENDER_PAGE_POOL_MIN = '1';
    process.env.PRERENDER_PAGE_POOL_MAX = '2';
    process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
  });

  hooks.afterEach(async () => {
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
    for (let key of POOL_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    savedEnv = {};
  });

  // `tabHealthProbeMs` is deliberately tiny: the stub answers a healthy
  // probe synchronously, so the budget only bounds how long the wedged
  // cases take to be recognized.
  function makePool(
    tabHealthProbeMs: number,
    opts?: { maxPages?: number; disableStandbyRefill?: boolean },
  ) {
    let { manager, tabs, wedgeEveryNewPage } = makeBrowserStub();
    let pool = new PagePool({
      maxPages: opts?.maxPages ?? 2,
      serverURL: 'http://localhost',
      browserManager: manager as any,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      tabHealthProbeMs,
      ...(opts?.disableStandbyRefill ? { disableStandbyRefill: true } : {}),
    });
    pools.push(pool);
    return { pool, tabs, wedgeEveryNewPage };
  }

  // Warm affinity 'A', hand its tab back, and leave a standby ready so the
  // next selection has somewhere to go.
  async function warmAffinityA(pool: PagePool): Promise<string> {
    let first = await pool.getPage('A');
    first.release();
    await pool.warmStandbys();
    return first.pageId;
  }

  // Retirement is deliberately not awaited by the caller — the tab is
  // marked closing synchronously and Chrome catches up afterwards — so
  // assertions about the close poll for it.
  async function waitForClose(tab: StubTab, label: string): Promise<void> {
    let deadline = Date.now() + 1000;
    while (!tab.closed) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for: ${label}`);
      }
      await new Promise<void>((r) => setTimeout(r, 2));
    }
  }

  test('a warm tab whose thread never answers is retired and the caller gets a different tab', async function (assert) {
    let { pool, tabs } = makePool(50);
    let firstPageId = await warmAffinityA(pool);

    // The tab's thread stops answering after its visit ended — the state a
    // never-settling render leaves behind.
    let wedgedTab = tabs[0];
    wedgedTab.wedge('hang');

    let second = await pool.getPage('A');

    assert.notStrictEqual(
      second.pageId,
      firstPageId,
      'the caller was handed a different tab, not the wedged one',
    );
    assert.false(
      second.reused,
      'the replacement is a live tab taken from the standby pool, not a reuse',
    );
    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      { A: 1 },
      'the swap is counted against the affinity that produced it',
    );
    assert.true(
      second.waits.tabProbeMs >= 50,
      `the probe budget is attributed to tabProbeMs (was ${second.waits.tabProbeMs}ms)`,
    );
    assert.true(
      second.waits.tabQueueMs < 50,
      `probe time is kept out of tabQueueMs, which means warm-tab serialization (was ${second.waits.tabQueueMs}ms)`,
    );
    await waitForClose(wedgedTab, 'the wedged tab to be closed');
    assert.true(
      wedgedTab.closed,
      'the wedged tab is torn down rather than left in the pool for the next caller',
    );

    second.release();
  });

  test('a warm tab whose evaluate rejects outright is retired the same way', async function (assert) {
    let { pool, tabs } = makePool(50);
    let firstPageId = await warmAffinityA(pool);

    // A dead target rejects rather than hanging. Same conclusion: the page
    // cannot run our script, so it must not be handed to a visit.
    tabs[0].wedge('reject');

    let second = await pool.getPage('A');

    assert.notStrictEqual(
      second.pageId,
      firstPageId,
      'the caller was handed a different tab',
    );
    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      { A: 1 },
      'the rejection counts as an unresponsive swap',
    );

    second.release();
  });

  test('a responsive warm tab is still reused (the probe does not churn healthy tabs)', async function (assert) {
    let { pool } = makePool(50);
    let firstPageId = await warmAffinityA(pool);

    let second = await pool.getPage('A');

    assert.strictEqual(
      second.pageId,
      firstPageId,
      'the warm tab was handed back out',
    );
    assert.true(second.reused, 'the hand-off is reported as a reuse');
    assert.deepEqual(pool.getUnresponsiveTabSwaps(), {}, 'nothing was retired');

    second.release();
  });

  test('a sibling tab of the same affinity survives the retirement', async function (assert) {
    // Every pool entry gets its own BrowserContext, hence its own renderer
    // process and its own JS thread, so one tab failing its probe says
    // nothing about the affinity's other tabs. They keep running and are
    // each gated by their own probe on their next reuse.
    process.env.PRERENDER_PAGE_POOL_MIN = '2';
    process.env.PRERENDER_PAGE_POOL_MAX = '4';
    process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
    let { pool, tabs } = makePool(50);
    await pool.warmStandbys();

    // Hold the first tab's lease so the second caller has to materialize a
    // second tab for the affinity rather than queueing on the first.
    let first = await pool.getPage('A');
    let second = await pool.getPage('A');
    assert.notStrictEqual(
      first.pageId,
      second.pageId,
      'the affinity holds two distinct tabs',
    );
    let firstTab = tabs.find((t) => t.page === first.page)!;
    let siblingTab = tabs.find((t) => t.page === second.page)!;
    assert.notStrictEqual(
      firstTab.context,
      siblingTab.context,
      'the two tabs sit on different BrowserContexts',
    );
    first.release();
    second.release();

    firstTab.wedge('hang');
    // The wedged tab is the least recently used of the two, so selection
    // lands on it.
    let third = await pool.getPage('A');

    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      { A: 1 },
      'the failed probe was recorded',
    );
    await waitForClose(firstTab, 'the wedged tab to be closed');
    assert.false(siblingTab.closed, 'the sibling was left running');
    assert.notStrictEqual(
      third.pageId,
      first.pageId,
      'the caller did not get the wedged tab',
    );
    // The affinity is still live — retiring one of several tabs is not an
    // affinity teardown, so the realm keeps its warm state.
    assert.true(
      pool.getWarmAffinities().includes('A'),
      'the affinity survives a single-tab retirement',
    );

    third.release();
  });

  test('an abort cuts the probe short without retiring the tab', async function (assert) {
    // The probe holds the tab lease and the affinity's admission permit
    // while it waits, so a caller that goes away has to be released
    // promptly rather than at the end of the budget. And an abandoned probe
    // says nothing about the page — concluding "wedged" from it would cost
    // the pool a warm tab over a cancellation.
    let budgetMs = 5000;
    let { pool, tabs } = makePool(budgetMs);
    await warmAffinityA(pool);
    tabs[0].wedge('hang');

    let controller = new AbortController();
    let startedAt = Date.now();
    // Fire once the probe is in flight, so the abort races the probe rather
    // than the pre-selection abort check.
    let abortTimer = setTimeout(() => controller.abort('caller went away'), 25);
    let outcome = await pool
      .getPage('A', 'file', { signal: controller.signal })
      .then(
        (page) => {
          page.release();
          return 'resolved';
        },
        (e: Error) => e.name,
      );
    clearTimeout(abortTimer);
    let elapsed = Date.now() - startedAt;

    assert.strictEqual(
      outcome,
      'PrerenderCancelledError',
      'the call bails out on the abort',
    );
    assert.true(
      elapsed < budgetMs / 2,
      `the probe did not hold the caller for its budget (returned after ${elapsed}ms of ${budgetMs}ms)`,
    );
    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      {},
      'nothing was retired on the strength of an abandoned probe',
    );
    assert.false(tabs[0].closed, 'the warm tab is still in the pool');
  });

  test('a wedged tab is handed back rather than erroring the caller', async function (assert) {
    // Re-selection is bounded, and every tab the pool can produce is
    // wedged here, so the loop necessarily runs out of options. The caller
    // must end up holding a tab: the render timeout is a failure mode
    // callers already handle, whereas a tab-selection error is one the
    // Prerenderer answers by restarting the whole browser. Whatever it
    // gets must not be a page already marked closing under it.
    let budgetMs = 20;
    let { pool, tabs, wedgeEveryNewPage } = makePool(budgetMs);
    await warmAffinityA(pool);
    wedgeEveryNewPage('hang');

    let result = await pool.getPage('A');

    assert.ok(result.pageId, 'the caller still got a tab');
    assert.true(
      result.waits.tabProbeMs >= budgetMs,
      `probe time across the attempts is reported (was ${result.waits.tabProbeMs}ms)`,
    );
    let handedBack = tabs.find((t) => t.page === result.page)!;
    assert.false(
      handedBack.closed,
      'the tab handed back is not one that was already closed',
    );
    // Retirement stops short of the re-selection budget rather than
    // emptying the pool of tabs chasing a healthy one.
    let swaps = pool.getUnresponsiveTabSwaps()['A'] ?? 0;
    assert.true(swaps >= 1, `the wedged warm tab was retired (was ${swaps})`);
    assert.true(
      swaps < 3,
      `retirement did not consume every re-selection attempt (was ${swaps})`,
    );

    result.release();
  });

  test('a wedged tab is kept when the pool has no replacement to offer', async function (assert) {
    // Retiring the last tab an affinity can get would leave selection with
    // nothing to return; it throws in that case, and the Prerenderer turns
    // a non-cancel throw from a visit into a full browser restart. One
    // realm's wedged tab must not cost every affinity on the server its
    // warm state, so the gate declines to retire and rides the wedge out.
    // A pool pinned to a single tab, with that tab bound to the affinity:
    // no second live tab, no expansion budget, and — because the refill is
    // off once a tab is in use — no dormant standby either. So there is
    // provably nothing to swap in. (The refill still warms the pool while
    // it holds no tabs, which is how the affinity gets its one tab.)
    for (let key of ['PRERENDER_PAGE_POOL_MIN', 'PRERENDER_PAGE_POOL_MAX']) {
      delete process.env[key];
    }
    process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
    let { pool, tabs } = makePool(20, {
      maxPages: 1,
      disableStandbyRefill: true,
    });
    await pool.warmStandbys();
    let first = await pool.getPage('A');
    first.release();
    tabs[0].wedge('hang');

    let result = await pool.getPage('A');

    assert.strictEqual(
      result.pageId,
      first.pageId,
      'the caller was handed the wedged tab rather than an error',
    );
    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      {},
      'nothing was retired, because nothing could replace it',
    );
    assert.false(tabs[0].closed, 'the wedged tab is still in the pool');

    result.release();
  });

  test('an abort during a stolen tab’s probe leaves the donor stealable', async function (assert) {
    // A cross-affinity steal hands out another realm's warm tab, so the
    // probe covers it too. The steal marks the donor `transitioning` for the
    // duration of the migration, and the probe is now the longest thing
    // inside that window — so the abort path has to clear the mark. A
    // stranded `transitioning` flag is permanent: it bars the tab from every
    // future steal and from the contraction loop's idleness test.
    for (let key of ['PRERENDER_PAGE_POOL_MIN', 'PRERENDER_PAGE_POOL_MAX']) {
      delete process.env[key];
    }
    process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
    let { pool, tabs } = makePool(5000, {
      maxPages: 1,
      disableStandbyRefill: true,
    });
    await pool.warmStandbys();
    // 'A' takes the pool's only tab and hands it back, so it is idle and
    // stealable but cannot be replaced by a standby.
    let donor = await pool.getPage('A');
    donor.release();
    tabs[0].wedge('hang');

    // 'B' is brand new: no tab of its own, no standby, no expansion budget,
    // so selection falls through to stealing A's idle tab — and probes it.
    let controller = new AbortController();
    let abortTimer = setTimeout(() => controller.abort('caller went away'), 25);
    let stolen = await pool
      .getPage('B', 'file', { signal: controller.signal })
      .then(
        (page) => {
          page.release();
          return 'resolved';
        },
        (e: Error) => e.name,
      );
    clearTimeout(abortTimer);
    assert.strictEqual(
      stolen,
      'PrerenderCancelledError',
      'the steal was abandoned by the abort',
    );

    // The donor answers again, so a later steal has no reason to fail —
    // unless the abandoned migration left the tab marked in transition.
    tabs[0].wedge();
    let next = await pool.getPage('C');
    assert.strictEqual(
      next.pageId,
      donor.pageId,
      'a later affinity could still steal the donor tab',
    );
    next.release();
  });

  test('the gate is off at probe budget 0 — the wedged tab is handed back out', async function (assert) {
    let { pool, tabs } = makePool(0);
    let firstPageId = await warmAffinityA(pool);

    tabs[0].wedge('hang');

    let second = await pool.getPage('A');

    assert.strictEqual(
      second.pageId,
      firstPageId,
      'with the gate disabled the pool hands the wedged tab straight back out',
    );
    assert.deepEqual(
      pool.getUnresponsiveTabSwaps(),
      {},
      'no probe ran, so nothing was retired',
    );
    assert.false(
      tabs[0].closed,
      'the wedged tab stays in the pool with the gate disabled',
    );

    second.release();
  });
});
