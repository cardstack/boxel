import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { settledBy } from '@cardstack/runtime-common/settled-by';

const execFileAsync = promisify(execFile);
const settledByModule = new URL(
  '../../runtime-common/settled-by.ts',
  import.meta.url,
).href;

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
      let elapsed = Date.now() - startedAt;
      // Both bounds matter: the lower one rules out an implementation that
      // answers false immediately without honoring the window, the upper one
      // rules out one that waits on the work regardless of the deadline.
      assert.true(
        elapsed >= 90,
        `waited for the window rather than answering immediately (took ${elapsed}ms)`,
      );
      assert.true(
        elapsed < 2000,
        `released at the deadline instead of waiting on the work (took ${elapsed}ms)`,
      );
    });

    test('a deadline already in the past releases outstanding work immediately', async function (assert) {
      let neverSettles = new Deferred<void>();
      assert.false(
        await settledBy(neverSettles.promise, Date.now() - 1000),
        'a past deadline has already expired',
      );
    });

    // The tie-break the readiness gates depend on. Work that is demonstrably
    // finished must never be reported as outstanding, so fulfilment observed on
    // the microtask queue beats a deadline observed on a macrotask. Without
    // this, a gate sharing a spent budget with an earlier gate would answer
    // "not ready" about work that had already completed.
    test('already-finished work reports settled even against an expired deadline', async function (assert) {
      assert.true(
        await settledBy(Promise.resolve(), Date.now() - 1000),
        'fulfilment wins the tie against an expired deadline',
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
    // nothing is left to observe it. `Promise.race` attaches reactions to every
    // input, which is what keeps this from surfacing as an unhandled rejection
    // — and an unhandled rejection here would take down the process that called
    // the gate, the opposite of what bounding the wait is for.
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

    // Runs in a subprocess because this cannot be observed from inside the test
    // harness: QUnit keeps its own work on the event loop, so the deadline timer
    // is never the only thing holding the process open. A timer that does not
    // hold the loop lets node exit while the gate is still pending — the caller
    // never gets its answer, and a short-lived process (a CLI command, a
    // migration, a worker draining at shutdown) exits 0 having silently skipped
    // the work that depended on it.
    test('the deadline holds the process open long enough to answer', async function (assert) {
      let { stdout } = await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const { settledBy } = await import(${JSON.stringify(settledByModule)});
           console.log('RESULT:' + await settledBy(new Promise(() => {}), Date.now() + 100));`,
        ],
        { env: { ...process.env, NODE_NO_WARNINGS: '1' }, timeout: 30_000 },
      );
      assert.strictEqual(
        stdout.trim(),
        'RESULT:false',
        'the gate answered instead of the process exiting with it still pending',
      );
    });
  });
});
