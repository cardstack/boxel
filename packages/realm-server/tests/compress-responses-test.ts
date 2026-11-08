import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import Koa from 'koa';
import supertest from 'supertest';

import { compressResponses } from '../middleware/compress-responses.ts';

const big = JSON.stringify({ data: 'x'.repeat(5000) });

function app(handler: Koa.Middleware) {
  let koa = new Koa().use(compressResponses(true)).use(handler);
  return supertest(koa.callback());
}

// supertest unzips a gzip body itself; a body that still starts with the gzip
// magic bytes is unzipped here.
const gunzipped = (body: Buffer) =>
  body[0] === 0x1f && body[1] === 0x8b ? zlib.gunzipSync(body) : body;

const raw = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  let chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

module(basename(import.meta.filename), function () {
  test('a JSON body is sent with brotli where the client accepts it, gzip otherwise', async function (assert) {
    let json = app((ctx) => {
      ctx.type = 'application/vnd.card+json';
      ctx.set('ETag', '"v1"');
      ctx.body = big;
    });
    let br = await json
      .get('/')
      .set('Accept-Encoding', 'gzip, deflate, br')
      .buffer(true)
      .parse(raw);
    assert.strictEqual(br.headers['content-encoding'], 'br');
    assert.strictEqual(br.headers['etag'], '"v1"', 'the ETag is unchanged');
    assert.true(String(br.headers['vary']).includes('Accept-Encoding'));
    assert.strictEqual(
      zlib.brotliDecompressSync(br.body as Buffer).toString(),
      big,
    );
    assert.true((br.body as Buffer).length < big.length / 10);

    let gz = await json
      .get('/')
      .set('Accept-Encoding', 'gzip, br;q=0')
      .buffer(true)
      .parse(raw);
    assert.strictEqual(
      gz.headers['content-encoding'],
      'gzip',
      'br;q=0 is refused',
    );
    assert.strictEqual(gunzipped(gz.body as Buffer).toString(), big);

    let none = await json.get('/').set('Accept-Encoding', 'identity');
    assert.strictEqual(none.headers['content-encoding'], undefined);
    assert.strictEqual(none.text, big);
  });

  test('a 304 varies on Accept-Encoding, as the 200 it revalidates does', async function (assert) {
    let res = await app((ctx) => {
      ctx.status = 304;
    })
      .get('/')
      .set('Accept-Encoding', 'br');
    assert.strictEqual(res.status, 304);
    assert.true(String(res.headers['vary']).includes('Accept-Encoding'));
    assert.strictEqual(res.headers['content-encoding'], undefined);
  });

  test('a streamed body is compressed too', async function (assert) {
    let res = await app((ctx) => {
      ctx.type = 'application/json';
      ctx.body = Readable.from([big.slice(0, 2000), big.slice(2000)]);
    })
      .get('/')
      .set('Accept-Encoding', 'gzip')
      .buffer(true)
      .parse(raw);
    assert.strictEqual(res.headers['content-encoding'], 'gzip');
    assert.strictEqual(gunzipped(res.body as Buffer).toString(), big);
  });

  test('event streams, small bodies, binary types and HEAD are left alone', async function (assert) {
    let sse = await app((ctx) => {
      ctx.type = 'text/event-stream';
      ctx.body = 'data: ' + 'y'.repeat(4000) + '\n\n';
    })
      .get('/')
      .set('Accept-Encoding', 'br');
    assert.strictEqual(
      sse.headers['content-encoding'],
      undefined,
      'event stream',
    );

    let small = await app((ctx) => {
      ctx.type = 'application/json';
      ctx.body = '{"ok":true}';
    })
      .get('/')
      .set('Accept-Encoding', 'br');
    assert.strictEqual(
      small.headers['content-encoding'],
      undefined,
      'under 1 KB',
    );

    let image = await app((ctx) => {
      ctx.type = 'image/png';
      ctx.body = Buffer.alloc(4000);
    })
      .get('/')
      .set('Accept-Encoding', 'br');
    assert.strictEqual(image.headers['content-encoding'], undefined, 'binary');

    let head = await app((ctx) => {
      ctx.type = 'application/json';
      ctx.body = big;
    })
      .head('/')
      .set('Accept-Encoding', 'br');
    assert.strictEqual(head.headers['content-encoding'], undefined, 'HEAD');
  });
});
