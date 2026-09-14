import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { isClientDisconnectError } from '../lib/proxy-forward.ts';

// The reason `clientDisconnectSignal` aborts with. Constructed the same way
// here so the identity check has something real to match.
function disconnectedSignal(): AbortSignal {
  let controller = new AbortController();
  controller.abort(
    new Error('Client disconnected before the response was finished'),
  );
  return controller.signal;
}

module(basename(import.meta.filename), function () {
  module('isClientDisconnectError', function () {
    test('the abort reason itself is a disconnect', function (assert) {
      let signal = disconnectedSignal();
      assert.true(isClientDisconnectError(signal.reason, signal));
    });

    test('an error wrapping the abort reason is a disconnect', function (assert) {
      let signal = disconnectedSignal();
      // fetch surfaces an abort wrapped rather than rethrown.
      let wrapped = new TypeError('fetch failed', { cause: signal.reason });
      assert.true(isClientDisconnectError(wrapped, signal));
    });

    test('an AbortError from a lower layer is a disconnect', function (assert) {
      let signal = disconnectedSignal();
      let abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      assert.true(isClientDisconnectError(abortError, signal));
    });

    test('a failure that merely happens after the client left is NOT a disconnect', function (assert) {
      let signal = disconnectedSignal();
      // Saving the usage cost runs after the upstream call and never receives
      // the signal, so it fails on its own terms. Reading this as a
      // cancellation is how a billing failure goes unreported — and it can
      // only happen when nobody is watching, because the client has left.
      let dbError = new Error(
        'could not serialize access due to concurrent update',
      );
      assert.false(
        isClientDisconnectError(dbError, signal),
        'a database failure during the cost write reaches the error channel',
      );
    });

    test('nothing is a disconnect while the client is still connected', function (assert) {
      let signal = new AbortController().signal;
      let abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      assert.false(isClientDisconnectError(abortError, signal));
      assert.false(isClientDisconnectError(new Error('boom'), signal));
    });

    test('a self-referential cause chain terminates', function (assert) {
      let signal = disconnectedSignal();
      let a: any = new Error('a');
      let b: any = new Error('b');
      a.cause = b;
      b.cause = a;
      assert.false(
        isClientDisconnectError(a, signal),
        'a cycle is bounded rather than spun',
      );
    });
  });
});
