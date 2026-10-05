import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PassThrough, Readable } from 'node:stream';
import { guardDeclaredLength } from '../lib/declared-length-guard.ts';

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

  test('a body whose source fails part-way destroys the response', async function (assert) {
    let response = fakeResponse();
    let source = new PassThrough();
    let guarded = guardDeclaredLength({
      body: source,
      declaredLength: 10,
      url: 'http://example.test/page.html',
      response,
    });
    source.write('hello');
    setImmediate(() => source.destroy(new Error('read failed')));

    await drain(guarded);
    assert.strictEqual(response.destroyedWith.length, 1, 'destroyed once');
    assert.true(
      /read failed/.test(response.destroyedWith[0].message),
      'carries the source failure',
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
});
