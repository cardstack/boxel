import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { PassThrough } from 'node:stream';
import fsExtra from 'fs-extra';
const { createReadStream } = fsExtra;
import {
  getReader,
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
});
