import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  isClientDisconnectError,
  upstreamCallSignal,
} from '../lib/proxy-forward.ts';

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
  module('upstreamCallSignal', function () {
    test('cancels while the upstream is still answering', function (assert) {
      let clientGone = new AbortController();
      let call = upstreamCallSignal(clientGone.signal);
      assert.false(call.signal.aborted, 'live while the call is in flight');

      clientGone.abort(new Error('client left'));
      assert.true(
        call.signal.aborted,
        'a disconnect mid-call cancels the upstream and frees the lock',
      );
    });

    test('stops cancelling once the response is in hand', function (assert) {
      let clientGone = new AbortController();
      let call = upstreamCallSignal(clientGone.signal);
      // The upstream answered: the provider has generated and billed for the
      // tokens, so reading the body and recording the cost must not be
      // cancellable — abandoning them loses the charge rather than saving it.
      call.release();

      clientGone.abort(new Error('client left'));
      assert.false(
        call.signal.aborted,
        'the body read and cost save survive a disconnect',
      );
    });

    test('a client already gone cancels immediately', function (assert) {
      let clientGone = new AbortController();
      clientGone.abort(new Error('client left before the call started'));
      let call = upstreamCallSignal(clientGone.signal);
      assert.true(
        call.signal.aborted,
        'no upstream call is started for a client that has already left',
      );
    });
  });

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
