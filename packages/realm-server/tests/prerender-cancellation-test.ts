import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { getEventListeners } from 'node:events';
import {
  PrerenderCancelledError,
  isPrerenderCancellation,
  throwIfAborted,
  abortable,
} from '../prerender/prerender-cancel.ts';
import { TabQueue } from '../prerender/page-pool.ts';
import { AsyncSemaphore } from '../prerender/async-semaphore.ts';
import { withTimeout, isRenderError } from '../prerender/utils.ts';
import type { RenderError } from '@cardstack/runtime-common';
import type { Page } from 'puppeteer';

// These tests cover the cancellation plumbing at the level closest to
// the logic — no Chrome, no HTTP. They pin down the behaviors that the
// manager / prerender-server rely on:
//
//   1. An abort delivered *while queued* produces a `'queued'`-state
//      `PrerenderCancelledError` and releases the slot so later
//      waiters aren't blocked behind a cancelled holder.
//   2. An abort delivered *mid-render* interrupts the in-flight step
//      immediately: `withTimeout` / `abortable` race the signal, so a
//      wedged page operation that would otherwise pin the step until
//      its render/protocol timeout is abandoned the moment the caller
//      disconnects, surfacing a `'rendering'`-state cancellation the
//      prerenderer turns into tab disposal.
//   3. The error shape is what the prerenderer's cancel-handler
//      branches on — `name`, `state`, and the `instanceof` guard.
//
// Holding these invariants down means the manager-level client-abort
// tests don't have to re-verify them end to end.

