import { module, test } from 'qunit';
import { basename } from 'path';
import { PagePool } from '../prerender/page-pool.ts';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';

// Configuration + dynamic-pool envelope tests for `PagePool`. The full
// expansion / contraction state machine drives a real Chrome under the
// integration tests in `prerendering-test.ts`; what's pinned down here
// is the contract of the new env-var configuration surface and the
// observable shape of `currentMaxPages` / `minPages` / `maxBurstPages`
// across legacy vs. dynamic configurations.
//
// The browser side of PagePool is stubbed with a no-op fake (same
// pattern as the existing `makeStubPagePool` helper in
// `prerendering-test.ts`) so these tests don't pay Chrome startup cost
// per assertion.

interface StubOptions {
  maxPages: number;
  renderSemaphore?: AsyncSemaphore;
  contractionTickMs?: number;
}

function makeStubPool(opts: StubOptions) {
  let contextsCreated = 0;
  let contextsClosed = 0;
  let browser = {
    async createBrowserContext() {
      contextsCreated++;
      let context: any;
      context = {
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
        async close() {
          contextsClosed++;
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
  let pool = new PagePool({
    maxPages: opts.maxPages,
    serverURL: 'http://localhost',
    browserManager: browserManager as any,
    boxelHostURL: 'http://localhost:4200',
    standbyTimeoutMs: 500,
    renderSemaphore: opts.renderSemaphore,
    disableStandbyRefill: true, // tests don't need standby creation
    disableFileAdmission: true,
    contractionTickMs: opts.contractionTickMs,
  });
  return {
    pool,
    contextsCreated: () => contextsCreated,
    contextsClosed: () => contextsClosed,
  };
}

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
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

module(basename(__filename), function () {
  module('PagePool dynamic-pool configuration', function (hooks) {
    let teardown: Array<() => Promise<void>> = [];

    hooks.afterEach(async () => {
      for (let fn of teardown.splice(0)) {
        try {
          await fn();
        } catch {
          // best-effort
        }
      }
    });

    function track(stub: { pool: PagePool }) {
      teardown.push(() => stub.pool.closeAll());
      return stub;
    }

    test('legacy fixed-pool config: MIN === MAX === options.maxPages when env vars unset', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: undefined,
          PRERENDER_PAGE_POOL_MAX: undefined,
          PRERENDER_PAGE_POOL_INITIAL: undefined,
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(
            pool.minPages,
            4,
            'minPages tracks options.maxPages',
          );
          assert.strictEqual(
            pool.maxBurstPages,
            4,
            'maxBurstPages tracks options.maxPages',
          );
          assert.strictEqual(
            pool.currentMaxPages,
            4,
            'currentMaxPages tracks options.maxPages',
          );
        },
      );
    });

    test('dynamic-pool config: MIN/MAX env vars set the envelope', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_INITIAL: undefined,
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(pool.minPages, 2, 'minPages from env');
          assert.strictEqual(pool.maxBurstPages, 6, 'maxBurstPages from env');
          assert.strictEqual(
            pool.currentMaxPages,
            2,
            'currentMaxPages defaults to MIN when INITIAL unset',
          );
        },
      );
    });

    test('dynamic-pool config: INITIAL is respected and clamped to [MIN, MAX]', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_INITIAL: '4',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 99 }));
          assert.strictEqual(pool.currentMaxPages, 4, 'INITIAL=4 respected');
        },
      );

      // Clamped above MAX
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_INITIAL: '99',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 99 }));
          assert.strictEqual(
            pool.currentMaxPages,
            6,
            'INITIAL clamped down to MAX',
          );
        },
      );

      // Clamped below MIN
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '3',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_INITIAL: '1',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 99 }));
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'INITIAL clamped up to MIN',
          );
        },
      );
    });

    test('dynamic-pool config: MAX < MIN is clamped to MIN with a warning', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '6',
          PRERENDER_PAGE_POOL_MAX: '2',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 99 }));
          assert.strictEqual(pool.minPages, 6);
          assert.strictEqual(
            pool.maxBurstPages,
            6,
            'MAX clamped to MIN — never below floor',
          );
          assert.strictEqual(pool.currentMaxPages, 6);
        },
      );
    });

    test('only one env var set: MIN xor MAX falls back to legacy config', async function (assert) {
      await withEnv(
        { PRERENDER_PAGE_POOL_MIN: '2', PRERENDER_PAGE_POOL_MAX: undefined },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(
            pool.minPages,
            4,
            'MIN alone is ignored — needs both for dynamic mode',
          );
          assert.strictEqual(pool.maxBurstPages, 4);
        },
      );

      await withEnv(
        { PRERENDER_PAGE_POOL_MIN: undefined, PRERENDER_PAGE_POOL_MAX: '6' },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(pool.minPages, 4, 'MAX alone is ignored');
          assert.strictEqual(pool.maxBurstPages, 4);
        },
      );
    });

    test('invalid env values fall back to legacy config', async function (assert) {
      // "0" is the SSM placeholder used by the operational rollout — must be
      // treated as "unset" to keep PR 7's apply a no-op.
      for (let invalid of ['0', '-1', '', ' ', '1.5', 'abc', 'null']) {
        await withEnv(
          {
            PRERENDER_PAGE_POOL_MIN: invalid,
            PRERENDER_PAGE_POOL_MAX: '6',
          },
          () => {
            let { pool } = track(makeStubPool({ maxPages: 4 }));
            assert.strictEqual(
              pool.minPages,
              4,
              `MIN="${invalid}" treated as unset → legacy fixed pool`,
            );
          },
        );
      }
    });

    test('high-priority tier: tier dormant by default (HIGH_PRIORITY_MAX/THRESHOLD unset)', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: undefined,
          PRERENDER_HIGH_PRIORITY_THRESHOLD: undefined,
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(
            pool.highPriorityMaxPages,
            6,
            'HP ceiling collapses to MAX when tier is dormant',
          );
          assert.strictEqual(
            pool.highPriorityThreshold,
            Number.POSITIVE_INFINITY,
            'threshold is +Infinity so no priority value can satisfy it',
          );
        },
      );
    });

    test('high-priority tier: env vars set the upper ceiling and threshold', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '8',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(pool.highPriorityMaxPages, 8);
          assert.strictEqual(pool.highPriorityThreshold, 5);
        },
      );
    });

    test('high-priority tier: HIGH_PRIORITY_MAX < MAX is clamped to MAX', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '6',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '4',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(
            pool.highPriorityMaxPages,
            6,
            'HP ceiling can never be below MAX',
          );
        },
      );
    });

    test('high-priority tier: dormant when single-tier dynamic config (MIN === MAX) — no expansion possible', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '4',
          PRERENDER_PAGE_POOL_MAX: '4',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '8',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        () => {
          let { pool } = track(makeStubPool({ maxPages: 4 }));
          assert.strictEqual(
            pool.highPriorityMaxPages,
            4,
            'tier disabled because base pool has no expansion budget',
          );
          assert.strictEqual(
            pool.highPriorityThreshold,
            Number.POSITIVE_INFINITY,
          );
        },
      );
    });
  });

  module('PagePool expansion / contraction', function (hooks) {
    let teardown: Array<() => Promise<void>> = [];

    hooks.afterEach(async () => {
      for (let fn of teardown.splice(0)) {
        try {
          await fn();
        } catch {
          // best-effort
        }
      }
    });

    function track(stub: { pool: PagePool }) {
      teardown.push(() => stub.pool.closeAll());
      return stub;
    }

    test('saturation expansion: render-semaphore at capacity triggers `#tryExpand`', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2); // matches MIN
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
            }),
          );
          assert.strictEqual(pool.currentMaxPages, 2, 'starts at MIN');
          assert.strictEqual(semaphore.capacity, 2, 'semaphore starts at MIN');

          // Saturate the render semaphore by holding both slots.
          let release1 = await semaphore.acquire();
          let release2 = await semaphore.acquire();
          assert.strictEqual(semaphore.inUseCount, 2, 'semaphore saturated');

          // Trigger the saturation-detection hook. `getPage` would normally
          // call this, but we exercise the contract directly so the test
          // doesn't depend on Chrome.
          pool.__test_maybeExpandUnderSaturation();
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'pool expanded by 1 under saturation',
          );
          assert.strictEqual(
            semaphore.capacity,
            3,
            'render semaphore tracks new max',
          );

          release1();
          release2();
        },
      );
    });

    test('expansion is bounded by maxBurstPages', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '3',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
            }),
          );
          let release1 = await semaphore.acquire();
          let release2 = await semaphore.acquire();
          // Two saturation triggers — should expand once to 3, then stop.
          pool.__test_maybeExpandUnderSaturation();
          // Bump the semaphore in-flight count so saturation still applies
          // post-expansion (capacity=3 after first expand).
          let release3 = await semaphore.acquire();
          pool.__test_maybeExpandUnderSaturation();
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'pool capped at maxBurstPages=3',
          );
          assert.strictEqual(semaphore.capacity, 3);

          release1();
          release2();
          release3();
        },
      );
    });

    test('contraction respects cooldown: no shrink within idle window', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          // Long cooldown so the tick can fire once without shrinking.
          PRERENDER_POOL_IDLE_CONTRACTION_MS: '60000',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
              contractionTickMs: 10,
            }),
          );
          // Force the live cap above MIN.
          pool.__test_tryExpand();
          assert.strictEqual(pool.currentMaxPages, 3, 'expanded to 3');

          // Wait long enough for several contraction ticks to fire — none
          // should drop a tab because the cooldown hasn't elapsed.
          await new Promise((r) => setTimeout(r, 80));
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'cooldown blocks contraction',
          );
        },
      );
    });

    test('contraction shrinks one tab per tick after cooldown elapses', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          // Tiny cooldown so the test doesn't have to wait minutes.
          PRERENDER_POOL_IDLE_CONTRACTION_MS: '20',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
              contractionTickMs: 10,
            }),
          );
          // Expand twice: 2 → 3 → 4.
          pool.__test_tryExpand();
          pool.__test_tryExpand();
          assert.strictEqual(pool.currentMaxPages, 4, 'expanded to MAX');

          // Wait long enough for two cooldown windows + several ticks.
          // First tick observes idle; second tick (after cooldown) shrinks
          // by one. Repeat until we hit MIN.
          await new Promise((r) => setTimeout(r, 200));
          assert.strictEqual(
            pool.currentMaxPages,
            2,
            'pool shrunk back to MIN over multiple ticks',
          );
          assert.strictEqual(
            semaphore.capacity,
            2,
            'render semaphore tracks contraction',
          );
        },
      );
    });

    test('contraction is blocked while a render semaphore slot is in use', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          PRERENDER_POOL_IDLE_CONTRACTION_MS: '20',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
              contractionTickMs: 10,
            }),
          );
          pool.__test_tryExpand();
          assert.strictEqual(pool.currentMaxPages, 3);

          // Hold a slot — semaphore.inUseCount=1 — so the idle gate fails
          // every tick.
          let release = await semaphore.acquire();
          await new Promise((r) => setTimeout(r, 200));
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'pending in-flight blocks contraction',
          );
          release();
          // Now the semaphore is idle — contraction should fire on the
          // next cooldown.
          await new Promise((r) => setTimeout(r, 200));
          assert.strictEqual(
            pool.currentMaxPages,
            2,
            'contraction resumes after slot is released',
          );
        },
      );
    });

    test('high-priority tier: low-priority caller stops expanding at MAX', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '6',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
            }),
          );
          // Expand all the way using priority 0 (background) — should
          // stop at MAX=4 even though HP_MAX=6.
          for (let i = 0; i < 10; i++) {
            pool.__test_tryExpand(0);
          }
          assert.strictEqual(
            pool.currentMaxPages,
            4,
            'priority-0 caller capped at MAX',
          );
          assert.strictEqual(semaphore.capacity, 4);
        },
      );
    });

    test('high-priority tier: high-priority caller can expand past MAX into HIGH_PRIORITY_MAX', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '6',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
            }),
          );
          for (let i = 0; i < 10; i++) {
            pool.__test_tryExpand(10);
          }
          assert.strictEqual(
            pool.currentMaxPages,
            6,
            'priority-10 caller can reach HP_MAX',
          );
          assert.strictEqual(semaphore.capacity, 6);
        },
      );
    });

    test('high-priority tier: caller AT threshold qualifies; caller below does not', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '3',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '5',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({ maxPages: 4, renderSemaphore: semaphore }),
          );
          // Exhaust the burst tier with priority-4 (below threshold).
          // Should stop at MAX=3.
          for (let i = 0; i < 5; i++) {
            pool.__test_tryExpand(4);
          }
          assert.strictEqual(
            pool.currentMaxPages,
            3,
            'priority=4 (below threshold=5) capped at MAX=3',
          );
          // Now drive with priority-5 (at threshold) — should go to HP_MAX=5.
          for (let i = 0; i < 5; i++) {
            pool.__test_tryExpand(5);
          }
          assert.strictEqual(
            pool.currentMaxPages,
            5,
            'priority=5 (at threshold=5) reaches HP_MAX',
          );
        },
      );
    });

    test('high-priority tier: contraction returns to MIN regardless of which tier expansion reached', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: '2',
          PRERENDER_PAGE_POOL_MAX: '4',
          PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX: '6',
          PRERENDER_HIGH_PRIORITY_THRESHOLD: '5',
          PRERENDER_POOL_IDLE_CONTRACTION_MS: '20',
        },
        async () => {
          let semaphore = new AsyncSemaphore(2);
          let { pool } = track(
            makeStubPool({
              maxPages: 4,
              renderSemaphore: semaphore,
              contractionTickMs: 10,
            }),
          );
          // Expand into the HP tier.
          for (let i = 0; i < 10; i++) {
            pool.__test_tryExpand(10);
          }
          assert.strictEqual(pool.currentMaxPages, 6, 'expanded to HP_MAX');

          // Contraction shrinks by one cap-unit per cooldown window, so
          // the pool must transit through each tier boundary on its way
          // down from HP_MAX=6 to MIN=2. Sampling `currentMaxPages` at a
          // fixed cadence can miss transient values when scheduler jitter
          // lets two shrinks fall inside one sleep; instead, sample at a
          // tight interval and record every distinct cap value into a
          // sequence, then assert that each tier boundary appears in it.
          // The recorded sequence is included in the failure message so
          // any future regression shows the actual trajectory.
          let observed: number[] = [pool.currentMaxPages];
          let pollDownTo = async (target: number, label: string) => {
            let deadlineMs = Date.now() + 5000;
            while (pool.currentMaxPages > target && Date.now() < deadlineMs) {
              await new Promise((r) => setTimeout(r, 1));
              let current = pool.currentMaxPages;
              if (current !== observed[observed.length - 1]) {
                observed.push(current);
              }
            }
            let deadlineHit = Date.now() >= deadlineMs;
            assert.ok(
              observed.includes(target),
              `${label} (observed=[${observed.join(',')}], deadline=${deadlineHit ? 'hit' : 'not hit'})`,
            );
          };
          await pollDownTo(4, 'contraction passes through MAX on the way down');
          await pollDownTo(2, 'contraction reaches MIN even from HP tier');
          // Belt-and-suspenders: MIN is a stable terminal state — once
          // reached, contraction must stop there. Verifying equality
          // alongside sequence membership catches a regression where the
          // pool brushes past MIN but settles elsewhere.
          assert.strictEqual(
            pool.currentMaxPages,
            2,
            `pool settles at MIN after contraction (observed=[${observed.join(',')}])`,
          );
        },
      );
    });

    test('legacy fixed pool: contraction loop never starts (no timer leak)', async function (assert) {
      await withEnv(
        {
          PRERENDER_PAGE_POOL_MIN: undefined,
          PRERENDER_PAGE_POOL_MAX: undefined,
        },
        async () => {
          let semaphore = new AsyncSemaphore(4);
          let { pool } = track(
            makeStubPool({ maxPages: 4, renderSemaphore: semaphore }),
          );
          assert.strictEqual(pool.minPages, pool.maxBurstPages);
          // No way to assert a timer wasn't created from the outside, but
          // we can verify currentMaxPages stays put — if the contraction
          // loop were running with min == max, no shrink would happen
          // anyway, but a misconfiguration could pin maxPages==0.
          await new Promise((r) => setTimeout(r, 80));
          assert.strictEqual(
            pool.currentMaxPages,
            4,
            'legacy pool stays at fixed size',
          );
        },
      );
    });
  });
});
