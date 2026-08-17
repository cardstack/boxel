import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import {
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// CORS treatment of byte-range media requests. Native <audio>/<video>
// elements cannot attach Authorization, so the host's auth service worker
// re-issues their requests as mode:'cors' with the token injected. That
// rewrite turns the media element's Range header into an author header
// needing preflight approval, and makes the 206's descriptive headers
// (Content-Range, Accept-Ranges) visible to the caller only when exposed.
module(basename(import.meta.filename), function () {
  module(
    'Realm-specific Endpoints | CORS for Range requests',
    function (hooks) {
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

      test('preflight approves Range and If-Range author headers', async function (assert) {
        let response = await serverRequest
          .options('/test/sample.png')
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
        await request
          .post('/sample.png')
          .set('Content-Type', 'application/octet-stream')
          .send(Buffer.from(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));

        let response = await request
          .get('/sample.png')
          .set('Accept', 'image/*')
          .set('Origin', 'https://app.example')
          .set('Range', 'bytes=2-5');

        assert.strictEqual(response.status, 206, 'HTTP 206 status');
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
    },
  );
});