module(basename(import.meta.filename), function () {
  module('PrerenderCancelledError shape', function () {
    test('defaults to queued state with no reason', function (assert) {
      let err = new PrerenderCancelledError();
      assert.strictEqual(err.name, 'PrerenderCancelledError', 'name tag');
      assert.strictEqual(err.state, 'queued', 'defaults to queued');
      assert.strictEqual(err.message, 'prerender cancelled', 'default message');
    });

    test('accepts a bare reason string for backward compatibility', function (assert) {
      let err = new PrerenderCancelledError('client closed');
      assert.strictEqual(err.state, 'queued', 'string arg still defaults');
      assert.strictEqual(
        err.message,
        'prerender cancelled: client closed',
        'reason in message',
      );
    });

    test('accepts { state, reason } options', function (assert) {
      let err = new PrerenderCancelledError({
        state: 'rendering',
        reason: 'req-closed',
      });
      assert.strictEqual(err.state, 'rendering', 'state carried through');
      assert.strictEqual(
        err.message,
        'prerender cancelled: req-closed',
        'reason in message',
      );
    });

    test('isPrerenderCancellation matches only this error', function (assert) {
      assert.true(isPrerenderCancellation(new PrerenderCancelledError()));
      assert.false(isPrerenderCancellation(new Error('boom')));
      assert.false(isPrerenderCancellation('string'));
      assert.false(isPrerenderCancellation(undefined));
    });
  });

  module('throwIfAborted', function () {
    test('does nothing when signal is undefined', function (assert) {
      assert.expect(0);
      throwIfAborted(undefined);
    });

    test('does nothing when signal is not aborted', function (assert) {
      assert.expect(0);
      let ac = new AbortController();
      throwIfAborted(ac.signal);
    });

    test('throws PrerenderCancelledError tagged with provided state', function (assert) {
      let ac = new AbortController();
      ac.abort('client-left');
      try {
        throwIfAborted(ac.signal, 'rendering');
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'is cancel error');
        assert.strictEqual((e as PrerenderCancelledError).state, 'rendering');
        assert.ok(
          ((e as PrerenderCancelledError).message ?? '').includes(
            'client-left',
          ),
          'reason threaded through',
        );
      }
    });

    test('defaults to queued when no state provided', function (assert) {
      let ac = new AbortController();
      ac.abort();
      try {
        throwIfAborted(ac.signal);
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.strictEqual(
          (e as PrerenderCancelledError).state,
          'queued',
          'queued default',
        );
      }
    });
  });

  module('withTimeout cancellation', function () {
    // `withTimeout` only touches the page on its timeout path, and every
    // page read there is gated on `!page.isClosed()` — so a stub that
    // reports closed exercises the full race without Chrome.
    let stubPage = {
      url: () => 'http://localhost:4200/render/stub-card/1/opts/html',
      isClosed: () => true,
    } as unknown as Page;

    test('abort mid-step interrupts the wait without burning the step timeout', async function (assert) {
      let ac = new AbortController();
      let start = Date.now();
      let neverSettles = new Promise<never>(() => {});
      let result = withTimeout(
        stubPage,
        () => neverSettles,
        30_000,
        undefined,
        ac.signal,
      );
      setTimeout(() => ac.abort('client disconnected'), 20);
      try {
        await result;
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
        assert.strictEqual(
          (e as PrerenderCancelledError).state,
          'rendering',
          'tagged as a mid-render cancel',
        );
        assert.ok(
          ((e as PrerenderCancelledError).message ?? '').includes(
            'client disconnected',
          ),
          'abort reason threaded into the message',
        );
      }
      assert.true(
        Date.now() - start < 10_000,
        'interrupted well before the step timeout',
      );
    });

    test('already-aborted signal cancels before the step starts', async function (assert) {
      let ac = new AbortController();
      ac.abort();
      let started = false;
      try {
        await withTimeout(
          stubPage,
          async () => {
            started = true;
          },
          1_000,
          undefined,
          ac.signal,
        );
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
        assert.strictEqual((e as PrerenderCancelledError).state, 'rendering');
      }
      assert.false(started, 'step body never ran');
    });

    test('timeout path is unchanged when the signal never fires', async function (assert) {
      let ac = new AbortController();
      let result = await withTimeout(
        stubPage,
        () => new Promise<never>(() => {}),
        50,
        undefined,
        ac.signal,
      );
      assert.true(isRenderError(result), 'timeout yields a render error');
      assert.strictEqual(
        (result as RenderError).error.title,
        'Render timeout',
        'canonical timeout error',
      );
    });

    test('a completed step resolves its value and detaches the abort listener', async function (assert) {
      let ac = new AbortController();
      let value = await withTimeout(
        stubPage,
        async () => 'rendered',
        1_000,
        undefined,
        ac.signal,
      );
      assert.strictEqual(value, 'rendered', 'value passed through');
      // The signal spans the whole request while the race is per-step;
      // a leaked listener per step would pile up across a visit.
      assert.strictEqual(
        getEventListeners(ac.signal, 'abort').length,
        0,
        'no listener left behind',
      );
    });
  });

  module('abortable', function () {
    test('passes the value through when no signal is provided', async function (assert) {
      assert.strictEqual(await abortable(undefined, async () => 42), 42);
    });

    test('resolves and detaches its listener when the operation completes', async function (assert) {
      let ac = new AbortController();
      let value = await abortable(ac.signal, async () => 'done');
      assert.strictEqual(value, 'done');
      assert.strictEqual(
        getEventListeners(ac.signal, 'abort').length,
        0,
        'no listener left behind',
      );
    });

    test('abort mid-operation rejects with a rendering-state cancel by default', async function (assert) {
      let ac = new AbortController();
      let op = abortable(ac.signal, () => new Promise<never>(() => {}));
      setTimeout(() => ac.abort('client disconnected'), 20);
      try {
        await op;
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
        assert.strictEqual((e as PrerenderCancelledError).state, 'rendering');
        assert.ok(
          ((e as PrerenderCancelledError).message ?? '').includes(
            'client disconnected',
          ),
          'reason threaded through',
        );
      }
    });

    test('already-aborted signal rejects before the operation starts', async function (assert) {
      let ac = new AbortController();
      ac.abort();
      let started = false;
      try {
        await abortable(ac.signal, async () => {
          started = true;
        });
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
      }
      assert.false(started, 'operation never ran');
    });

    test('the abandoned operation rejecting later does not surface anywhere', async function (assert) {
      // Once the page is disposed, the abandoned CDP call rejects —
      // that rejection must be absorbed by the settled race, not
      // escape as an unhandled rejection (which fails the suite).
      let ac = new AbortController();
      let rejectLater!: (err: Error) => void;
      let op = abortable(
        ac.signal,
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectLater = reject;
          }),
      );
      ac.abort();
      try {
        await op;
        assert.ok(false, 'should have thrown');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
      }
      rejectLater(new Error('Protocol error (Target closed)'));
      // Give the microtask queue a turn — an unhandled rejection here
      // would be reported by the test harness.
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(true, 'late rejection absorbed');
    });
  });

  module('TabQueue cancellation', function () {
    test('acquire on an unaborted signal resolves normally', async function (assert) {
      let q = new TabQueue();
      let ac = new AbortController();
      let release = await q.acquire(ac.signal);
      assert.strictEqual(q.pendingCount, 1, 'depth=1 while held');
      release();
      assert.strictEqual(q.pendingCount, 0, 'depth=0 after release');
    });

    test('acquire rejects synchronously when signal already aborted', async function (assert) {
      let q = new TabQueue();
      let ac = new AbortController();
      ac.abort();
      try {
        await q.acquire(ac.signal);
        assert.ok(false, 'should have rejected');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'is cancel error');
        assert.strictEqual(
          (e as PrerenderCancelledError).state,
          'queued',
          'queued state',
        );
      }
      assert.strictEqual(q.pendingCount, 0, 'no leak');
    });

    test('aborting a queued waiter releases its slot for later acquirers', async function (assert) {
      let q = new TabQueue();
      let ac1 = new AbortController();
      let ac2 = new AbortController();
      let release1 = await q.acquire();
      // Waiter B goes behind A
      let acquireB = q.acquire(ac1.signal);
      // Waiter C goes behind B
      let acquireC = q.acquire(ac2.signal);
      assert.strictEqual(q.pendingCount, 3, 'three queued entries');

      // Cancel B while it's waiting.
      ac1.abort('gave up');
      await acquireB.then(
        () => assert.ok(false, 'B should have rejected'),
        (err) => {
          assert.true(isPrerenderCancellation(err), 'B is cancel error');
          assert.strictEqual(
            (err as PrerenderCancelledError).state,
            'queued',
            'B tagged queued',
          );
        },
      );
      // B's slot was released so the depth should have dropped by one.
      assert.strictEqual(q.pendingCount, 2, 'B slot released');

      // Releasing A should hand the slot directly to C, skipping cancelled B.
      release1();
      let releaseC = await acquireC;
      assert.strictEqual(typeof releaseC, 'function', 'C acquired');
      releaseC();
      assert.strictEqual(q.pendingCount, 0, 'fully drained');
    });

    test('aborting the only holder after it acquired does not double-release', async function (assert) {
      let q = new TabQueue();
      let ac = new AbortController();
      let release = await q.acquire(ac.signal);
      // Abort after acquire — TabQueue stops listening once it returns,
      // so the abort is the caller's problem (render path catches via
      // throwIfAborted at pass boundaries). The queue must NOT react.
      ac.abort();
      assert.strictEqual(q.pendingCount, 1, 'still held');
      release();
      assert.strictEqual(q.pendingCount, 0, 'clean release');
    });
  });

  module('AsyncSemaphore cancellation', function () {
    test('acquires immediately when slots available', async function (assert) {
      let sem = new AsyncSemaphore(2);
      let r1 = await sem.acquire();
      let r2 = await sem.acquire();
      assert.strictEqual(typeof r1, 'function', 'got release 1');
      assert.strictEqual(typeof r2, 'function', 'got release 2');
      r1();
      r2();
    });

    test('rejects immediately when signal is already aborted', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let ac = new AbortController();
      ac.abort();
      try {
        await sem.acquire(ac.signal);
        assert.ok(false, 'should have rejected');
      } catch (e) {
        assert.true(isPrerenderCancellation(e), 'cancel error');
        assert.strictEqual(
          (e as PrerenderCancelledError).state,
          'queued',
          'queued state',
        );
      }
    });

    test('aborting a queued waiter splices it out and lets later waiters acquire', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let ac = new AbortController();

      let r1 = await sem.acquire();

      let acquiredB = false;
      let acquireB = sem.acquire(ac.signal).then(
        () => (acquiredB = true),
        (err) => err,
      );
      let waiterC = sem.acquire();

      // Abort B while it's queued.
      ac.abort('left');
      let bResult = await acquireB;
      assert.false(acquiredB, 'B did not acquire');
      assert.true(isPrerenderCancellation(bResult), 'B got cancel error');

      // Releasing the initial slot should hand it to C, not to the
      // cancelled B entry.
      r1();
      let rC = await waiterC;
      assert.strictEqual(typeof rC, 'function', 'C acquired after A released');
      rC();
    });

    test('cancel after slot is already handed off releases gracefully', async function (assert) {
      let sem = new AsyncSemaphore(1);
      let ac = new AbortController();

      let r1 = await sem.acquire();

      // Start B with a signal, but we'll abort right as the slot is
      // being handed off. The settled check inside AsyncSemaphore should
      // release the slot onward without deadlocking.
      let waiterB = sem.acquire(ac.signal);
      let waiterC = sem.acquire();

      // Release A — this synchronously calls B's resolve, which marks
      // B settled before we fire the abort below.
      r1();
      // Now abort — B has already acquired, so this is a no-op.
      ac.abort();

      let rB = await waiterB;
      assert.strictEqual(typeof rB, 'function', 'B acquired before abort');
      rB();

      let rC = await waiterC;
      assert.strictEqual(typeof rC, 'function', 'C acquired after B released');
      rC();
    });
  });
});
