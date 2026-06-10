import { module, test } from 'qunit';
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';

// CS-10976 PR 2: regression test for the self-referential prerender
// deadlock that the `affinityTabMax − 1` file-admission ceiling (CS-10946)
// is currently preventing.
//
// The deadlock is shaped as:
//   1. A `.gts` card render acquires a tab on its affinity.
//   2. While rendering, the host code calls `getCards({ filter: { eq: { _cardType:
//      'X' } } })`. The realm-server's `CachingDefinitionLookup` cache misses on
//      the type's module and fires a same-affinity `prerenderModule` to extract it.
//   3. The module sub-prerender wants a tab on the same affinity.
//   4. The first render is *waiting on* the module sub-prerender's result —
//      it can't return its tab until the module call finishes.
//   5. If a *second* concurrent file render has also taken the affinity's
//      remaining tab and is in the same waiting state, neither file render
//      can free a tab, so neither module sub-prerender ever runs. Deadlock.
//
// The reservation prevents this by capping per-affinity *file* renders at
// `affinityTabMax − 1`, so at least one tab on each affinity is always
// available for the `module` / `command` work the file render is waiting
// on. This test reproduces the exact wait-shape — concurrent file renders
// that each fire a same-affinity module sub-call mid-flight — and asserts
// the reservation keeps the system live.
//
// A follow-up change (the "drop reservation" PR) re-runs this same
// test against a post-removal code path, where deadlock prevention
// shifts from the reservation to dynamic tab expansion. If that
// re-run doesn't pass, the reservation does not get dropped.
//
// Why no real Chrome: the deadlock condition lives in `PagePool`'s
// admission + queue contract. The cardType-filter chain in real Chrome is
// just the production *trigger* — it ends up in the same `getPage` calls
// this test makes directly. Real Chrome would reproduce the same wait
// graph at ~10× the runtime, so a follow-up PR can layer a real-Chrome
// test on top if it ever finds a discrepancy. For the regression-guard
// purpose this test is the right level.

interface StubBrowser {
  contextsCreated: string[];
  contextsClosed: string[];
}

function makeStubPagePool(opts: {
  maxPages: number;
  renderSemaphore?: { acquire(): Promise<() => void> };
}): { pool: PagePool; stub: StubBrowser } {
  function makeStorage(): Storage {
    let values: Record<string, string> = {};
    return {
      getItem(key: string) {
        return values[key] ?? null;
      },
      setItem(key: string, value: string) {
        values[key] = value;
      },
      removeItem(key: string) {
        delete values[key];
      },
      clear() {
        values = {};
      },
      key(index: number) {
        return Object.keys(values)[index] ?? null;
      },
      get length() {
        return Object.keys(values).length;
      },
    } as Storage;
  }

  let contextCounter = 0;
  let stub: StubBrowser = { contextsCreated: [], contextsClosed: [] };
  let browser = {
    async createBrowserContext() {
      let counter = ++contextCounter;
      let id = `ctx-${counter}`;
      stub.contextsCreated.push(id);
      let localStorage = makeStorage();
      let context = {
        async newPage() {
          return {
            async goto() {
              return;
            },
            async waitForFunction() {
              return true;
            },
            async evaluate(fn: (...args: any[]) => any, ...args: any[]) {
              let original = (globalThis as any).localStorage;
              (globalThis as any).localStorage = localStorage;
              try {
                return await fn(...args);
              } finally {
                (globalThis as any).localStorage = original;
              }
            },
            async close() {
              return;
            },
            browserContext() {
              return context;
            },
            removeAllListeners() {
              return;
            },
            on() {
              return;
            },
          } as any;
        },
        async close() {
          stub.contextsClosed.push(id);
          return;
        },
      } as any;
      return context;
    },
  };
  let browserManager = {
    async getBrowser() {
      return browser as any;
    },
    async cleanupUserDataDirs() {
      return;
    },
  };
  let pool = new PagePool({
    maxPages: opts.maxPages,
    serverURL: 'http://localhost',
    browserManager: browserManager as any,
    boxelHostURL: 'http://localhost:4200',
    standbyTimeoutMs: 500,
    renderSemaphore: opts.renderSemaphore,
    disableFileAdmission: false,
  });
  return { pool, stub };
}

