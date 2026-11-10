import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PassThrough, Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Koa from 'koa';
import supertest from 'supertest';
import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import { guardDeclaredLength } from '../lib/declared-length-guard.ts';
import { isVanishedFileBody, setContextResponse } from '../middleware/index.ts';

function fakeResponse() {
  let destroyedWith: Error[] = [];
  return {
    destroyedWith,
    destroy(error?: Error) {
      destroyedWith.push(error ?? new Error('destroyed'));
    },
  };
}

async function drain(stream: Readable): Promise<string> {
  let chunks: Buffer[] = [];
  try {
    for await (let chunk of stream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
  } catch (_err) {
    // A guard that gives up ends the stream it returned early; the response is
    // what the assertions look at.
  }
  // Let the pipeline report the outcome of its source.
  await new Promise((resolve) => setImmediate(resolve));
  return Buffer.concat(chunks).toString('utf8');
}

module(basename(import.meta.filename), function () {
  test('a body that matches its declared length passes through untouched', async function (assert) {
    let response = fakeResponse();
    let guarded = guardDeclaredLength({
      body: Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      declaredLength: 11,
      url: 'http://example.test/page.html',
      response,
    });

    assert.strictEqual(await drain(guarded), 'hello world');
    assert.deepEqual(response.destroyedWith, [], 'the response is left alone');
  });

  test('a body that ends short of its declared length destroys the response', async function (assert) {
    let response = fakeResponse();
    let guarded = guardDeclaredLength({
      body: Readable.from([Buffer.from('hello')]),
      declaredLength: 6,
      url: 'http://example.test/page.html',
      response,
    });

    await drain(guarded);
    assert.strictEqual(response.destroyedWith.length, 1, 'destroyed once');
    assert.true(
      /ended at 5 bytes, short of its declared Content-Length 6/.test(
        response.destroyedWith[0].message,
      ),
      `names the shortfall: ${response.destroyedWith[0].message}`,
    );
  });

  test('a body that runs past its declared length destroys the response', async function (assert) {
    let response = fakeResponse();
    let guarded = guardDeclaredLength({
      body: Readable.from([Buffer.from('hello'), Buffer.from(' world')]),
      declaredLength: 5,
      url: 'http://example.test/page.html',
      response,
    });

    await drain(guarded);
    assert.strictEqual(response.destroyedWith.length, 1, 'destroyed once');
    assert.true(
      /ran past its declared Content-Length 5/.test(
        response.destroyedWith[0].message,
      ),
      `names the overrun: ${response.destroyedWith[0].message}`,
    );
  });

  test('a body whose source fails part-way destroys the response, leaving the report to the stream error', async function (assert) {
    let response = fakeResponse();
    let source = new PassThrough();
    let guarded = guardDeclaredLength({
      body: source,
      declaredLength: 10,
      url: 'http://example.test/page.html',
      response,
    });
    let streamError = new Promise<Error>((resolve) =>
      guarded.once('error', resolve),
    );
    source.write('hello');
    setImmediate(() => source.destroy(new Error('read failed')));

    await drain(guarded);
    assert.strictEqual(response.destroyedWith.length, 1, 'destroyed once');
    assert.strictEqual(
      response.destroyedWith[0].message,
      'destroyed',
      'the response is destroyed without an error of its own',
    );
    assert.strictEqual(
      (await streamError).message,
      'read failed',
      'the guarded stream carries the source failure',
    );
  });

  test('an HTTP/2 response is reset through its stream', async function (assert) {
    let destroyedWith: Error[] = [];
    let response = {
      stream: {
        destroy(error?: Error) {
          destroyedWith.push(error ?? new Error('destroyed'));
        },
      },
    };
    let guarded = guardDeclaredLength({
      body: Readable.from([Buffer.from('hello')]),
      declaredLength: 6,
      url: 'http://example.test/page.html',
      response,
    });

    await drain(guarded);
    assert.strictEqual(destroyedWith.length, 1, 'the stream is reset');
  });

  test('a client that goes away destroys the source behind the body', async function (assert) {
    let response = fakeResponse();
    let source = new PassThrough();
    let guarded = guardDeclaredLength({
      body: source,
      declaredLength: 10,
      url: 'http://example.test/page.html',
      response,
    });
    let closed = new Promise<void>((resolve) => source.once('close', resolve));

    guarded.destroy();
    await closed;
    assert.true(source.destroyed, 'the source is destroyed with the body');
    assert.deepEqual(
      response.destroyedWith,
      [],
      'a client that left needs no response torn down',
    );
  });

  module('a file body that is gone when it is read', function () {
    // A Koa app that serves `body` the way the realm server sets a file
    // response, and records the errors Koa hands its error listener.
    async function serve(
      handle: (ctxt: Koa.Context) => Promise<void>,
    ): Promise<{ status: number; errors: Error[] }> {
      let errors: Error[] = [];
      let app = new Koa().use(handle);
      app.on('error', (error: Error) => errors.push(error));
      let { status } = await supertest(app.callback()).get('/file.png');
      return { status, errors };
    }

    function fileResponse(
      headers: Record<string, string> = {},
    ): ResponseWithNodeStream {
      let response = new Response(null, {
        headers,
      }) as ResponseWithNodeStream;
      response.nodeStream = createReadStream(
        join(tmpdir(), `no-such-file-${process.pid}-${Date.now()}.png`),
      );
      return response;
    }

    test('a file body whose read finds the file gone is marked as vanished', async function (assert) {
      let { status, errors } = await serve((ctxt) =>
        setContextResponse(ctxt, fileResponse()),
      );
      assert.strictEqual(status, 404, 'answered as nothing there');
      assert.strictEqual(errors.length, 1, 'Koa reports the read failure');
      assert.true(isVanishedFileBody(errors[0]), 'marked as a vanished file');
    });

    test('a file body with a declared length is marked as vanished too', async function (assert) {
      let { errors } = await serve((ctxt) =>
        setContextResponse(ctxt, fileResponse({ 'content-length': '10' })),
      );
      assert.strictEqual(errors.length, 1, 'Koa reports the read failure');
      assert.true(isVanishedFileBody(errors[0]), 'marked as a vanished file');
    });

    test('the same error raised anywhere else is not marked', async function (assert) {
      let { status, errors } = await serve(async () => {
        let error = new Error('ENOENT: no such file or directory');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      });
      assert.strictEqual(status, 404);
      assert.strictEqual(errors.length, 1, 'Koa reports the error');
      assert.false(
        isVanishedFileBody(errors[0]),
        'an error a handler raised is reported as it always was',
      );
    });
  });
});
