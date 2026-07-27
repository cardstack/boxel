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
// a failure means the thread cannot run script at all. The affinity's tabs
// are then retired — they share a BrowserContext, hence a renderer process
// and a JS thread — and the caller re-selects a live tab.

type StubPage = {
  // Flips `evaluate` from "answers immediately" to the failure mode under
  // test, standing in for a tab whose thread never comes back (`'hang'`) or
  // whose target is gone (`'reject'`).
  wedge: (mode: 'hang' | 'reject') => void;
  closed: boolean;
  evaluateCalls: number;
};

function makeBrowserStub() {
  let pages: StubPage[] = [];
  let browser = {
    async createBrowserContext() {
      let context: any;
      context = {
        async newPage() {
          let wedged: 'hang' | 'reject' | undefined;
          let page: any = {
            async goto() {
              return undefined;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              page.evaluateCalls++;
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
              page.closed = true;
            },
            browserContext() {
              return context;
            },
            on() {},
            off() {},
            removeAllListeners() {},
            closed: false,
            evaluateCalls: 0,
            wedge(mode: 'hang' | 'reject') {
              wedged = mode;
            },
          };
          pages.push(page as StubPage);
          return page;
        },
        async close() {},
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
    pages,
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
  function makePool(tabHealthProbeMs: number) {
    let { manager, pages } = makeBrowserStub();
    let pool = new PagePool({
      maxPages: 2,
      serverURL: 'http://localhost',
      browserManager: manager as any,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      tabHealthProbeMs,
    });
    pools.push(pool);
    return { pool, pages };
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
  async function waitForClose(page: StubPage, label: string): Promise<void> {
    let deadline = Date.now() + 1000;
    while (!page.closed) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for: ${label}`);
      }
      await new Promise<void>((r) => setTimeout(r, 2));
    }
  }

  test('a warm tab whose thread never answers is retired and the caller gets a different tab', async function (assert) {
    let { pool, pages } = makePool(50);
    let firstPageId = await warmAffinityA(pool);

    // The tab's thread stops answering after its visit ended — the state a
    // never-settling render leaves behind.
    let wedgedPage = pages[0];
    wedgedPage.wedge('hang');

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
    await waitForClose(wedgedPage, 'the wedged tab to be closed');
    assert.true(
      wedgedPage.closed,
      'the wedged tab is torn down rather than left in the pool for the next caller',
    );

    second.release();
  });

  test('a warm tab whose evaluate rejects outright is retired the same way', async function (assert) {
    let { pool, pages } = makePool(50);
    let firstPageId = await warmAffinityA(pool);

    // A dead target rejects rather than hanging. Same conclusion: the page
    // cannot run our script, so it must not be handed to a visit.
    pages[0].wedge('reject');

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

  test('the gate is off at probe budget 0 — the wedged tab is handed back out', async function (assert) {
    let { pool, pages } = makePool(0);
    let firstPageId = await warmAffinityA(pool);

    pages[0].wedge('hang');

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
      pages[0].closed,
      'the wedged tab stays in the pool with the gate disabled',
    );

    second.release();
  });
});
