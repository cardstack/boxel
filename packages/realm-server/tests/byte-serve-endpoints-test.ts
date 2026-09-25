import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { utimesSync, writeFileSync } from 'fs';
import type { Realm } from '@cardstack/runtime-common';
import {
  CONTENT_HASH_HEAD_BYTES,
  CONTENT_HASH_TAIL_BYTES,
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// The raw byte serve: a `GET` for a stored file under any `Accept` the realm's
// router does not claim. It is reached by falling through the router rather
// than by matching a route, which is why it answers for content types nothing
// registers — an image, a PDF, a markdown document — and why what it serves is
// the bytes on disk rather than a document assembled from the index.
//
// Its neighbour on the same path is the `card+source` route, which a client
// selects with `Accept: application/vnd.card+source`. The two serve the same
// bytes and differ in what they resolve and in the validator each builds, so
// several of the assertions here exist to hold that difference still.
//
// Reaching this serve at all means choosing an `Accept` no route claims, which
// is narrower than it looks: `text/markdown`, `text/html`, `application/json`
// and `application/octet-stream` are all registered mime types whose routes
// answer from the index. So a text file is requested here as `text/plain` and
// an image as `image/*` — the served content type is inferred from the file
// name either way, which is what the assertions below read.
module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | raw file byte serve', function () {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmPath: string;
    let request: RealmRequest;

    // Bytes that are not valid UTF-8, so a response that decoded them as text
    // instead of moving them verbatim shows up as a length mismatch rather
    // than as a passing assertion about a lossy string.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0x00, 0x01,
    ]);

    // Collect the raw bytes rather than letting supertest pick a text or JSON
    // parser from the content type.
    function binaryParser(
      res: unknown,
      callback: (err: Error | null, body: Buffer) => void,
    ) {
      let stream = res as NodeJS.ReadableStream;
      let chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => callback(null, Buffer.concat(chunks)));
    }

    async function upload(path: string, bytes: Uint8Array) {
      let response = await request
        .post(path)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(bytes));
      QUnit.assert.strictEqual(response.status, 204, `${path} uploaded`);
    }

    module('public readable realm', function (hooks) {
      // Each test reads a fixture file nothing mutates or writes to a path
      // unique to that test, so one boot is shared across the module.
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        mode: 'before',
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup: (args) => {
          testRealm = args.testRealm;
          testRealmPath = args.testRealmPath;
          request = withRealmPath(args.request, realmURL);
        },
      });

      test('an image GET serves the stored bytes with an inferred content type', async function (assert) {
        await upload('/inferred.png', pngBytes);

        let response = await request
          .get('/inferred.png')
          .set('Accept', 'image/*')
          .buffer(true)
          .parse(binaryParser);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['content-type'],
          'image/png',
          'the content type is inferred from the file name, not from the request',
        );
        assert.deepEqual(
          new Uint8Array(response.body),
          pngBytes,
          'the bytes round-trip unchanged',
        );
        assert.strictEqual(
          response.headers['content-length'],
          String(pngBytes.length),
          'Content-Length reports the stored size',
        );
        assert.ok(response.headers['etag'], 'a validator is present');
        assert.ok(
          response.headers['last-modified'],
          'the modification time is present',
        );
        assert.strictEqual(
          response.get('X-boxel-realm-url'),
          testRealmHref,
          'the realm identity headers ride along',
        );
      });

      test('an image carries a revalidating Cache-Control and a text file does not', async function (assert) {
        await upload('/cache-directive.png', pngBytes);
        await testRealm.write('cache-directive.md', '# Notes\n');

        let image = await request
          .get('/cache-directive.png')
          .set('Accept', 'image/*');
        let text = await request
          .get('/cache-directive.md')
          .set('Accept', 'text/plain');

        assert.strictEqual(
          image.headers['cache-control'],
          'public, max-age=60, must-revalidate',
          'an image is held briefly and revalidated',
        );
        assert.strictEqual(
          text.headers['cache-control'],
          'public, max-age=0',
          'everything else revalidates every time',
        );
        assert.strictEqual(
          text.headers['content-type'],
          'text/markdown',
          'a markdown file is served as markdown',
        );
      });

      test('a matching If-None-Match answers 304 with no body', async function (assert) {
        await upload('/conditional.png', pngBytes);

        let first = await request
          .get('/conditional.png')
          .set('Accept', 'image/*');
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        let second = await request
          .get('/conditional.png')
          .set('Accept', 'image/*')
          .set('If-None-Match', etag);

        assert.strictEqual(second.status, 304, 'HTTP 304 status');
        assert.strictEqual(
          second.headers['etag'],
          etag,
          'the 304 echoes the validator it matched',
        );
        assert.ok(
          second.headers['last-modified'],
          'the 304 still carries the modification time',
        );
        assert.notOk(second.text, 'a 304 carries no body');
      });

      // A prerender tab revalidates every file a render fetches, so a rewrite
      // in the second it last read has to move the validator it holds, or the
      // render is built from the bytes from before the write.
      test('a rewrite within the same whole second is not answered 304 against the earlier validator', async function (assert) {
        let path = 'same-second.png';
        let absolutePath = join(testRealmPath, path);
        let pinnedMtime = new Date('2026-01-01T00:00:00Z');
        // One byte changed, so the size alone cannot tell the two apart.
        let rewrittenBytes = pngBytes.slice();
        rewrittenBytes[rewrittenBytes.length - 1] = 0x02;

        await upload(`/${path}`, pngBytes);
        utimesSync(absolutePath, pinnedMtime, pinnedMtime);
        let first = await request.get(`/${path}`).set('Accept', 'image/*');
        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        await upload(`/${path}`, rewrittenBytes);
        utimesSync(absolutePath, pinnedMtime, pinnedMtime);
        let conditional = await request
          .get(`/${path}`)
          .set('Accept', 'image/*')
          .set('If-None-Match', etag)
          .buffer(true)
          .parse(binaryParser);

        assert.strictEqual(
          conditional.headers['last-modified'],
          first.headers['last-modified'],
          'the two versions share a modification time',
        );
        assert.strictEqual(
          conditional.status,
          200,
          'the earlier validator does not match the rewritten file',
        );
        assert.deepEqual(
          new Uint8Array(conditional.body),
          rewrittenBytes,
          'the body is the rewritten bytes',
        );
        assert.notStrictEqual(
          conditional.headers['etag'],
          etag,
          'under a validator of its own',
        );
      });

      // Written around the realm, so no invalidation reaches the fingerprint
      // the first read left behind: only the file's own stat can say it is a
      // different version, and at the same length and whole second that is
      // the time below the second.
      test('a same-length rewrite made out of band within the same second is not answered 304 against the earlier validator', async function (assert) {
        let path = 'same-second-out-of-band.png';
        let absolutePath = join(testRealmPath, path);
        let rewrittenBytes = pngBytes.slice();
        rewrittenBytes[rewrittenBytes.length - 1] = 0x02;
        let firstTime = new Date('2026-01-01T00:00:00.100Z');
        let secondTime = new Date('2026-01-01T00:00:00.600Z');

        writeFileSync(absolutePath, pngBytes);
        utimesSync(absolutePath, firstTime, firstTime);
        let first = await request.get(`/${path}`).set('Accept', 'image/*');
        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        writeFileSync(absolutePath, rewrittenBytes);
        utimesSync(absolutePath, secondTime, secondTime);
        let conditional = await request
          .get(`/${path}`)
          .set('Accept', 'image/*')
          .set('If-None-Match', etag)
          .buffer(true)
          .parse(binaryParser);

        assert.strictEqual(
          conditional.headers['last-modified'],
          first.headers['last-modified'],
          'the two versions share a whole-second modification time',
        );
        assert.strictEqual(
          conditional.status,
          200,
          'the earlier validator does not match the rewritten file',
        );
        assert.deepEqual(
          new Uint8Array(conditional.body),
          rewrittenBytes,
          'the body is the rewritten bytes',
        );
      });

      // Above the whole-hash limit the fingerprint samples a file's head and
      // tail, so an edit confined to the middle leaves it unchanged. What tells
      // the two versions apart is the modification time the fingerprint is
      // joined with, which has to be finer than the second the two share.
      test("a same-length rewrite of a large file's unsampled middle within the same second is not answered 304", async function (assert) {
        let path = 'same-second-large.mp4';
        let absolutePath = join(testRealmPath, path);
        let original = new Uint8Array(
          CONTENT_HASH_WHOLE_LIMIT_BYTES + CONTENT_HASH_TAIL_BYTES,
        ).fill(0x61);
        let rewritten = original.slice();
        // Past the sampled head and short of the sampled tail.
        let editedOffset = CONTENT_HASH_HEAD_BYTES + 1024;
        rewritten[editedOffset] = 0x62;
        let firstTime = new Date('2026-01-01T00:00:00.100Z');
        let secondTime = new Date('2026-01-01T00:00:00.600Z');

        // Around the realm, which refuses a video this size at its default
        // limit and has no need to index it for the serve to answer.
        writeFileSync(absolutePath, original);
        utimesSync(absolutePath, firstTime, firstTime);
        let first = await request
          .get(`/${path}`)
          .set('Accept', 'video/*')
          .buffer(true)
          .parse(binaryParser);
        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        writeFileSync(absolutePath, rewritten);
        utimesSync(absolutePath, secondTime, secondTime);
        let conditional = await request
          .get(`/${path}`)
          .set('Accept', 'video/*')
          .set('If-None-Match', etag)
          .buffer(true)
          .parse(binaryParser);

        assert.strictEqual(
          conditional.headers['last-modified'],
          first.headers['last-modified'],
          'the two versions share a whole-second modification time',
        );
        assert.strictEqual(
          conditional.status,
          200,
          'the earlier validator does not match the rewritten file',
        );
        assert.strictEqual(
          conditional.body.length,
          rewritten.length,
          'the whole file is served',
        );
        assert.strictEqual(
          conditional.body[editedOffset],
          0x62,
          'with the rewritten middle',
        );
      });

      test('the byte serve advertises byte ranges and honors one', async function (assert) {
        await upload('/ranged.png', pngBytes);

        let full = await request
          .get('/ranged.png')
          .set('Accept', 'image/*')
          .buffer(true)
          .parse(binaryParser);
        assert.strictEqual(
          full.headers['accept-ranges'],
          'bytes',
          'a full response advertises range support',
        );

        let ranged = await request
          .get('/ranged.png')
          .set('Accept', 'image/*')
          .set('Range', 'bytes=2-5')
          .buffer(true)
          .parse(binaryParser);

        assert.strictEqual(ranged.status, 206, 'HTTP 206 status');
        assert.strictEqual(
          ranged.headers['content-range'],
          `bytes 2-5/${pngBytes.length}`,
          'the range names the slice and the whole',
        );
        assert.deepEqual(
          new Uint8Array(ranged.body),
          pngBytes.slice(2, 6),
          'only the requested bytes come back',
        );
      });

      test('a HEAD answers the headers its GET would carry, without the bytes', async function (assert) {
        await upload('/head-parity.png', pngBytes);

        let get = await request
          .get('/head-parity.png')
          .set('Accept', 'image/*');
        let head = await request
          .head('/head-parity.png')
          .set('Accept', 'image/*');

        assert.strictEqual(head.status, 200, 'HTTP 200 status');
        for (let header of [
          'content-type',
          'etag',
          'last-modified',
          'cache-control',
          'content-length',
          'accept-ranges',
        ]) {
          // Pin the GET's value before comparing: a header absent from both
          // responses satisfies equality, so the comparison alone would call
          // that parity.
          assert.ok(
            get.headers[header],
            `the GET carries ${header} for the HEAD to match`,
          );
          assert.strictEqual(
            head.headers[header],
            get.headers[header],
            `${header} matches the GET`,
          );
        }
        assert.notOk(head.text, 'no body in a HEAD response');
      });

      test('a byte GET reports when the realm first saw the file', async function (assert) {
        await upload('/created-at.png', pngBytes);

        let get = await request.get('/created-at.png').set('Accept', 'image/*');
        let head = await request
          .head('/created-at.png')
          .set('Accept', 'image/*');

        assert.ok(
          get.headers['x-created'],
          'a path the realm wrote carries its creation time',
        );
        assert.strictEqual(
          head.headers['x-created'],
          get.headers['x-created'],
          'and the HEAD reports the same one',
        );
      });

      test('a path nothing is stored under is a 404', async function (assert) {
        let response = await request
          .get('/nothing-is-here.png')
          .set('Accept', 'image/*');

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      });

      test('an extension-less name does not fall back to a non-module file', async function (assert) {
        await testRealm.write('fallback-probe.md', '# Probe\n');

        let byteServe = await request
          .get('/fallback-probe')
          .set('Accept', 'text/plain');
        assert.strictEqual(
          byteServe.status,
          404,
          'the byte serve resolves only module extensions, so it finds nothing',
        );

        let source = await request
          .get('/fallback-probe')
          .set('Accept', 'application/vnd.card+source');
        assert.strictEqual(
          source.status,
          404,
          'the source route adds .json to those extensions, which also misses',
        );
      });

      test('the bytes a file serves are the bytes its card+source GET serves', async function (assert) {
        await upload('/same-bytes.png', pngBytes);

        let bytes = await request
          .get('/same-bytes.png')
          .set('Accept', 'image/*')
          .buffer(true)
          .parse(binaryParser);
        let source = await request
          .get('/same-bytes.png')
          .set('Accept', 'application/vnd.card+source')
          .buffer(true)
          .parse(binaryParser);

        assert.deepEqual(
          new Uint8Array(source.body),
          new Uint8Array(bytes.body),
          'both routes serve the same file',
        );
        assert.strictEqual(
          source.headers['content-type'],
          bytes.headers['content-type'],
          'and infer the same content type for it',
        );
      });
    });

    module('permissioned realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        mode: 'before',
        permissions: {
          john: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup: (args) => {
          testRealm = args.testRealm;
          request = withRealmPath(args.request, realmURL);
        },
      });

      test('401 without a JWT', async function (assert) {
        let response = await request
          .get('/sample.md')
          .set('Accept', 'text/plain');

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('401 with an invalid JWT', async function (assert) {
        let response = await request
          .get('/sample.md')
          .set('Accept', 'text/plain')
          .set('Authorization', `Bearer invalid-token`);

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('403 without permission', async function (assert) {
        let response = await request
          .get('/sample.md')
          .set('Accept', 'text/plain')
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('200 with permission', async function (assert) {
        let response = await request
          .get('/sample.md')
          .set('Accept', 'text/plain')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['cache-control'],
          'private, max-age=0',
          'a realm that is not world-readable is never stored by a shared cache',
        );
      });
    });
  });
});
