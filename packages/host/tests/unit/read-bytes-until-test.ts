import { module, test } from 'qunit';

import { readBytesUntil } from '@cardstack/runtime-common';

// A stream that serves `chunkCount` chunks of `chunkSize` bytes, each filled
// with its own index, and records how many it was asked for.
function countingStream(chunkCount: number, chunkSize: number) {
  let served = 0;
  let cancelled = false;
  let stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (served === chunkCount) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(served));
      served++;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    get served() {
      return served;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

module('Unit | readBytesUntil', function () {
  test('stops pulling chunks once the predicate decides, and cancels the rest', async function (assert) {
    let source = countingStream(10, 100);
    let bytes = await readBytesUntil(
      source.stream,
      10_000,
      (prefix) => prefix.length >= 250,
    );
    assert.strictEqual(
      bytes.length,
      300,
      'the prefix ends at the deciding chunk',
    );
    assert.deepEqual(
      [bytes[0], bytes[150], bytes[299]],
      [0, 1, 2],
      'chunks are assembled in order',
    );
    assert.ok(
      source.served < 10,
      `the stream was not drained (served ${source.served} of 10)`,
    );
    assert.true(source.cancelled, 'the unread remainder is cancelled');
  });

  test('stops at the cap when the predicate never decides', async function (assert) {
    let source = countingStream(10, 100);
    let bytes = await readBytesUntil(source.stream, 450, () => false);
    assert.strictEqual(bytes.length, 450, 'the result is trimmed to the cap');
    assert.true(source.cancelled);
  });

  test('returns the whole stream when it ends first', async function (assert) {
    let source = countingStream(3, 100);
    let bytes = await readBytesUntil(source.stream, 10_000, () => false);
    assert.strictEqual(bytes.length, 300);
  });

  test('slices an in-memory buffer to the cap', async function (assert) {
    let bytes = await readBytesUntil(new Uint8Array(500), 200, () => false);
    assert.strictEqual(bytes.length, 200);
  });
});
