import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';
import { isPrerenderCancellation } from '../prerender/prerender-cancel.ts';

// Tests for AsyncSemaphore's resize-aware behaviour. The cancellation
// tests live in prerender-cancellation-test.ts; this file owns the
// contract of `setCapacity(n)` plus the in-flight tracking the resize
// requires.
//
// What we pin down here:
//   1. The basic invariants (capacity / inUseCount / pendingCount)
//      remain correct when in-flight slots cross the cap because of a
//      shrink — i.e. release() decrements inUseCount monotonically and
//      doesn't admit new waiters while inUse > capacity.
//   2. setCapacity(grow) wakes queued waiters up to the new cap, in
//      FIFO order, in a single pass — not one wake per future release.
//   3. setCapacity(shrink) is best-effort: never preempts in-flight,
//      stalls future admissions until inUse falls under the new cap.
//   4. Edge cases: clamping to 1, no-op resize, resize while empty,
//      cancelled waiters mixed with grow.

module(basename(import.meta.filename), function () {
  module('AsyncSemaphore basic state', function () {
    test('reports correct counts at construction', function (assert) {
      let sem = new AsyncSemaphore(3);
      assert.strictEqual(sem.capacity, 3);
      assert.strictEqual(sem.inUseCount, 0);
      assert.strictEqual(sem.pendingCount, 0);
    });

    test('clamps construction capacity to 1 minimum', function (assert) {
      let sem = new AsyncSemaphore(0);
      assert.strictEqual(sem.capacity, 1, 'cap=0 clamped to 1');
      let sem2 = new AsyncSemaphore(-5);
      assert.strictEqual(sem2.capacity, 1, 'cap=-5 clamped to 1');
    });

    test('rejects non-finite construction capacity (NaN / Infinity)', function (assert) {
      // Addresses Codex P2 + Copilot review on PR 4589: `Math.max(1, NaN)
      // === NaN` would have permanently stalled every future acquire
      // because comparisons against NaN are always false.
      let nanSem = new AsyncSemaphore(NaN);
      assert.strictEqual(nanSem.capacity, 1, 'NaN falls back to 1');
      let infSem = new AsyncSemaphore(Infinity);
      assert.strictEqual(infSem.capacity, 1, 'Infinity falls back to 1');
      let negInfSem = new AsyncSemaphore(-Infinity);
      assert.strictEqual(negInfSem.capacity, 1, '-Infinity falls back to 1');
    });

    test('floors fractional construction capacity', function (assert) {
      // `#inUse` is an integer counter, so a fractional cap (e.g. 2.7)
      // would let `2 < 2.7` admit a 3rd holder despite operator intent
      // of "two slots".
      let sem = new AsyncSemaphore(2.7);
      assert.strictEqual(sem.capacity, 2, '2.7 floors to 2');
      let sem2 = new AsyncSemaphore(0.9);
      assert.strictEqual(sem2.capacity, 1, '0.9 floors-then-clamps to 1');
    });

    test('inUseCount tracks acquire / release directly', async function (assert) {
      let sem = new AsyncSemaphore(2);
      let r1 = await sem.acquire();
      assert.strictEqual(sem.inUseCount, 1);
      let r2 = await sem.acquire();
      assert.strictEqual(sem.inUseCount, 2);
      r1();
      assert.strictEqual(sem.inUseCount, 1);
      r2();
      assert.strictEqual(sem.inUseCount, 0);
    });

    test('pendingCount reflects queued waiters', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let r1 = await sem.acquire();
      let p2 = sem.acquire();
      let p3 = sem.acquire();
      // Allow microtask flush so the queueing has settled.
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 2);
      r1();
      let r2 = await p2;
      assert.strictEqual(sem.pendingCount, 1);
      r2();
      let r3 = await p3;
      assert.strictEqual(sem.pendingCount, 0);
      r3();
    });
  });

  module('setCapacity grow', function () {
    test('grow wakes queued waiters up to the new cap', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let r1 = await sem.acquire();

      let acquired: number[] = [];
      let p2 = sem.acquire().then((r) => {
        acquired.push(2);
        return r;
      });
      let p3 = sem.acquire().then((r) => {
        acquired.push(3);
        return r;
      });
      let p4 = sem.acquire().then((r) => {
        acquired.push(4);
        return r;
      });
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 3, '3 waiters queued');
      assert.deepEqual(acquired, [], 'no one acquired yet');

      // Grow to 3: should wake exactly 2 waiters (1 in-flight + 2 new
      // = 3 total).
      sem.setCapacity(3);
      let r2 = await p2;
      let r3 = await p3;
      assert.deepEqual(acquired, [2, 3], 'FIFO: 2 and 3 woke, in order');
      assert.strictEqual(sem.inUseCount, 3, 'inUse at new cap');
      assert.strictEqual(sem.pendingCount, 1, 'one waiter still queued');

      // Grow further: should wake the last one.
      sem.setCapacity(4);
      let r4 = await p4;
      assert.deepEqual(acquired, [2, 3, 4]);
      assert.strictEqual(sem.inUseCount, 4);
      assert.strictEqual(sem.pendingCount, 0);

      r1();
      r2();
      r3();
      r4();
      assert.strictEqual(sem.inUseCount, 0);
    });

    test('grow with empty queue is a no-op against state', function (assert) {
      let sem = new AsyncSemaphore(2);
      sem.setCapacity(5);
      assert.strictEqual(sem.capacity, 5);
      assert.strictEqual(sem.inUseCount, 0);
      assert.strictEqual(sem.pendingCount, 0);
    });

    test('grow when not saturated does not over-admit', async function (assert) {
      let sem = new AsyncSemaphore(3);
      let r1 = await sem.acquire();
      sem.setCapacity(5);
      assert.strictEqual(sem.inUseCount, 1);
      assert.strictEqual(sem.capacity, 5);
      // Verify we can still acquire up to the new cap.
      let r2 = await sem.acquire();
      let r3 = await sem.acquire();
      let r4 = await sem.acquire();
      let r5 = await sem.acquire();
      assert.strictEqual(sem.inUseCount, 5);
      r1();
      r2();
      r3();
      r4();
      r5();
    });
  });

  module('setCapacity shrink', function () {
    test('shrink does not preempt in-flight slots', async function (assert) {
      let sem = new AsyncSemaphore(5);
      let r1 = await sem.acquire();
      let r2 = await sem.acquire();
      let r3 = await sem.acquire();
      let r4 = await sem.acquire();
      let r5 = await sem.acquire();
      assert.strictEqual(sem.inUseCount, 5);

      sem.setCapacity(2);
      assert.strictEqual(sem.capacity, 2, 'capacity reflects shrink');
      assert.strictEqual(
        sem.inUseCount,
        5,
        'in-flight slots untouched by shrink',
      );

      r1();
      r2();
      r3();
      assert.strictEqual(sem.inUseCount, 2);
      r4();
      r5();
      assert.strictEqual(sem.inUseCount, 0);
    });

    test('shrink stalls new acquires until inUse drops under the new cap', async function (assert) {
      let sem = new AsyncSemaphore(4);
      let r1 = await sem.acquire();
      let r2 = await sem.acquire();
      let r3 = await sem.acquire();

      // Shrink to 2 with 3 in-flight (over-cap by 1).
      sem.setCapacity(2);
      let admitted = false;
      let p4 = sem.acquire().then((r) => {
        admitted = true;
        return r;
      });
      await Promise.resolve();
      assert.false(admitted, 'over-cap blocks new acquire');
      assert.strictEqual(sem.pendingCount, 1);

      // Drop one in-flight: still over-cap (2 in-flight, cap 2). Should
      // not admit.
      r1();
      await Promise.resolve();
      assert.false(admitted, 'still blocked at inUse===cap');

      // Drop another: now under-cap (1 in-flight, cap 2). Waiter wakes.
      r2();
      let r4 = await p4;
      assert.true(admitted, 'admitted after inUse fell under cap');
      assert.strictEqual(sem.inUseCount, 2);

      r3();
      r4();
      assert.strictEqual(sem.inUseCount, 0);
    });

    test('grow then shrink in same tick preserves correct count', async function (assert) {
      let sem = new AsyncSemaphore(2);
      let r1 = await sem.acquire();
      let r2 = await sem.acquire();
      let p3 = sem.acquire();
      let p4 = sem.acquire();
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 2);

      sem.setCapacity(4);
      let r3 = await p3;
      let r4 = await p4;
      assert.strictEqual(sem.inUseCount, 4);
      assert.strictEqual(sem.pendingCount, 0);

      sem.setCapacity(1);
      assert.strictEqual(sem.capacity, 1);
      assert.strictEqual(sem.inUseCount, 4, 'shrink preserves in-flight');

      r1();
      r2();
      r3();
      assert.strictEqual(sem.inUseCount, 1, 'three drained');
      r4();
      assert.strictEqual(sem.inUseCount, 0, 'all drained');
    });

    test('shrink to 0 clamps to 1', function (assert) {
      let sem = new AsyncSemaphore(3);
      sem.setCapacity(0);
      assert.strictEqual(sem.capacity, 1, 'cap=0 clamped to 1');
      sem.setCapacity(-2);
      assert.strictEqual(sem.capacity, 1, 'cap=-2 clamped to 1');
    });

    test('rejects non-finite + fractional resize values', function (assert) {
      // Same Codex/Copilot concern as the constructor — protected here
      // because PagePool dynamic resize (PR 7) reads env-vars and
      // arithmetic results, both of which can produce NaN/floats.
      let sem = new AsyncSemaphore(3);
      sem.setCapacity(NaN);
      assert.strictEqual(sem.capacity, 1, 'NaN normalized to 1');
      sem.setCapacity(Infinity);
      assert.strictEqual(sem.capacity, 1, 'Infinity normalized to 1');
      sem.setCapacity(4.7);
      assert.strictEqual(sem.capacity, 4, '4.7 floors to 4');
    });

    test('no-op when new capacity equals current', function (assert) {
      let sem = new AsyncSemaphore(3);
      sem.setCapacity(3);
      assert.strictEqual(sem.capacity, 3);
      assert.strictEqual(sem.inUseCount, 0);
    });
  });

  module('setCapacity interactions with cancellation', function () {
    test('cancelled waiter is skipped during grow wake', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let r1 = await sem.acquire();

      let ac = new AbortController();
      let pCancelled = sem.acquire(ac.signal).then(
        () => 'acquired',
        (e) => (isPrerenderCancellation(e) ? 'cancelled' : 'other'),
      );
      let acquiredAfter: number[] = [];
      let pNext = sem.acquire().then((r) => {
        acquiredAfter.push(1);
        return r;
      });
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 2, 'two queued');

      // Cancel the first waiter: it gets spliced out of the queue.
      ac.abort('test');
      assert.strictEqual(await pCancelled, 'cancelled');
      assert.strictEqual(sem.pendingCount, 1, 'cancelled waiter spliced');

      // Grow: the surviving waiter wakes.
      sem.setCapacity(2);
      let r2 = await pNext;
      assert.deepEqual(acquiredAfter, [1]);
      assert.strictEqual(sem.inUseCount, 2);
      r1();
      r2();
    });

    test('cancellation while slot in-flight does not corrupt count after a shrink', async function (assert) {
      let sem = new AsyncSemaphore(3);
      let r1 = await sem.acquire();
      let r2 = await sem.acquire();
      let r3 = await sem.acquire();

      // Shrink to 1 — over-cap by 2.
      sem.setCapacity(1);
      assert.strictEqual(sem.inUseCount, 3);

      // Queue a waiter under a signal we'll abort before any release.
      let ac = new AbortController();
      let pCancelled = sem.acquire(ac.signal).then(
        () => 'acquired',
        (e) => (isPrerenderCancellation(e) ? 'cancelled' : 'other'),
      );
      await Promise.resolve();
      assert.strictEqual(sem.pendingCount, 1);

      ac.abort();
      assert.strictEqual(await pCancelled, 'cancelled');
      assert.strictEqual(sem.pendingCount, 0);

      // Drain: no waiters should magically appear.
      r1();
      r2();
      r3();
      assert.strictEqual(sem.inUseCount, 0);
      assert.strictEqual(sem.pendingCount, 0);
    });
  });

  module('AsyncSemaphore concurrent operations', function () {
    test('many concurrent acquires + setCapacity admits exactly N', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let acquired = 0;
      let releases: Array<() => void> = [];

      // Queue 10 acquirers. Only the first one will fit at cap=1.
      let acquirers = Array.from({ length: 10 }, () =>
        sem.acquire().then((r) => {
          acquired++;
          releases.push(r);
        }),
      );
      await Promise.resolve();
      assert.strictEqual(acquired, 1, 'one in flight at cap=1');
      assert.strictEqual(sem.pendingCount, 9);

      // Grow to 5: 4 more should wake (5 - 1 already in flight = 4
      // immediate hand-offs).
      sem.setCapacity(5);
      // Allow promise resolutions to flush.
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(acquired, 5, 'five in flight at cap=5');
      assert.strictEqual(sem.pendingCount, 5);

      // Drain by releasing one at a time. Each release should wake one
      // waiter until queue empties.
      while (releases.length > 0) {
        let r = releases.shift()!;
        r();
        await Promise.resolve();
        await Promise.resolve();
      }
      await Promise.all(acquirers);
      assert.strictEqual(acquired, 10, 'all eventually acquired');
      assert.strictEqual(sem.inUseCount, 0);
      assert.strictEqual(sem.pendingCount, 0);
    });
  });
});
