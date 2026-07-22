import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';
import { TabQueue } from '../prerender/page-pool.ts';

// Priority-aware dequeue for both `AsyncSemaphore` (the per-server
// render-cap + per-affinity file-admission) and `TabQueue` (the per-
// tab serializer).
//
// Two contracts being pinned down:
//   1. Higher priority dequeues first when capacity / the lease frees.
//   2. Same-priority entries are served in FIFO order (no reordering
//      *within* a priority bucket).
//
// Why it matters in production: a user-priority incremental render
// arriving while a system-priority full reindex has saturated the
// queue should NOT wait behind every queued background entry.

module(basename(import.meta.filename), function () {
  module('AsyncSemaphore priority dequeue', function () {
    test('higher priority jumps the queue ahead of lower-priority pending work', async function (assert) {
      let sem = new AsyncSemaphore(1);
      // Hold the only slot.
      let r1 = await sem.acquire();

      // Queue four priority=0 entries first.
      let order: string[] = [];
      let wait = (label: string, priority?: number) =>
        sem.acquire(undefined, priority).then((r) => {
          order.push(label);
          return r;
        });
      let pA = wait('A0');
      let pB = wait('B0');
      // Now queue a priority=10 entry. It should jump ahead of A0/B0.
      let pHi = wait('HI', 10);
      let pC = wait('C0');
      // Allow microtasks to flush the queue insertions.
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 4, 'four queued');

      // Release the holder. Highest priority (HI) wakes first.
      r1();
      let rHi = await pHi;
      assert.deepEqual(order, ['HI'], 'priority-10 dequeued first');

      // The remaining priority-0 entries dequeue FIFO.
      rHi();
      let rA = await pA;
      assert.deepEqual(order, ['HI', 'A0'], 'A0 next (FIFO within priority)');
      rA();
      let rB = await pB;
      assert.deepEqual(order, ['HI', 'A0', 'B0'], 'B0 next');
      rB();
      let rC = await pC;
      assert.deepEqual(order, ['HI', 'A0', 'B0', 'C0'], 'C0 last');
      rC();
    });

    test('multiple priority tiers — strict ordering by priority', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let r1 = await sem.acquire();

      let order: string[] = [];
      let releases: Record<string, () => void> = {};
      let wait = (label: string, priority?: number) =>
        sem.acquire(undefined, priority).then((r) => {
          order.push(label);
          releases[label] = r;
          return r;
        });

      // Insertion order: P5a, P10a, P5b, P0a, P10b, P0b.
      // Expected drain order: P10a, P10b, P5a, P5b, P0a, P0b.
      let pP5a = wait('P5a', 5);
      let pP10a = wait('P10a', 10);
      let pP5b = wait('P5b', 5);
      let pP0a = wait('P0a', 0);
      let pP10b = wait('P10b', 10);
      let pP0b = wait('P0b', 0);
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 6);

      // Drain in strict order, releasing each before the next can proceed.
      r1();
      let rP10a = await pP10a;
      assert.deepEqual(order, ['P10a'], 'P10a first');
      rP10a();
      let rP10b = await pP10b;
      assert.deepEqual(order, ['P10a', 'P10b']);
      rP10b();
      let rP5a = await pP5a;
      assert.deepEqual(order, ['P10a', 'P10b', 'P5a']);
      rP5a();
      let rP5b = await pP5b;
      assert.deepEqual(order, ['P10a', 'P10b', 'P5a', 'P5b']);
      rP5b();
      let rP0a = await pP0a;
      assert.deepEqual(order, ['P10a', 'P10b', 'P5a', 'P5b', 'P0a']);
      rP0a();
      let rP0b = await pP0b;
      assert.deepEqual(order, ['P10a', 'P10b', 'P5a', 'P5b', 'P0a', 'P0b']);
      rP0b();
    });

    test('priority undefined defaults to 0 (FIFO with explicit 0)', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let r1 = await sem.acquire();
      let order: string[] = [];
      let pDefault = sem.acquire().then((r) => {
        order.push('default');
        return r;
      });
      let pExplicit0 = sem.acquire(undefined, 0).then((r) => {
        order.push('explicit-0');
        return r;
      });
      let pP5 = sem.acquire(undefined, 5).then((r) => {
        order.push('p5');
        return r;
      });
      await Promise.resolve();

      r1();
      let rP5 = await pP5;
      assert.deepEqual(order, ['p5'], 'priority-5 wakes first');
      rP5();
      let rDefault = await pDefault;
      assert.deepEqual(order, ['p5', 'default'], 'undefined-priority next');
      rDefault();
      let rExplicit = await pExplicit0;
      assert.deepEqual(
        order,
        ['p5', 'default', 'explicit-0'],
        'explicit-0 last (FIFO equal-priority)',
      );
      rExplicit();
    });
  });

  module('TabQueue priority dequeue', function () {
    test('higher priority jumps tab queue ahead of lower-priority waiters', async function (assert) {
      let q = new TabQueue();
      let r1 = await q.acquire();

      let order: string[] = [];
      let wait = (label: string, priority?: number) =>
        q.acquire(undefined, priority).then((r) => {
          order.push(label);
          return r;
        });
      let pA = wait('A0');
      let pB = wait('B0');
      let pHi = wait('HI', 10);
      let pC = wait('C0');
      await Promise.resolve();
      // pendingCount = (held ? 1 : 0) + queue.length = 1 + 4 = 5
      assert.strictEqual(q.pendingCount, 5, 'four queued + held = 5');

      // Drain in expected order: HI, A0, B0, C0.
      r1();
      let rHi = await pHi;
      assert.deepEqual(order, ['HI'], 'priority-10 dequeued first');
      rHi();
      let rA = await pA;
      assert.deepEqual(order, ['HI', 'A0'], 'A0 next');
      rA();
      let rB = await pB;
      assert.deepEqual(order, ['HI', 'A0', 'B0'], 'B0 next');
      rB();
      let rC = await pC;
      assert.deepEqual(order, ['HI', 'A0', 'B0', 'C0'], 'C0 last');
      rC();
    });

    test('cancellation while queued at high priority still splices the entry out', async function (assert) {
      let q = new TabQueue();
      let r1 = await q.acquire();
      let ac = new AbortController();

      let order: string[] = [];
      let waitLow = q.acquire(undefined, 0).then((r) => {
        order.push('low');
        return r;
      });
      let waitHi = q.acquire(ac.signal, 10).then(
        (r) => {
          order.push('hi');
          return r;
        },
        (err) => {
          order.push('hi-cancelled');
          return err;
        },
      );
      await Promise.resolve();

      // Cancel the high-priority waiter before the holder releases.
      ac.abort();
      await waitHi;
      assert.deepEqual(order, ['hi-cancelled'], 'hi cancelled while queued');

      // Releasing the holder should now hand off to the low-priority
      // waiter — the cancelled hi entry is gone.
      r1();
      let rLow = await waitLow;
      assert.deepEqual(
        order,
        ['hi-cancelled', 'low'],
        'low woke after hi-cancelled',
      );
      rLow();
    });
  });

  // Anti-starvation aging for both wait-queues. Priority-then-FIFO alone lets
  // an unbroken stream of higher-priority arrivals defer a lower-priority
  // waiter forever — the shape of the single-account prerender starvation
  // where on-demand (priority-10) index visits held a background
  // (priority-0) prerender-html job visit off its realm-affinity lane until
  // the manager aborted the request. Aging raises a waiter's effective
  // priority with its wait, so a starved waiter eventually outranks fresh
  // higher-priority work. A fake clock drives wait time deterministically.
  module('priority aging (anti-starvation)', function () {
    test('AsyncSemaphore: a starved low-priority waiter overtakes a fresh high-priority arrival once aged', async function (assert) {
      let clock = { t: 0 };
      // A priority-0 waiter reaches effective priority 10 (the top user tier)
      // after 10 * 1000ms = 10s of waiting, then wins as the older entry.
      let sem = new AsyncSemaphore(1, {
        now: () => clock.t,
        agingIntervalMs: 1000,
      });
      let hold = await sem.acquire(undefined, 10); // occupy the only slot

      let order: string[] = [];
      let job = sem.acquire(undefined, 0).then((r) => {
        order.push('job');
        return r;
      });
      await Promise.resolve();

      // The job has now waited past the crossover; a fresh priority-10 visit
      // arrives.
      clock.t = 10_500;
      let freshHi = sem.acquire(undefined, 10).then((r) => {
        order.push('freshHi');
        return r;
      });
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 2, 'job + freshHi queued');

      // The running visit completes: the aged job outranks the fresh arrival.
      hold();
      let rJob = await job;
      assert.deepEqual(
        order,
        ['job'],
        'aged priority-0 waiter served before fresh priority-10',
      );
      rJob();
      let rHi = await freshHi;
      assert.deepEqual(order, ['job', 'freshHi'], 'fresh priority-10 next');
      rHi();
    });

    test('AsyncSemaphore: before the aging crossover a fresh high-priority arrival still wins', async function (assert) {
      let clock = { t: 0 };
      let sem = new AsyncSemaphore(1, {
        now: () => clock.t,
        agingIntervalMs: 1000,
      });
      let hold = await sem.acquire(undefined, 10);

      let order: string[] = [];
      let job = sem.acquire(undefined, 0).then((r) => {
        order.push('job');
        return r;
      });
      await Promise.resolve();

      // Job aged to effective priority 9 — still below the top user tier.
      clock.t = 9000;
      let freshHi = sem.acquire(undefined, 10).then((r) => {
        order.push('freshHi');
        return r;
      });
      await Promise.resolve();

      hold();
      let rHi = await freshHi;
      assert.deepEqual(
        order,
        ['freshHi'],
        'fresh priority-10 outranks a not-yet-aged priority-0 waiter',
      );
      rHi();
      let rJob = await job;
      assert.deepEqual(order, ['freshHi', 'job']);
      rJob();
    });

    test('AsyncSemaphore: a continuous high-priority stream cannot defer a low-priority waiter past the aging window', async function (assert) {
      let clock = { t: 0 };
      let sem = new AsyncSemaphore(1, {
        now: () => clock.t,
        agingIntervalMs: 1000,
      });
      let flush = async () => {
        await Promise.resolve();
        await Promise.resolve();
      };

      let pending = new Map<string, () => void>();
      let jobServedAt: number | null = null;
      let record = (label: string) => (release: () => void) => {
        if (label === 'job') {
          jobServedAt = clock.t;
        }
        pending.set(label, release);
        return release;
      };

      // A high-priority visit is already rendering (holds the only slot).
      pending.set('boot', await sem.acquire(undefined, 10));
      let holder = 'boot';

      // The background job-lane visit enqueues while the stream is in flight.
      void sem.acquire(undefined, 0).then(record('job'));
      await flush();

      // Each tick: a fresh priority-10 visit arrives, then the running visit
      // completes and the scheduler picks the next waiter.
      for (let tick = 0; tick < 1000 && jobServedAt == null; tick++) {
        clock.t += 2000; // 2s between on-demand arrivals
        void sem.acquire(undefined, 10).then(record(`hi${tick}`));
        await flush();
        let release = pending.get(holder)!;
        pending.delete(holder);
        release();
        await flush();
        holder = [...pending.keys()].find((k) => k !== 'job') ?? 'job';
      }

      assert.notStrictEqual(
        jobServedAt,
        null,
        'the starved job-lane visit was eventually served',
      );
      let servedAt = jobServedAt ?? Infinity;
      assert.ok(
        servedAt <= 12_000,
        `job served at t=${servedAt}ms — inside the aging window (~10s), not deferred toward the ~120s abort`,
      );
      pending.get('job')?.();
    });

    test('TabQueue: a starved low-priority waiter overtakes a fresh high-priority arrival once aged', async function (assert) {
      let clock = { t: 0 };
      let q = new TabQueue({ now: () => clock.t, agingIntervalMs: 1000 });
      let hold = await q.acquire(undefined, 10); // hold the tab lease

      let order: string[] = [];
      let job = q.acquire(undefined, 0).then((r) => {
        order.push('job');
        return r;
      });
      await Promise.resolve();

      clock.t = 10_500;
      let freshHi = q.acquire(undefined, 10).then((r) => {
        order.push('freshHi');
        return r;
      });
      await Promise.resolve();

      hold();
      let rJob = await job;
      assert.deepEqual(
        order,
        ['job'],
        'aged priority-0 waiter takes the tab lease before fresh priority-10',
      );
      rJob();
      let rHi = await freshHi;
      assert.deepEqual(order, ['job', 'freshHi']);
      rHi();
    });

    test('aging disabled (interval 0) keeps strict priority-then-FIFO', async function (assert) {
      let clock = { t: 0 };
      let sem = new AsyncSemaphore(1, {
        now: () => clock.t,
        agingIntervalMs: 0,
      });
      let hold = await sem.acquire(undefined, 10);

      let order: string[] = [];
      let job = sem.acquire(undefined, 0).then((r) => {
        order.push('job');
        return r;
      });
      await Promise.resolve();

      // Advance far past any crossover — with aging off, wait time is ignored.
      clock.t = 10_000_000;
      let freshHi = sem.acquire(undefined, 10).then((r) => {
        order.push('freshHi');
        return r;
      });
      await Promise.resolve();

      hold();
      let rHi = await freshHi;
      assert.deepEqual(
        order,
        ['freshHi'],
        'priority-10 always wins with aging disabled, regardless of wait',
      );
      rHi();
      let rJob = await job;
      assert.deepEqual(order, ['freshHi', 'job']);
      rJob();
    });
  });
});
