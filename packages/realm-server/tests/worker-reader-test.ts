import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { PassThrough } from 'node:stream';
import fsExtra from 'fs-extra';
const { createReadStream } = fsExtra;
import {
  getReader,
  ReaderStallError,
  type ResponseWithNodeStream,
} from '@cardstack/runtime-common';

const realmURL = 'http://127.0.0.1:4444/test/';

function okResponseWithNodeStream(
  stream: NodeJS.ReadableStream,
): ResponseWithNodeStream {
  let response = new Response(null, {
    status: 200,
    headers: { 'last-modified': 'Tue, 05 Nov 2024 01:02:03 GMT' },
  }) as ResponseWithNodeStream;
  response.nodeStream = stream as ResponseWithNodeStream['nodeStream'];
  return response;
}

const lastModifiedHeaders = {
  'last-modified': 'Tue, 05 Nov 2024 01:02:03 GMT',
};

// A response whose body sends `sent` and then neither ends nor sends anything
// more, declaring the length of `declared` — the shape of a body that stops
// short of its Content-Length.
function stalledBodyResponse(sent: string, declared: string): Response {
  let encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sent));
      },
    }),
    {
      status: 200,
      headers: {
        ...lastModifiedHeaders,
        'content-length': String(encoder.encode(declared).byteLength),
      },
    },
  );
}

function completeResponse(content: string): Response {
  return new Response(content, { status: 200, headers: lastModifiedHeaders });
}

