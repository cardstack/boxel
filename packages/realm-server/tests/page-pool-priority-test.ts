import { module, test } from 'qunit';
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

module(basename(__filename), function () {
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
});
