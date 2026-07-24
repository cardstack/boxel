import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';

// Tab-queue lease revalidation.
//
// When a render ends on a pooled tab, `finally { release() }` hands the
// tab-queue lease to the next same-affinity waiter BEFORE the caller's
// error propagates up to any teardown. A `rendering`-state cancel or a
// render-error eviction then disposes the tab in that window. A waiter
// parked on the tab's `TabQueue` that received the lease with no
// revalidation would start its visit on a page being closed under it —
// its first CDP call rejects with a raw protocol error (not a
// `PrerenderCancelledError`), which routes the whole visit through a
// full-pool browser restart paid by a bystander.
//
// PagePool revalidates the entry after each selection resolves: a doomed
// lease (entry marked `closing`, or detached from `#affinityPages`) is
// released — which also lets the dispose path's own close proceed — and
// the caller re-selects a live tab.

function makeBrowserStub() {
  let browser = {
    async createBrowserContext() {
      let context: any;
      context = {
        async newPage() {
          return {
            async goto() {
              return undefined;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: any, ...args: any[]) {
              return typeof fn === 'function' ? fn(...args) : undefined;
            },
            async close() {},
            browserContext() {
              return context;
            },
            on() {},
            off() {},
            removeAllListeners() {},
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
}

// Env vars that reshape the pool envelope (dynamic min/max, tab cap,
// high-priority tier). The dev-stack shell sets some of these, which
// would let an affinity hold multiple tabs and stop the second caller
// from parking. Clear them so the pool runs in the deterministic
// legacy-fixed shape this test drives, then restore.
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
];

module(basename(import.meta.filename), function (hooks) {
  let pools: PagePool[] = [];
  let savedEnv: Record<string, string | undefined> = {};

  hooks.beforeEach(() => {
    for (let key of POOL_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // Pin a one-tab-per-affinity envelope so the second same-affinity
    // caller parks on the tab's queue rather than spawning a second
    // tab. A small dynamic envelope (min < max) keeps a standby slot
    // available for the re-selection to land on and avoids the
    // legacy-fixed single-tab deadlock warning; `file` callers still
    // can't expand past the per-affinity cap, so they park.
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

  // The pool envelope comes from the env pinned in beforeEach; the
  // `maxPages` option below is a floor the dynamic knobs override.
  function makePool(): PagePool {
    let pool = new PagePool({
      maxPages: 2,
      serverURL: 'http://localhost',
      browserManager: makeBrowserStub() as any,
      boxelHostURL: 'http://localhost:4200',
      standbyTimeoutMs: 500,
      disableFileAdmission: true,
    });
    pools.push(pool);
    return pool;
  }

  async function waitFor(
    fn: () => boolean,
    label: string,
    timeoutMs = 1000,
  ): Promise<void> {
    let start = Date.now();
    while (!fn()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`timed out waiting for: ${label}`);
      }
      await new Promise<void>((r) => setTimeout(r, 2));
    }
  }

  // Live count on the affinity's tab queue(s): active holder + queued
  // waiters. Reaching 2 confirms the second caller has parked behind the
  // holder rather than spawning a second tab.
  function affinityPending(pool: PagePool, affinityKey: string): number {
    let row = pool
      .getQueueDepthSnapshot()
      .affinities.find((a) => a.affinityKey === affinityKey);
    return row?.pendingTotal ?? 0;
  }

  test('parked waiter re-selects a live tab when its tab is disposed via a rendering-state cancel (awaitIdle: true)', async function (assert) {
    let pool = makePool();

    // Warm affinity 'A' and keep the lease held — the in-flight render.
    let held = await pool.getPage('A');
    // One warm standby: the fresh tab the re-selection lands on.
    await pool.warmStandbys();

    // A second same-affinity caller. 'A' is at its one-tab cap, so this
    // parks on the tab's queue rather than spawning a second tab.
    let waiterPromise = pool.getPage('A');
    await waitFor(
      () => affinityPending(pool, 'A') >= 2,
      'second caller parked on the tab queue',
    );

    // Release-then-dispose, synchronously and in that order — exactly
    // the ordering `finally { release() }` produces ahead of the cancel
    // teardown. The lease hands off to the parked waiter, THEN the
    // dispose deletes the affinity's set and marks the tab closing.
    held.release();
    let disposePromise = pool.disposeAffinity('A', {
      retainSharedContext: true,
    });

    let waiter = await waiterPromise;

    assert.notStrictEqual(
      waiter.pageId,
      held.pageId,
      'waiter did not receive the doomed tab; it re-selected a fresh live page',
    );
    assert.false(
      waiter.reused,
      'the re-selected page is a freshly materialized tab, not a reuse of the disposed one',
    );

    waiter.release();
    await disposePromise;
  });

  test('parked waiter re-selects a live tab when its tab is disposed via a render-error eviction (awaitIdle: false)', async function (assert) {
    let pool = makePool();

    let held = await pool.getPage('A');
    await pool.warmStandbys();

    let waiterPromise = pool.getPage('A');
    await waitFor(
      () => affinityPending(pool, 'A') >= 2,
      'second caller parked on the tab queue',
    );

    // The eviction path disposes mid-visit, while the render still holds
    // the lease: it marks the tab closing and backgrounds the close.
    // Then the render's release hands the now-doomed lease to the parked
    // waiter.
    let disposePromise = pool.disposeAffinity('A', {
      awaitIdle: false,
      retainSharedContext: true,
    });
    held.release();

    let waiter = await waiterPromise;

    assert.notStrictEqual(
      waiter.pageId,
      held.pageId,
      'waiter did not receive the doomed tab; it re-selected a fresh live page',
    );
    assert.false(
      waiter.reused,
      'the re-selected page is a freshly materialized tab, not a reuse of the disposed one',
    );

    waiter.release();
    await disposePromise;
  });

  test('a healthy parked waiter still receives the tab on a normal release (no spurious re-selection)', async function (assert) {
    let pool = makePool();

    let held = await pool.getPage('A');

    let waiterPromise = pool.getPage('A');
    await waitFor(
      () => affinityPending(pool, 'A') >= 2,
      'second caller parked on the tab queue',
    );

    // Plain hand-off: no dispose. The waiter should reuse the same tab
    // the holder just released — revalidation must not force a spurious
    // re-selection when the entry is still live.
    held.release();
    let waiter = await waiterPromise;

    assert.strictEqual(
      waiter.pageId,
      held.pageId,
      'waiter reused the same live tab on a normal hand-off',
    );
    assert.true(waiter.reused, 'the hand-off is reported as a reuse');

    waiter.release();
  });
});