module(basename(import.meta.filename), function () {
  test('readFile treats a file that vanishes between the response and the body read as not found', async function (assert) {
    // A realm serving an in-process worker hands back a lazy node stream:
    // the open() syscall happens when the body is consumed, not when the
    // response is built. A concurrent delete in that window surfaces as an
    // ENOENT on the body read of an otherwise-ok response. Model that with
    // a read stream pointing at a path that no longer exists.
    let vanishedPath = join(
      tmpdir(),
      `worker-reader-test-vanished-${process.pid}.txt`,
    );
    let reader = getReader(
      async () => okResponseWithNodeStream(createReadStream(vanishedPath)),
      realmURL,
    );

    let result = await reader.readFile(new URL(`${realmURL}vanished.txt`));

    assert.strictEqual(
      result,
      undefined,
      'a vanished file reads as not found instead of rejecting with ENOENT',
    );
  });

  test('readFile propagates non-ENOENT body read failures', async function (assert) {
    let stream = new PassThrough();
    let reader = getReader(
      async () => okResponseWithNodeStream(stream),
      realmURL,
    );

    let readPromise = reader.readFile(new URL(`${realmURL}unlucky.txt`));
    setImmediate(() => stream.destroy(new Error('stream exploded')));

    await assert.rejects(
      readPromise,
      /stream exploded/,
      'a body read failure that is not a missing file still rejects',
    );
  });

  test('readFile returns undefined for a not-ok response', async function (assert) {
    let reader = getReader(
      async () => new Response(null, { status: 404 }),
      realmURL,
    );

    let result = await reader.readFile(new URL(`${realmURL}missing.txt`));

    assert.strictEqual(result, undefined, 'a 404 reads as not found');
  });

  // A response that a fetch reached by following a redirect to `finalURL`.
  // `redirected` and `url` are read-only on a constructed Response, so they
  // are defined the way a following fetch reports them.
  function redirectedResponse(content: string, finalURL: string): Response {
    let response = completeResponse(content);
    Object.defineProperty(response, 'redirected', { value: true });
    Object.defineProperty(response, 'url', { value: finalURL });
    return response;
  }

  test('a source read redirected to another path reads as not found', async function (assert) {
    let cardJSON = '{"data":{"type":"card"}}';
    let reader = getReader(
      async () => redirectedResponse(cardJSON, `${realmURL}person-1.json`),
      realmURL,
    );
    let cardId = new URL(`${realmURL}person-1`);

    assert.strictEqual(
      await reader.readFile(cardId),
      undefined,
      'readFile finds no file at the path',
    );
    assert.strictEqual(
      await reader.readStream(cardId),
      undefined,
      'readStream finds no file at the path',
    );
  });

  test('a source read redirected to another path releases the body it does not read', async function (assert) {
    let cancelled = 0;
    let reader = getReader(async () => {
      let response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":{}}'));
          },
          cancel() {
            cancelled++;
          },
        }),
        { status: 200, headers: lastModifiedHeaders },
      );
      Object.defineProperty(response, 'redirected', { value: true });
      Object.defineProperty(response, 'url', {
        value: `${realmURL}person-1.json`,
      });
      return response;
    }, realmURL);
    let cardId = new URL(`${realmURL}person-1`);

    await reader.readFile(cardId);
    await reader.readStream(cardId);

    assert.strictEqual(cancelled, 2, 'each dropped body is cancelled');
  });

  test('a source read redirected to the same path reads the file', async function (assert) {
    let reader = getReader(
      async () =>
        redirectedResponse(
          'hello',
          `${realmURL.replace('http:', 'https:')}notes.txt`,
        ),
      realmURL,
    );

    let result = await reader.readFile(new URL(`${realmURL}notes.txt`));

    assert.strictEqual(result?.content, 'hello', 'the file is read');
  });

  test('readFile abandons a body that stops arriving and reads it again', async function (assert) {
    let requests = 0;
    let reader = getReader(
      async () => {
        requests++;
        return requests === 1
          ? stalledBodyResponse('<p>hel', '<p>hello</p>')
          : completeResponse('<p>hello</p>');
      },
      realmURL,
      { stallTimeoutMs: 50 },
    );

    let result = await reader.readFile(new URL(`${realmURL}page.html`));

    assert.strictEqual(requests, 2, 'the stalled read is retried once');
    assert.strictEqual(result?.content, '<p>hello</p>', 'the retry is used');
  });

  test('readFile reports a stall it cannot get past', async function (assert) {
    let requests = 0;
    let reader = getReader(
      async () => {
        requests++;
        return stalledBodyResponse('<p>hel', '<p>hello</p>');
      },
      realmURL,
      { stallTimeoutMs: 50 },
    );

    await assert.rejects(
      reader.readFile(new URL(`${realmURL}page.html`)),
      (error: unknown) =>
        error instanceof ReaderStallError && error.phase === 'body',
      'the read fails with a stall in the body',
    );
    assert.strictEqual(requests, 2, 'it was tried twice');
  });

  test('readFile abandons a response that never arrives, even from a fetch that ignores its signal', async function (assert) {
    let requests = 0;
    let reader = getReader(
      async () => {
        requests++;
        if (requests === 1) {
          return new Promise<Response>(() => undefined);
        }
        return completeResponse('hello');
      },
      realmURL,
      { stallTimeoutMs: 50 },
    );

    let result = await reader.readFile(new URL(`${realmURL}page.txt`));

    assert.strictEqual(requests, 2, 'the stalled request is retried once');
    assert.strictEqual(result?.content, 'hello');
  });

  test('readFile does not retry a failure a fresh request cannot fix', async function (assert) {
    let requests = 0;
    let reader = getReader(
      async () => {
        requests++;
        return new Response('hello', { status: 200 });
      },
      realmURL,
      { stallTimeoutMs: 50 },
    );

    await assert.rejects(
      reader.readFile(new URL(`${realmURL}page.txt`)),
      /has no 'last-modified' header/,
    );
    assert.strictEqual(requests, 1, 'tried once');
  });

  test('readStream abandons a response that never arrives', async function (assert) {
    let requests = 0;
    let reader = getReader(
      async () => {
        requests++;
        if (requests === 1) {
          return new Promise<Response>(() => undefined);
        }
        return completeResponse('hello');
      },
      realmURL,
      { stallTimeoutMs: 50 },
    );

    let result = await reader.readStream(new URL(`${realmURL}page.txt`));

    assert.strictEqual(requests, 2, 'the stalled request is retried once');
    assert.ok(result?.stream, 'the retry is used');
  });

  test('readFile reads again when the connection under a body fails', async function (assert) {
    let requests = 0;
    let encoder = new TextEncoder();
    let reader = getReader(
      async () => {
        requests++;
        if (requests > 1) {
          return completeResponse('<p>hello</p>');
        }
        // The body a server tears down part-way: some bytes, then the error
        // the fetch implementation reports for a dropped connection.
        let sent = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(encoder.encode('<p>hel'));
                return;
              }
              controller.error(new TypeError('terminated'));
            },
          }),
          { status: 200, headers: lastModifiedHeaders },
        );
      },
      realmURL,
      { stallTimeoutMs: 1000 },
    );

    let result = await reader.readFile(new URL(`${realmURL}page.html`));

    assert.strictEqual(requests, 2, 'the dropped transfer is retried once');
    assert.strictEqual(result?.content, '<p>hello</p>', 'the retry is used');
  });
});
