import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { RenderError } from '@cardstack/runtime-common';
import { PagePool } from '../prerender/page-pool.ts';
import { RenderRunner } from '../prerender/render-runner.ts';
import {
  UnresponsiveTabTracker,
  type UnresponsiveTabReport,
} from '../prerender/unresponsive-tab-tracker.ts';

// A render whose tab stops answering CDP must give its tab back on a Node
// clock: the render timeout, then the bounded hang diagnostics, then the
// eviction that retires the tab. Nothing on that path may wait for the wedged
// renderer to answer, because every CDP call against it waits out the
// protocol timeout — minutes — and the render holds its tab lease all the
// while.
//
// The stub tab here answers normally until the render starts, then stops
// answering everything: `page.evaluate` and every CDP session command hang
// forever. That is the shape a renderer pegged by the card it is rendering
// presents to the prerender server.

// The route names a render transitions to. The evaluates before the
// transition — session setup, the visit's host-capabilities read and its card
// source stash — answer normally.
const RENDER_ROUTES = new Set([
  'module',
  'render.html',
  'render.meta',
  'render.icon',
  'render.file-extract',
]);

type StubTab = {
  pageId?: string;
  closed: boolean;
};

// `wedgeOn`: what stops answering once the render transitions to its route.
//   'everything' — the renderer is pegged: evaluates and CDP commands hang.
//   'render'     — only the render itself never settles; the thread is free.
function makeBrowserStub(wedgeOn: 'everything' | 'render') {
  let tabs: StubTab[] = [];
  let browser = {
    async createBrowserContext() {
      let contextTabs: StubTab[] = [];
      let context: any = {
        async close() {
          for (let tab of contextTabs) {
            tab.closed = true;
          }
        },
        async newPage() {
          let tab: StubTab = { closed: false };
          let wedged = false;
          let never = () => new Promise<never>(() => {});
          let page: any = {
            async goto() {
              return undefined;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(_fn: unknown, ...args: any[]) {
              if (wedged) {
                return never();
              }
              // `transitionTo(page, <route>, …)` starts the render.
              if (RENDER_ROUTES.has(args[0])) {
                if (wedgeOn === 'everything') {
                  wedged = true;
                }
                return never();
              }
              return undefined;
            },
            async createCDPSession() {
              return {
                send: async () => (wedged ? never() : {}),
                once() {},
                on() {},
                off() {},
                async detach() {},
              };
            },
            isClosed() {
              return tab.closed;
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
  };
}

const ENV_KEYS = [
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
  'PRERENDER_PROFILE_AFFINITY',
  'PRERENDER_V8_PROF',
  'RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS',
];

// Long enough for the 2 s responsiveness probe to land, so the timeout's
// diagnostics say whether the tab was answering; short of the captures that
// follow it, so a tab that never answers runs the budget out.
const DIAGNOSTICS_BUDGET_MS = 3000;
const RENDER_TIMEOUT_MS = 200;
// Scheduling slack on top of the render timeout and the diagnostics budget.
const MARGIN_MS = 1500;

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.PRERENDER_PAGE_POOL_MIN = '1';
    process.env.PRERENDER_PAGE_POOL_MAX = '2';
    process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
    process.env.RENDER_TIMEOUT_DIAGNOSTICS_BUDGET_MS = String(
      DIAGNOSTICS_BUDGET_MS,
    );
  });

  hooks.afterEach(async () => {
    for (let pool of pools.splice(0)) {
      try {
        await pool.closeAll();
      } catch {
        // best-effort
      }
    }
    for (let key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    savedEnv = {};
  });

  function setup(wedgeOn: 'everything' | 'render') {
    let { manager, tabs } = makeBrowserStub(wedgeOn);
    let pool = new PagePool({
      maxPages: 2,
      serverURL: 'http://localhost',
      browserManager: manager as any,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
      tabHealthProbeMs: 50,
    });
    pools.push(pool);
    let reports: UnresponsiveTabReport[] = [];
    let runner = new RenderRunner({
      pagePool: pool,
      boxelHostURL: 'http://localhost:4200',
      onUnresponsiveTab: (report) => reports.push(report),
    });
    return { pool, runner, tabs, reports };
  }

  function renderModule(runner: RenderRunner) {
    return runner.prerenderModuleAttempt({
      affinityType: 'user',
      affinityValue: 'wedged-user',
      realm: 'http://localhost:4201/wedged/',
      url: 'http://localhost:4201/wedged/pegged.gts',
      auth: '{}',
      opts: { timeoutMs: RENDER_TIMEOUT_MS },
    });
  }

  // A visit that hands the card's source along, so the render stashes it on
  // the tab before rendering and clears it again in the visit's `finally`.
  function renderVisitWithStash(runner: RenderRunner) {
    return runner.prerenderVisitAttempt({
      affinityType: 'user',
      affinityValue: 'wedged-user',
      realm: 'http://localhost:4201/wedged/',
      url: 'http://localhost:4201/wedged/pegged.json',
      auth: '{}',
      renderOptions: { cardRender: true },
      cardSource: {
        source: '{"data":{}}',
        realmURL: 'http://localhost:4201/wedged/',
        lastModified: 0,
      },
      opts: { timeoutMs: RENDER_TIMEOUT_MS },
    });
  }

  async function waitFor(condition: () => boolean, label: string) {
    let deadline = Date.now() + 2000;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for: ${label}`);
      }
      await new Promise<void>((r) => setTimeout(r, 5));
    }
  }

  test('a render whose tab stops answering CDP gives its tab back within the deadline', async function (assert) {
    let { pool, runner, tabs, reports } = setup('everything');
    await pool.warmStandbys();

    let startedAt = Date.now();
    let { response, pool: poolInfo } = await renderModule(runner);
    let elapsedMs = Date.now() - startedAt;

    assert.strictEqual(
      response.error?.error.title,
      'Render timeout',
      'the render reports a timeout',
    );
    assert.true(
      elapsedMs < RENDER_TIMEOUT_MS + DIAGNOSTICS_BUDGET_MS + MARGIN_MS,
      `the render returned within its timeout plus the diagnostics budget (took ${elapsedMs}ms)`,
    );
    assert.true(poolInfo.evicted, 'the timed-out tab was evicted');
    assert.false(
      (response.error as RenderError | undefined)?.diagnostics
        ?.mainThreadResponsive,
      'the diagnostics record that the tab had stopped answering',
    );

    let wedgedTab = tabs[0];
    await waitFor(() => wedgedTab.closed, 'the wedged tab to close');
    assert.true(wedgedTab.closed, 'the wedged tab was retired');

    let next = await pool.getPage('user:wedged-user', 'module');
    assert.notStrictEqual(
      next.pageId,
      poolInfo.pageId,
      'the next render of the affinity runs on a fresh tab',
    );
    next.release();

    assert.deepEqual(
      reports,
      [{ affinityKey: 'user:wedged-user', browserUnresponsive: false }],
      'the unresponsive tab was reported to the browser-recycle decision',
    );
  });

  // A visit that stashed render data clears it from the tab once it ends.
  // On a tab that stopped answering, that cleanup would wait as long as any
  // other CDP call, so it must not run on a tab the timeout evicted.
  test('a visit whose tab stops answering CDP gives its tab back within the deadline', async function (assert) {
    let { pool, runner, tabs } = setup('everything');
    await pool.warmStandbys();

    let startedAt = Date.now();
    let { response, pool: poolInfo } = await renderVisitWithStash(runner);
    let elapsedMs = Date.now() - startedAt;

    assert.strictEqual(
      response.card?.error?.error.title,
      'Render timeout',
      'the card render reports a timeout',
    );
    assert.true(
      elapsedMs < RENDER_TIMEOUT_MS + DIAGNOSTICS_BUDGET_MS + MARGIN_MS,
      `the visit returned within its timeout plus the diagnostics budget (took ${elapsedMs}ms)`,
    );
    assert.true(poolInfo.evicted, 'the timed-out tab was evicted');
    let wedgedTab = tabs[0];
    await waitFor(() => wedgedTab.closed, 'the wedged tab to close');
    assert.true(wedgedTab.closed, 'the wedged tab was retired');
  });

  test('a render that times out on a tab that still answers is not reported as unresponsive', async function (assert) {
    let { pool, runner, reports } = setup('render');
    await pool.warmStandbys();

    let { response, pool: poolInfo } = await renderModule(runner);

    assert.strictEqual(
      response.error?.error.title,
      'Render timeout',
      'the render reports a timeout',
    );
    assert.true(poolInfo.evicted, 'the timed-out tab is still evicted');
    assert.true(
      (response.error as RenderError | undefined)?.diagnostics
        ?.mainThreadResponsive,
      'the diagnostics record that the tab was answering',
    );
    assert.deepEqual(reports, [], 'nothing was reported');
  });

  module('UnresponsiveTabTracker', function () {
    function trackerAt(clock: { now: number }) {
      return new UnresponsiveTabTracker({
        affinityThreshold: 3,
        attachThreshold: 2,
        windowMs: 1000,
        minRecycleIntervalMs: 5000,
        now: () => clock.now,
      });
    }

    test('one affinity timing out repeatedly never recycles the browser', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      for (let i = 0; i < 10; i++) {
        clock.now += 10;
        assert.strictEqual(
          tracker.record({ affinityKey: 'A', browserUnresponsive: false }),
          null,
          `timeout ${i + 1} on the same affinity`,
        );
      }
    });

    test('distinct affinities going unresponsive within the window recycle the browser', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      assert.strictEqual(
        tracker.record({ affinityKey: 'A', browserUnresponsive: false }),
        null,
      );
      clock.now = 400;
      assert.strictEqual(
        tracker.record({ affinityKey: 'B', browserUnresponsive: false }),
        null,
      );
      clock.now = 800;
      let reason = tracker.record({
        affinityKey: 'C',
        browserUnresponsive: false,
      });
      assert.ok(reason, 'the third distinct affinity recycles the browser');
      assert.ok(reason?.includes('A, B, C'), `names the affinities: ${reason}`);
      assert.strictEqual(tracker.recycleCount, 1, 'the recycle is counted');
    });

    test('affinities seen outside the window do not count', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      tracker.record({ affinityKey: 'A', browserUnresponsive: false });
      clock.now = 600;
      tracker.record({ affinityKey: 'B', browserUnresponsive: false });
      clock.now = 1500;
      assert.strictEqual(
        tracker.record({ affinityKey: 'C', browserUnresponsive: false }),
        null,
        'A aged out of the window',
      );
    });

    test('one timed-out attach is not enough; a second within the window recycles', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      assert.strictEqual(
        tracker.record({ affinityKey: 'A', browserUnresponsive: true }),
        null,
        'a single timed-out attach does not recycle',
      );
      clock.now = 500;
      let reason = tracker.record({
        affinityKey: 'A',
        browserUnresponsive: true,
      });
      assert.ok(reason, 'the second one does');
      assert.ok(reason?.includes('CDP session attach'), `says why: ${reason}`);
    });

    test('recycles are spaced at least the minimum interval apart', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      let wedgeThree = (prefix: string) => {
        let reason: string | null = null;
        for (let key of ['A', 'B', 'C']) {
          reason = tracker.record({
            affinityKey: `${prefix}${key}`,
            browserUnresponsive: false,
          });
        }
        return reason;
      };
      assert.ok(wedgeThree('first-'), 'the first burst recycles');
      clock.now = 2000;
      assert.strictEqual(
        wedgeThree('second-'),
        null,
        'a second burst inside the interval does not',
      );
      clock.now = 5500;
      assert.ok(wedgeThree('third-'), 'one after the interval does');
      assert.strictEqual(tracker.recycleCount, 2, 'two recycles counted');
    });

    test('reset forgets the affinities counted so far', function (assert) {
      let clock = { now: 0 };
      let tracker = trackerAt(clock);
      tracker.record({ affinityKey: 'A', browserUnresponsive: false });
      tracker.record({ affinityKey: 'B', browserUnresponsive: false });
      tracker.reset();
      assert.strictEqual(
        tracker.record({ affinityKey: 'C', browserUnresponsive: false }),
        null,
      );
    });
  });
});
