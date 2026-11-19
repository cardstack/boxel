import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import http from 'http';
import { PassThrough } from 'stream';
import zlib from 'zlib';
import Koa from 'koa';
import type { Test, SuperTest } from 'supertest';
import {
  rri,
  SupportedMimeType,
  X_BOXEL_UNCOMPRESSED_LENGTH_HEADER,
  type LooseSingleCardDocument,
  type Realm,
} from '@cardstack/runtime-common';
import {
  compressResponse,
  MIN_COMPRESSIBLE_BYTES,
} from '../middleware/compress-response.ts';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  // The bytes as they crossed the wire, still encoded.
  body: Buffer;
}

// A request through node's own client, which neither asks for an encoding nor
// decodes one, so a test sees exactly what the server sent.
function send(
  server: http.Server,
  path: string,
  {
    method = 'GET',
    headers = {},
  }: { method?: string; headers?: Record<string, string> } = {},
): Promise<RawResponse> {
  let { port } = server.address() as import('net').AddressInfo;
  return new Promise((resolve, reject) => {
    let req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function decode(response: RawResponse): string {
  switch (response.headers['content-encoding']) {
    case 'br':
      return zlib.brotliDecompressSync(response.body).toString();
    case 'gzip':
      return zlib.gunzipSync(response.body).toString();
    default:
      return response.body.toString();
  }
}

// A JSON document comfortably past the size the middleware starts compressing
// at, and repetitive the way card and search documents are.
const largeDocument = JSON.stringify({
  data: Array.from({ length: 50 }, (_, i) => ({
    type: 'card',
    id: `http://example.test/realm/Person/${i}`,
    attributes: { firstName: `Person ${i}`, cardDescription: 'A person' },
  })),
});

function binaryParser(
  res: unknown,
  callback: (err: Error | null, body: Buffer) => void,
) {
  let stream = res as NodeJS.ReadableStream;
  let chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

module(basename(import.meta.filename), function () {
  module('compressResponse', function (hooks) {
    let server: http.Server;
    let handler: (ctxt: Koa.Context) => void | Promise<void>;

    hooks.before(async function () {
      let app = new Koa()
        .use(compressResponse)
        .use(async (ctxt) => await handler(ctxt));
      server = http.createServer(app.callback());
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    });

    hooks.after(async function () {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    hooks.beforeEach(function () {
      handler = (ctxt) => {
        ctxt.type = SupportedMimeType.CardJson;
        ctxt.body = largeDocument;
      };
    });

    test('sends brotli to a client that accepts it, measured as sent', async function (assert) {
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'gzip, deflate, br' },
      });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-encoding'], 'br');
      assert.strictEqual(
        decode(response),
        largeDocument,
        'the body decodes to the document',
      );
      assert.strictEqual(
        Number(response.headers['content-length']),
        response.body.length,
        'Content-Length is the compressed length',
      );
      assert.ok(
        response.body.length < Buffer.byteLength(largeDocument) / 4,
        `the body is compressed (${response.body.length} of ${Buffer.byteLength(largeDocument)} bytes)`,
      );
      assert.strictEqual(
        response.headers[X_BOXEL_UNCOMPRESSED_LENGTH_HEADER],
        String(Buffer.byteLength(largeDocument)),
        'the uncompressed length is named',
      );
      assert.strictEqual(
        response.headers['content-type'],
        SupportedMimeType.CardJson,
        'the content type is kept',
      );
      assert.strictEqual(response.headers['vary'], 'Accept-Encoding');
    });

    test('exposes the uncompressed length wherever the response exposes headers', async function (assert) {
      handler = (ctxt) => {
        ctxt.type = SupportedMimeType.CardJson;
        ctxt.set('Access-Control-Expose-Headers', 'ETag,Content-Length');
        ctxt.body = largeDocument;
      };
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(
        response.headers['access-control-expose-headers'],
        `ETag,Content-Length, ${X_BOXEL_UNCOMPRESSED_LENGTH_HEADER}`,
      );
    });

    test('sends gzip to a client that does not accept brotli', async function (assert) {
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'gzip, deflate' },
      });
      assert.strictEqual(response.headers['content-encoding'], 'gzip');
      assert.strictEqual(decode(response), largeDocument);
      assert.strictEqual(
        Number(response.headers['content-length']),
        response.body.length,
      );
    });

    test("follows the client's stated preference", async function (assert) {
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br;q=0.5, gzip' },
      });
      assert.strictEqual(response.headers['content-encoding'], 'gzip');

      response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'gzip, br;q=0' },
      });
      assert.strictEqual(
        response.headers['content-encoding'],
        'gzip',
        'a coding refused with q=0 is not sent',
      );

      response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': '*' },
      });
      assert.strictEqual(
        response.headers['content-encoding'],
        'br',
        'a wildcard accepts brotli',
      );
    });

    test('sends the body as it is to a client that accepts no encoding, varying on the header', async function (assert) {
      let response = await send(server, '/realm/person');
      assert.strictEqual(response.headers['content-encoding'], undefined);
      assert.strictEqual(response.body.toString(), largeDocument);
      assert.strictEqual(
        response.headers[X_BOXEL_UNCOMPRESSED_LENGTH_HEADER],
        undefined,
      );
      assert.strictEqual(
        response.headers['vary'],
        'Accept-Encoding',
        'a cache keys on the header even for the identity body',
      );
    });

    test('compresses an object body as the JSON Koa would send', async function (assert) {
      let document = JSON.parse(largeDocument);
      handler = (ctxt) => {
        ctxt.body = document;
      };
      let response = await send(server, '/_federated-search', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.headers['content-encoding'], 'br');
      assert.deepEqual(JSON.parse(decode(response)), document);
    });

    test('leaves a body under the threshold as it is', async function (assert) {
      handler = (ctxt) => {
        ctxt.type = 'application/json';
        ctxt.body = 'x'.repeat(MIN_COMPRESSIBLE_BYTES - 1);
      };
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.headers['content-encoding'], undefined);
      assert.strictEqual(
        response.headers['vary'],
        'Accept-Encoding',
        'a larger body at the same URL would be compressed',
      );
    });

    test('a 304 varies like the 200 it revalidates, whatever it is typed', async function (assert) {
      handler = (ctxt) => {
        ctxt.status = 304;
        // What a realm 304 is typed when it names no type of its own.
        ctxt.type = 'application/octet-stream';
      };
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.status, 304);
      assert.strictEqual(response.headers['vary'], 'Accept-Encoding');

      response = await send(server, '/_server-session', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(
        response.headers['vary'],
        undefined,
        'a route that is never compressed does not vary on the coding',
      );
    });

    test('leaves binary media as it is', async function (assert) {
      handler = (ctxt) => {
        ctxt.type = 'image/png';
        ctxt.body = Buffer.alloc(4 * MIN_COMPRESSIBLE_BYTES);
      };
      let response = await send(server, '/realm/image.png', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.headers['content-encoding'], undefined);
      assert.strictEqual(response.body.length, 4 * MIN_COMPRESSIBLE_BYTES);
    });

    test('streams an event stream without holding back its events', async function (assert) {
      let stream = new PassThrough();
      handler = (ctxt) => {
        ctxt.type = 'text/event-stream';
        ctxt.body = stream;
      };
      let { port } = server.address() as import('net').AddressInfo;
      let firstEvent =
        'data: ' + 'x'.repeat(2 * MIN_COMPRESSIBLE_BYTES) + '\n\n';
      let received = await new Promise<{
        headers: http.IncomingHttpHeaders;
        chunk: string;
      }>((resolve, reject) => {
        let req = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/realm/_message',
            headers: { 'Accept-Encoding': 'br, gzip' },
          },
          (res) => {
            res.once('data', (chunk: Buffer) => {
              resolve({ headers: res.headers, chunk: chunk.toString() });
              res.destroy();
            });
          },
        );
        req.on('error', reject);
        req.end();
        // The first event is written while the stream stays open: it reaches
        // the client only if nothing waits for the stream to end.
        stream.write(firstEvent);
      });
      stream.end();
      assert.strictEqual(received.headers['content-encoding'], undefined);
      assert.ok(
        received.chunk.startsWith('data: '),
        'the first event arrives before the stream ends',
      );
    });

    test('leaves the responses of token-bearing endpoints as they are', async function (assert) {
      for (let path of [
        '/_server-session',
        '/realm/_session',
        '/_realm-auth',
        '/_delegate-session',
        '/_oauth-provider/token',
      ]) {
        let response = await send(server, path, {
          headers: { 'Accept-Encoding': 'br' },
        });
        assert.strictEqual(
          response.headers['content-encoding'],
          undefined,
          `${path} is not compressed`,
        );
      }
    });

    test('compresses search and info endpoints', async function (assert) {
      for (let path of [
        '/_federated-search',
        '/_federated-info',
        '/realm/_search',
        '/realm/_info',
        '/realm/_mtimes',
      ]) {
        let response = await send(server, path, {
          headers: { 'Accept-Encoding': 'br' },
        });
        assert.strictEqual(
          response.headers['content-encoding'],
          'br',
          `${path} is compressed`,
        );
      }
    });

    test('leaves a range, and a response to a range request, as they are', async function (assert) {
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br', Range: 'bytes=0-99' },
      });
      assert.strictEqual(response.headers['content-encoding'], undefined);

      handler = (ctxt) => {
        ctxt.status = 206;
        ctxt.type = 'text/plain';
        ctxt.body = largeDocument;
      };
      response = await send(server, '/realm/notes.txt', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.status, 206);
      assert.strictEqual(response.headers['content-encoding'], undefined);
    });

    test('leaves a response marked no-transform, or already encoded, as it is', async function (assert) {
      handler = (ctxt) => {
        ctxt.type = SupportedMimeType.CardJson;
        ctxt.set('Cache-Control', 'public, no-transform');
        ctxt.body = largeDocument;
      };
      let response = await send(server, '/realm/person', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.headers['content-encoding'], undefined);

      let gzipped = zlib.gzipSync(largeDocument);
      handler = (ctxt) => {
        ctxt.type = 'application/javascript';
        ctxt.set('Content-Encoding', 'gzip');
        ctxt.body = gzipped;
      };
      response = await send(server, '/realm/module.js', {
        headers: { 'Accept-Encoding': 'br' },
      });
      assert.strictEqual(response.headers['content-encoding'], 'gzip');
      assert.ok(response.body.equals(gzipped), 'not encoded twice');
    });

    test('a HEAD reports the encoding and length its GET is sent with', async function (assert) {
      let headers = { 'Accept-Encoding': 'br' };
      let get = await send(server, '/realm/person', { headers });
      let head = await send(server, '/realm/person', {
        method: 'HEAD',
        headers,
      });
      assert.strictEqual(head.body.length, 0, 'the HEAD has no body');
      for (let header of [
        'content-encoding',
        'content-length',
        'vary',
        X_BOXEL_UNCOMPRESSED_LENGTH_HEADER,
      ]) {
        assert.ok(get.headers[header], `the GET carries ${header}`);
        assert.strictEqual(
          head.headers[header],
          get.headers[header],
          `the HEAD carries the same ${header}`,
        );
      }
    });
  });

  module('responses of the realm server', function (hooks) {
    let request: SuperTest<Test>;
    let realmPath: string;
    let realmHref: string;

    let realmURL = testRealmURLFor('compression/');

    function buildFileSystem(): Record<
      string,
      string | LooseSingleCardDocument
    > {
      let fs: Record<string, string | LooseSingleCardDocument> = {
        'person.gts': `
          import { contains, field, CardDef } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            @field biography = contains(StringField);
          }
        `,
      };
      for (let i = 0; i < 5; i++) {
        fs[`person-${i}.json`] = {
          data: {
            attributes: {
              firstName: `Person ${i}`,
              biography: `Person ${i} was born. `.repeat(100),
            },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        } as LooseSingleCardDocument;
      }
      return fs;
    }

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      realmHref = args.testRealm.url;
      realmPath = new URL(args.testRealm.url).pathname;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup,
    });

    test('a card document is compressed, and its validator still revalidates', async function (assert) {
      let response = await request
        .get(`${realmPath}person-0`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Accept-Encoding', 'br')
        .set('Origin', 'https://app.example.test')
        .buffer(true)
        .parse(binaryParser);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-encoding'], 'br');
      let body = response.body as Buffer;
      assert.strictEqual(
        Number(response.headers['content-length']),
        body.length,
        'Content-Length is the compressed length',
      );
      let text = zlib.brotliDecompressSync(body).toString();
      assert.strictEqual(
        response.headers[X_BOXEL_UNCOMPRESSED_LENGTH_HEADER],
        String(Buffer.byteLength(text)),
      );
      let doc = JSON.parse(text);
      assert.strictEqual(doc.data.id, `${realmHref}person-0`);
      assert.ok(
        /Accept-Encoding/.test(response.headers['vary'] ?? ''),
        'the response varies on Accept-Encoding',
      );
      assert.ok(
        new RegExp(X_BOXEL_UNCOMPRESSED_LENGTH_HEADER, 'i').test(
          response.headers['access-control-expose-headers'] ?? '',
        ),
        'a browser caller can read the uncompressed length',
      );

      let etag = response.headers['etag'];
      assert.ok(etag, 'the response carries a validator');
      let revalidated = await request
        .get(`${realmPath}person-0`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Accept-Encoding', 'br')
        .set('If-None-Match', etag);
      assert.strictEqual(
        revalidated.status,
        304,
        'the validator of a compressed response matches when it comes back',
      );
      assert.strictEqual(
        revalidated.headers['etag'],
        etag,
        'the 304 names the validator the client holds',
      );
    });

    test('a federated search is compressed', async function (assert) {
      let response = await request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept-Encoding', 'gzip, br')
        .buffer(true)
        .parse(binaryParser)
        .send({
          filter: {
            'item.on': { module: `${realmHref}person`, name: 'Person' },
          },
          realms: [realmHref],
        });
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers['content-encoding'], 'br');
      let doc = JSON.parse(
        zlib.brotliDecompressSync(response.body as Buffer).toString(),
      );
      assert.strictEqual(doc.data.length, 5, 'every person is found');
    });
  });
});
