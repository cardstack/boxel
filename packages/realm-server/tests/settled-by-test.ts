import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { settledBy } from '@cardstack/runtime-common/settled-by';

module(basename(import.meta.filename), function () {
  module('settledBy', function () {
    test('work that finishes inside the window reports settled', async function (assert) {
      let deferred = new Deferred<void>();
      setTimeout(() => deferred.fulfill(), 10);
      assert.true(
        await settledBy(deferred.promise, Date.now() + 1000),
        'fulfilling before the deadline reports settled',
      );
    });

    test('work still outstanding at the deadline reports unsettled rather than holding the caller', async function (assert) {
      let neverSettles = new Deferred<void>();
      let startedAt = Date.now();
      assert.false(
        await settledBy(neverSettles.promise, Date.now() + 100),
        'the deadline decides the answer',
      );
      assert.true(
        Date.now() - startedAt < 2000,
        'the caller is released at the deadline instead of waiting on the work',
      );
    });

    test('a deadline already in the past reports unsettled without waiting', async function (assert) {
      let neverSettles = new Deferred<void>();
      assert.false(
        await settledBy(neverSettles.promise, Date.now() - 1000),
        'a past deadline has already expired',
      );
    });

    test('failed work propagates rather than reading as merely outstanding', async function (assert) {
      let deferred = new Deferred<void>();
      // Hand the promise to the gate before rejecting it, so the rejection is
      // observed by the gate rather than by a bare promise nobody is watching.
      let gate = settledBy(deferred.promise, Date.now() + 1000);
      deferred.reject(new Error('startup blew up'));
      await assert.rejects(
        gate,
        /startup blew up/,
        'the rejection reaches the caller',
      );
    });

    // A rejection landing after the deadline has already lost the race, so
    // nothing is left to observe it. It must be handled internally: an
    // unhandled rejection here would take down the process that called the
    // gate, which is the opposite of what bounding the wait is for.
    test('work that fails after the deadline does not surface as an unhandled rejection', async function (assert) {
      let unhandled: unknown[] = [];
      let onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        let deferred = new Deferred<void>();
        assert.false(
          await settledBy(deferred.promise, Date.now() + 50),
          'the deadline expires first',
        );
        deferred.reject(new Error('late failure'));
        // Let the rejection propagate through the microtask queue and past the
        // turn on which node reports unhandled rejections.
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(unhandled, [], 'no unhandled rejection was reported');
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
