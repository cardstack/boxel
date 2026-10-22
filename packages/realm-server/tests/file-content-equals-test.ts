import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Readable } from 'stream';
import { fileContentEquals } from '@cardstack/runtime-common';

// Deterministic filler so two buffers differ only where a test says they do.
function bytes(length: number): Uint8Array {
  let out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i * 31 + 7) & 0xff;
  }
  return out;
}

function chunksOf(content: Uint8Array, size: number): Uint8Array[] {
  let chunks: Uint8Array[] = [];
  for (let start = 0; start < content.length; start += size) {
    chunks.push(content.slice(start, start + size));
  }
  return chunks;
}

// A web stream serving `chunks` one pull at a time, recording how many it was
// asked for and whether it was cancelled.
function webStream(chunks: Uint8Array[]) {
  let served = 0;
  let cancelled = false;
  let stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (served === chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[served++]!);
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

module(basename(import.meta.filename), function () {
  test('whole content compares as bytes', async function (assert) {
    let body = new TextEncoder().encode('héllo wörld');
    assert.true(
      await fileContentEquals({ content: 'héllo wörld' }, body),
      'a string is compared by its UTF-8 bytes',
    );
    assert.false(
      await fileContentEquals({ content: 'hello world' }, body),
      'a string with different bytes differs',
    );
    assert.true(
      await fileContentEquals({ content: body.slice() }, body),
      'equal bytes match',
    );
    assert.false(
      await fileContentEquals({ content: body.slice(0, -1) }, body),
      'a shorter file differs',
    );
    let longer = new Uint8Array(body.length + 1);
    longer.set(body);
    assert.false(
      await fileContentEquals({ content: longer }, body),
      'a longer file differs',
    );
  });

  test('a web stream is compared across chunk boundaries', async function (assert) {
    let body = bytes(10_000);

    let same = webStream(chunksOf(body, 999));
    assert.true(
      await fileContentEquals({ content: same.stream }, body),
      'the same bytes in uneven chunks match',
    );

    let changed = body.slice();
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 0xff;
    assert.false(
      await fileContentEquals(
        { content: webStream(chunksOf(changed, 999)).stream },
        body,
      ),
      'a difference in the last chunk is found',
    );

    let shorter = webStream(chunksOf(body.slice(0, -1), 999));
    assert.false(
      await fileContentEquals({ content: shorter.stream }, body),
      'a stream that ends early differs',
    );

    let longer = new Uint8Array(body.length + 1);
    longer.set(body);
    assert.false(
      await fileContentEquals(
        { content: webStream(chunksOf(longer, 999)).stream },
        body,
      ),
      'a stream that runs past the body differs',
    );
  });

  test('a web stream stops being read at the first differing chunk', async function (assert) {
    let body = bytes(10_000);
    let changed = body.slice();
    changed[0] = changed[0]! ^ 0xff;
    let source = webStream(chunksOf(changed, 1_000));

    assert.false(await fileContentEquals({ content: source.stream }, body));
    assert.ok(
      source.served < 10,
      `the stream was not drained (served ${source.served} of 10)`,
    );
    assert.true(source.cancelled, 'the unread remainder is cancelled');
  });

  test('a node stream is compared across chunk boundaries', async function (assert) {
    let body = bytes(10_000);
    assert.true(
      await fileContentEquals(
        {
          content: Readable.from(
            chunksOf(body, 999).map((chunk) => Buffer.from(chunk)),
          ),
        },
        body,
      ),
      'the same bytes in uneven chunks match',
    );

    let changed = body.slice();
    changed[5_000] = changed[5_000]! ^ 0xff;
    let differing = Readable.from(
      chunksOf(changed, 999).map((chunk) => Buffer.from(chunk)),
    );
    assert.false(
      await fileContentEquals({ content: differing }, body),
      'a difference mid-stream is found',
    );
    assert.true(
      differing.destroyed,
      'the stream is destroyed rather than left open',
    );

    assert.false(
      await fileContentEquals(
        {
          content: Readable.from(
            chunksOf(body.slice(0, -1), 999).map((chunk) => Buffer.from(chunk)),
          ),
        },
        body,
      ),
      'a stream that ends early differs',
    );
  });

  test('a node stream of string chunks is compared by their UTF-8 bytes', async function (assert) {
    let text = 'ünïcödé text, '.repeat(50);
    let body = new TextEncoder().encode(text);
    let pieces = text.match(/.{1,7}/gs)!;

    assert.true(
      await fileContentEquals({ content: Readable.from(pieces) }, body),
      'string chunks holding the same text match',
    );
    assert.false(
      await fileContentEquals(
        { content: Readable.from([...pieces.slice(0, -1), 'x']) },
        body,
      ),
      'a changed final string chunk differs',
    );
  });
});
