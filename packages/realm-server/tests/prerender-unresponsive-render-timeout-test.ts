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
              // `transitionTo(page, 'module', …)` starts the render.
              if (args[0] === 'module') {
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
        threshold: 3,
        windowMs: 1000,
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

      clock.now = 900;
      assert.strictEqual(
        tracker.record({ affinityKey: 'D', browserUnresponsive: false }),
        null,
        'a recycle starts the count over',
      );
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

    test('a browser that stops answering recycles at once', function (assert) {
      let tracker = trackerAt({ now: 0 });
      let reason = tracker.record({
        affinityKey: 'A',
        browserUnresponsive: true,
      });
      assert.ok(reason, 'recycles on the first report');
      assert.ok(reason?.includes('CDP session attach'), `says why: ${reason}`);
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
