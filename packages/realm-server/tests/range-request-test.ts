import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import {
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// Byte-range serving of raw realm files (RFC 9110 §14): browsers will not
// treat media as seekable — Safari refuses playback outright, Chromium
// reports duration: Infinity for size-derived formats like PCM WAV — unless
// file responses carry Content-Length, advertise Accept-Ranges, and honor
// single byte ranges with a 206.
module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | Range requests', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let request: RealmRequest;
    let serverRequest: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'simple',
      realmURL,
      permissions: {
        '*': ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: (args) => {
        serverRequest = args.request;
        request = withRealmPath(args.request, realmURL);
      },
    });

    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Collect the raw bytes rather than letting supertest pick a text/JSON
    // parser from the content type — these assertions are about exact byte
    // slices.
    function binaryParser(
      res: unknown,
      callback: (err: Error | null, body: Buffer) => void,
    ) {
      let stream = res as NodeJS.ReadableStream;
      let chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => callback(null, Buffer.concat(chunks)));
    }

    async function uploadSample(path: string) {
      let response = await request
        .post(path)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(bytes));
      QUnit.assert.strictEqual(response.status, 204, 'sample file uploaded');
    }

    function getSample(path: string) {
      return request
        .get(path)
        .set('Accept', 'image/*')
        .buffer(true)
        .parse(binaryParser);
    }

    test('a full GET advertises range support and carries Content-Length', async function (assert) {
      await uploadSample('/full.png');
      let response = await getSample('/full.png');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(
        response.headers['accept-ranges'],
        'bytes',
        'Accept-Ranges advertises byte-range support',
      );
      assert.strictEqual(
        response.headers['content-length'],
        String(bytes.length),
        'Content-Length reports the full file size',
      );
      assert.deepEqual(
        new Uint8Array(response.body),
        bytes,
        'full body round-trips',
      );
    });

    test('a bounded range returns a 206 with just those bytes', async function (assert) {
      await uploadSample('/bounded.png');
      let response = await getSample('/bounded.png').set('Range', 'bytes=2-5');

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.strictEqual(
        response.headers['content-range'],
        `bytes 2-5/${bytes.length}`,
        'Content-Range reports the slice and the total',
      );
      assert.strictEqual(
        response.headers['content-length'],
        '4',
        'Content-Length matches the slice',
      );
      assert.deepEqual(
        new Uint8Array(response.body),
        new Uint8Array([2, 3, 4, 5]),
        'body is exactly the requested bytes',
      );
    });

    test('an open-ended range runs through the final byte', async function (assert) {
      await uploadSample('/open-ended.png');
      let response = await getSample('/open-ended.png').set(
        'Range',
        'bytes=6-',
      );

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.strictEqual(
        response.headers['content-range'],
        `bytes 6-9/${bytes.length}`,
      );
      assert.deepEqual(
        new Uint8Array(response.body),
        new Uint8Array([6, 7, 8, 9]),
      );
    });

    test('a suffix range selects the final N bytes', async function (assert) {
      await uploadSample('/suffix.png');
      let response = await getSample('/suffix.png').set('Range', 'bytes=-3');

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.strictEqual(
        response.headers['content-range'],
        `bytes 7-9/${bytes.length}`,
      );
      assert.deepEqual(
        new Uint8Array(response.body),
        new Uint8Array([7, 8, 9]),
      );
    });

    test('a last-byte position past the end is clamped', async function (assert) {
      await uploadSample('/clamped.png');
      let response = await getSample('/clamped.png').set(
        'Range',
        'bytes=8-999',
      );

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.strictEqual(
        response.headers['content-range'],
        `bytes 8-9/${bytes.length}`,
      );
      assert.deepEqual(new Uint8Array(response.body), new Uint8Array([8, 9]));
    });

    test('a range past the end of the file is unsatisfiable', async function (assert) {
      await uploadSample('/unsatisfiable.png');
      let response = await getSample('/unsatisfiable.png').set(
        'Range',
        'bytes=10-',
      );

      assert.strictEqual(response.status, 416, 'HTTP 416 status');
      assert.strictEqual(
        response.headers['content-range'],
        `bytes */${bytes.length}`,
        'Content-Range reports the total size for the client to retry with',
      );
    });

    test('a multi-range request is answered with the full representation', async function (assert) {
      await uploadSample('/multi.png');
      let response = await getSample('/multi.png').set(
        'Range',
        'bytes=0-1,4-5',
      );

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        new Uint8Array(response.body),
        bytes,
        'full body is served',
      );
    });

    test('If-Range with a stale validator falls back to the full body', async function (assert) {
      await uploadSample('/if-range.png');
      let response = await getSample('/if-range.png')
        .set('Range', 'bytes=2-5')
        .set('If-Range', '"some-other-etag"');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(
        new Uint8Array(response.body),
        bytes,
        'the client’s offsets referred to a different representation, so the full body is served',
      );
    });

    test('If-Range with the current ETag still yields the 206', async function (assert) {
      await uploadSample('/if-range-match.png');
      let etag = (await getSample('/if-range-match.png')).headers['etag'];
      assert.ok(etag, 'file response carries an ETag');

      let response = await getSample('/if-range-match.png')
        .set('Range', 'bytes=2-5')
        .set('If-Range', etag);

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.deepEqual(
        new Uint8Array(response.body),
        new Uint8Array([2, 3, 4, 5]),
      );
    });

    test('If-None-Match takes precedence over Range', async function (assert) {
      await uploadSample('/revalidate.png');
      let etag = (await getSample('/revalidate.png')).headers['etag'];
      assert.ok(etag, 'file response carries an ETag');

      let response = await getSample('/revalidate.png')
        .set('Range', 'bytes=2-5')
        .set('If-None-Match', etag);

      assert.strictEqual(response.status, 304, 'HTTP 304 status');
    });

    // CORS treatment of byte-range media requests. Native <audio>/<video>
    // elements cannot attach Authorization, so the host's auth service worker
    // re-issues their requests as mode:'cors' with the token injected. That
    // rewrite turns the media element's Range header into an author header
    // needing preflight approval, and makes the 206's descriptive headers
    // (Content-Range, Accept-Ranges) visible to the player's loading stack
    // only when exposed.
    test('preflight approves Range and If-Range author headers', async function (assert) {
      let response = await serverRequest
        .options('/test/preflight.png')
        .set('Origin', 'https://app.example')
        .set('Access-Control-Request-Method', 'GET')
        .set(
          'Access-Control-Request-Headers',
          'range, if-range, authorization',
        );

      assert.strictEqual(response.status, 204, 'HTTP 204 status');
      let allowed = (response.headers['access-control-allow-headers'] ?? '')
        .toLowerCase()
        .split(/,\s*/);
      assert.true(allowed.includes('range'), 'Range is approved');
      assert.true(allowed.includes('if-range'), 'If-Range is approved');
      assert.true(
        allowed.includes('authorization'),
        'Authorization is approved',
      );
    });

    test('a ranged response exposes its range headers to cross-origin JS', async function (assert) {
      await uploadSample('/cors-expose.png');
      let response = await getSample('/cors-expose.png')
        .set('Origin', 'https://app.example')
        .set('Range', 'bytes=2-5');

      assert.strictEqual(response.status, 206, 'HTTP 206 status');
      assert.strictEqual(
        response.headers['access-control-allow-origin'],
        '*',
        'the response is a CORS response, without which no expose list is consulted',
      );
      let exposed = (response.headers['access-control-expose-headers'] ?? '')
        .toLowerCase()
        .split(/,\s*/);
      assert.true(
        exposed.includes('content-range'),
        'Content-Range is exposed',
      );
      assert.true(
        exposed.includes('accept-ranges'),
        'Accept-Ranges is exposed',
      );
      assert.true(
        exposed.includes('content-length'),
        'Content-Length is exposed',
      );
    });
  });
});