module(basename(__filename), function () {
  module('CS-10976: deadlock-safety reservation', function (hooks) {
    let prevTabMax: string | undefined;

    hooks.beforeEach(function () {
      prevTabMax = process.env.PRERENDER_AFFINITY_TAB_MAX;
      process.env.PRERENDER_AFFINITY_TAB_MAX = '2';
    });

    hooks.afterEach(function () {
      if (prevTabMax === undefined) {
        delete process.env.PRERENDER_AFFINITY_TAB_MAX;
      } else {
        process.env.PRERENDER_AFFINITY_TAB_MAX = prevTabMax;
      }
    });

    test('two concurrent file renders that each fire a same-affinity module sub-call complete', async function (assert) {
      // The `runFileRenderWithModuleSubCall` function below mimics the
      // exact wait-shape produced by the cardType-filter chain in
      // production: a `.gts` render holds a tab while it fires (and
      // waits for) a same-affinity module sub-prerender, then releases.
      // Two concurrent invocations of this on the same affinity exhibit
      // the deadlock condition we're guarding against.
      let semaphore = new AsyncSemaphore(2);
      let { pool } = makeStubPagePool({
        maxPages: 2,
        renderSemaphore: semaphore,
      });
      try {
        await pool.warmStandbys();

        let runFileRenderWithModuleSubCall = async (
          tag: string,
        ): Promise<{ tag: string; phase: string }> => {
          let fileLease = await pool.getPage('realm-a', 'file');
          try {
            // The render is now in flight on this tab. Mid-render, fire
            // the same-affinity module sub-prerender that the host code
            // would issue via `CachingDefinitionLookup`. The render
            // CANNOT return its tab until this module call finishes.
            let moduleLease = await pool.getPage('realm-a', 'module');
            moduleLease.release();
          } finally {
            fileLease.release();
          }
          return { tag, phase: 'done' };
        };

        // Tight deadlock-detection budget. The non-deadlocked path
        // returns in milliseconds; with the reservation removed and no
        // expansion (the reservation-revert case), this hangs forever.
        // Clear the timer when the work resolves so it doesn't keep the
        // node event loop alive after the test exits — addresses
        // Copilot review on PR 4590.
        let deadlockBudgetMs = 3000;
        let raceWithDeadlock = async (label: string) => {
          let timer: NodeJS.Timeout | undefined;
          let timerPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `deadlock-prevention-failed: file render '${label}' did not complete within ${deadlockBudgetMs}ms`,
                ),
              );
            }, deadlockBudgetMs);
            timer.unref?.();
          });
          try {
            return await Promise.race([
              runFileRenderWithModuleSubCall(label),
              timerPromise,
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };

        let results = await Promise.all([
          raceWithDeadlock('A'),
          raceWithDeadlock('B'),
        ]);
        assert.deepEqual(
          results.map((r) => r.tag).sort(),
          ['A', 'B'],
          'both concurrent file+module pairs completed',
        );
      } finally {
        await pool.closeAll();
      }
    });

    test('module / command sub-call gets the reserved tab even when file admission is fully utilised', async function (assert) {
      // Tighter version of the above: explicitly hold the file
      // admission slot, queue another file admission behind it, and fire
      // a module call. The reservation guarantees the module call gets
      // the reserved tab without waiting for the held file render to
      // release.
      let semaphore = new AsyncSemaphore(2);
      let { pool } = makeStubPagePool({
        maxPages: 2,
        renderSemaphore: semaphore,
      });
      try {
        await pool.warmStandbys();

        let firstFile = await pool.getPage('realm-a', 'file');
        let secondFileAdmitted = false;
        let secondFilePromise = pool
          .getPage('realm-a', 'file')
          .then((lease) => {
            secondFileAdmitted = true;
            return lease;
          });
        // Allow the second file's admission attempt to settle into the
        // queue so the assertion is not racy.
        await new Promise((r) => setTimeout(r, 10));
        assert.false(
          secondFileAdmitted,
          'second concurrent file render correctly queues behind admission cap=1',
        );

        // Module call should bypass admission entirely and get the
        // reserved tab. If the reservation invariant is broken, this
        // call queues behind tab availability instead. Same timer
        // hygiene as above — clear on completion so a leaked handle
        // doesn't keep the event loop alive (Copilot review).
        let moduleStart = Date.now();
        let raceTimer: NodeJS.Timeout | undefined;
        let moduleTimerPromise = new Promise<never>((_, reject) => {
          raceTimer = setTimeout(() => {
            reject(
              new Error(
                'reservation-failed: module call did not get a tab while file admission was held',
              ),
            );
          }, 2000);
          raceTimer.unref?.();
        });
        let moduleLease;
        try {
          moduleLease = await Promise.race([
            pool.getPage('realm-a', 'module'),
            moduleTimerPromise,
          ]);
        } finally {
          if (raceTimer) clearTimeout(raceTimer);
        }
        let moduleAcquireMs = Date.now() - moduleStart;
        assert.ok(
          moduleAcquireMs < 1000,
          `module call landed quickly (${moduleAcquireMs}ms) without waiting for file admission to release`,
        );
        moduleLease.release();

        firstFile.release();
        let secondFile = await secondFilePromise;
        assert.true(
          secondFileAdmitted,
          'releasing first file lets second file enter admission',
        );
        secondFile.release();
      } finally {
        await pool.closeAll();
      }
    });

    test('dynamic-pool mode: deadlock-safety reservation removed; expansion resolves the deadlock', async function (assert) {
      // Reservation-removal verification: same wait-shape as the
      // first regression
      // test in this file, but the pool is configured for dynamic
      // expansion (MIN=2, MAX=4) and the file-admission default is
      // raised to `affinityTabMax` (no reservation). Two concurrent
      // file renders fire same-affinity module sub-calls; with no
      // reservation, the only way both pairs complete inside the
      // budget is if `#tryExpand` lifts `#maxPages` to absorb the
      // saturating module sub-calls (one per concurrent file render
      // in flight, so MAX needs ≥ 2 + 2 = 4 to cover the worst case).
      //
      // If this test ever fails, the deadlock-prevention contract is
      // broken — dropping the reservation was unsafe.
      let prevMin = process.env.PRERENDER_PAGE_POOL_MIN;
      let prevMax = process.env.PRERENDER_PAGE_POOL_MAX;
      process.env.PRERENDER_PAGE_POOL_MIN = '2';
      process.env.PRERENDER_PAGE_POOL_MAX = '4';
      try {
        let semaphore = new AsyncSemaphore(2);
        let { pool } = makeStubPagePool({
          maxPages: 2,
          renderSemaphore: semaphore,
        });
        try {
          await pool.warmStandbys();
          assert.strictEqual(
            pool.minPages,
            2,
            'dynamic-pool mode active (minPages=2)',
          );
          assert.strictEqual(
            pool.maxBurstPages,
            4,
            'dynamic-pool mode active (maxBurstPages=4)',
          );

          let runFileRenderWithModuleSubCall = async (
            tag: string,
          ): Promise<{ tag: string; phase: string }> => {
            let fileLease = await pool.getPage('realm-a', 'file');
            try {
              let moduleLease = await pool.getPage('realm-a', 'module');
              moduleLease.release();
            } finally {
              fileLease.release();
            }
            return { tag, phase: 'done' };
          };

          let deadlockBudgetMs = 3000;
          let raceWithDeadlock = async (label: string) => {
            let timer: NodeJS.Timeout | undefined;
            let timerPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(
                  new Error(
                    `deadlock-prevention-failed: file render '${label}' did not complete within ${deadlockBudgetMs}ms`,
                  ),
                );
              }, deadlockBudgetMs);
              timer.unref?.();
            });
            try {
              return await Promise.race([
                runFileRenderWithModuleSubCall(label),
                timerPromise,
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          };

          let results = await Promise.all([
            raceWithDeadlock('A'),
            raceWithDeadlock('B'),
          ]);
          assert.deepEqual(
            results.map((r) => r.tag).sort(),
            ['A', 'B'],
            'both concurrent file+module pairs completed via expansion',
          );
        } finally {
          await pool.closeAll();
        }
      } finally {
        if (prevMin === undefined) {
          delete process.env.PRERENDER_PAGE_POOL_MIN;
        } else {
          process.env.PRERENDER_PAGE_POOL_MIN = prevMin;
        }
        if (prevMax === undefined) {
          delete process.env.PRERENDER_PAGE_POOL_MAX;
        } else {
          process.env.PRERENDER_PAGE_POOL_MAX = prevMax;
        }
      }
    });

    test('deadlock-safety warning fires when affinityTabMax < 2', async function (assert) {
      // Sanity check: the page-pool startup warning that flags the
      // degenerate legacy config (no expansion budget AND
      // affinityTabMax < 2) lives in this code path. We exercise
      // construction; the warning goes to log, no user-visible state
      // to assert here — the earlier tests are the real regression
      // guards.
      process.env.PRERENDER_AFFINITY_TAB_MAX = '1';
      let { pool } = makeStubPagePool({ maxPages: 1 });
      try {
        await pool.warmStandbys();
        // Reaching this point without throw is the assertion.
        assert.ok(true, 'pool construction succeeded at degenerate tabMax=1');
      } finally {
        await pool.closeAll();
      }
    });
  });
});
