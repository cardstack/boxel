import { module, test } from 'qunit';

import {
  isAbortError,
  raceAbort,
  SharedAbortableRequest,
} from '@cardstack/host/lib/search-abort';

function abortableWork() {
  let started: AbortSignal[] = [];
  let resolvers: ((value: string) => void)[] = [];
  let start = (signal: AbortSignal) => {
    started.push(signal);
    return new Promise<string>((resolve, reject) => {
      resolvers.push(resolve);
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  };
  return { started, resolvers, start };
}

module('Unit | search abort', function () {
  test('raceAbort rejects with an AbortError when its signal aborts', async function (assert) {
    let controller = new AbortController();
    let raced = raceAbort(new Promise(() => {}), controller.signal);
    controller.abort();
    try {
      await raced;
      assert.ok(false, 'expected a rejection');
    } catch (err) {
      assert.true(isAbortError(err), 'an AbortError');
    }
  });

  test('a shared request survives one consumer cancelling', async function (assert) {
    let work = abortableWork();
    let shared = new SharedAbortableRequest(work.start);
    let first = new AbortController();
    let second = new AbortController();
    let firstResult = shared.join(first.signal);
    let secondResult = shared.join(second.signal);

    first.abort();
    try {
      await firstResult;
      assert.ok(false, 'the cancelled consumer should reject');
    } catch (err) {
      assert.true(isAbortError(err), 'the cancelled consumer gets an abort');
    }
    assert.false(work.started[0]!.aborted, 'the shared request is still live');
    assert.false(shared.aborted);

    work.resolvers[0]!('answer');
    assert.strictEqual(
      await secondResult,
      'answer',
      'the remaining consumer gets the result',
    );
  });

  test('a shared request aborts once every consumer cancels', async function (assert) {
    let work = abortableWork();
    let shared = new SharedAbortableRequest(work.start);
    let first = new AbortController();
    let second = new AbortController();
    let results = [shared.join(first.signal), shared.join(second.signal)];
    first.abort();
    assert.false(work.started[0]!.aborted, 'one consumer still wants it');
    second.abort();
    assert.true(work.started[0]!.aborted, 'aborted when nobody wants it');
    assert.true(shared.aborted);
    let settled = await Promise.allSettled(results);
    assert.deepEqual(
      settled.map((r) => r.status),
      ['rejected', 'rejected'],
    );
  });

  test('a consumer without a signal pins the shared request', async function (assert) {
    let work = abortableWork();
    let shared = new SharedAbortableRequest(work.start);
    let cancellable = new AbortController();
    let cancelled = shared.join(cancellable.signal);
    let pinned = shared.join();
    cancellable.abort();
    await cancelled.catch(() => {});
    assert.false(work.started[0]!.aborted, 'the pinned consumer keeps it live');
    work.resolvers[0]!('answer');
    assert.strictEqual(await pinned, 'answer');
  });

  test('a consumer that finishes normally does not abort the request later', async function (assert) {
    let work = abortableWork();
    let shared = new SharedAbortableRequest(work.start);
    let controller = new AbortController();
    let result = shared.join(controller.signal);
    work.resolvers[0]!('answer');
    assert.strictEqual(await result, 'answer');
    controller.abort();
    assert.false(work.started[0]!.aborted, 'a settled request is left alone');
  });
});
