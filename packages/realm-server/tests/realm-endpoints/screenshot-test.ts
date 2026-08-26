import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import {
  MEDIA_CACHE_MAX_AGE_SECONDS,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { setupPermissionedRealmCached, createJWT } from '../helpers/index.ts';
import { FakeMediaCacheAdapter } from '../helpers/fake-media-cache-adapter.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

// The `_screenshot/` route's HTTP surface: realm-read auth, the
// uncaptured-miss contract (404 with a short, visibility-correct max-age),
// and the write reservation on the subtree. Each realm here carries a real
// (fake-backed) MediaCache store, so requests traverse the full serving
// path — instance liveness probe, resolver seam — and miss because nothing
// in these realms has been captured. Hit serving — streaming, ETags, 304s —
// is pinned against the serving core directly in media-cache-serving-test.ts;
// the hit path's endpoint-level assertions (a live instance's capture serves
// 200, a tombstoned instance's capture misses) belong with the capture
// resolver, which is what makes a hit reachable through this route.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('GET _screenshot on a private realm', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      mediaCacheAdapter: new FakeMediaCacheAdapter(),
      permissions: {
        mary: ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: (args: { testRealm: Realm; request: SuperTest<Test> }) => {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('an unauthenticated request is a 401, not a 404', async function (assert) {
      let response = await request
        .get('/_screenshot/some-card')
        .set('Accept', 'image/avif,image/webp,image/png,*/*;q=0.8');
      assert.strictEqual(response.status, 401);
    });

    test('a reader without the read grant is refused', async function (assert) {
      let response = await request
        .get('/_screenshot/some-card')
        .set('Accept', 'image/png')
        .set('Authorization', `Bearer ${createJWT(testRealm, 'not-mary')}`);
      assert.strictEqual(response.status, 403);
    });

    test('a reader gets an uncaptured miss with private cache-control', async function (assert) {
      let response = await request
        .get('/_screenshot/some-card')
        .set('Accept', 'image/png')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
        );
      assert.strictEqual(response.status, 404);
      assert.strictEqual(
        response.headers['cache-control'],
        `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        'the miss is briefly cacheable and private-realm-scoped',
      );
    });

    test('HEAD is not admitted to the screenshot route', async function (assert) {
      // checkPermission exempts HEAD from auth realm-wide, so if this route
      // answered HEAD it would hand unauthenticated callers an existence /
      // size / content-hash oracle over a private realm's captures. The
      // dispatch is GET-only; a HEAD falls through to the generic handlers
      // and never gets the route's briefly-cacheable miss shape.
      let response = await request
        .head('/_screenshot/some-card')
        .set('Accept', 'image/png');
      assert.strictEqual(response.status, 404, 'the generic handlers answer');
      assert.notStrictEqual(
        response.headers['cache-control'],
        `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        'the screenshot miss response did not answer',
      );
    });

    test('a declared-name request misses the same way', async function (assert) {
      let response = await request
        .get('/_screenshot/some-card?name=hero')
        .set('Accept', 'image/png')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'mary', ['read'])}`,
        );
      assert.strictEqual(response.status, 404);
      assert.strictEqual(
        response.headers['cache-control'],
        `private, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
      );
    });
  });

  module('GET _screenshot on a world-readable realm', function (hooks) {
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      mediaCacheAdapter: new FakeMediaCacheAdapter(),
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: (args: { request: SuperTest<Test> }) => {
        request = args.request;
      },
    });

    test('an unauthenticated request serves (as a miss) with public cache-control', async function (assert) {
      let response = await request
        .get('/_screenshot/some-card')
        .set('Accept', 'image/avif,image/webp,image/png,*/*;q=0.8');
      assert.strictEqual(response.status, 404, 'a miss, not an auth refusal');
      assert.strictEqual(
        response.headers['cache-control'],
        `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
      );
      assert.strictEqual(
        response.headers['x-boxel-realm-public-readable'],
        'true',
      );
    });
  });

  // The GET dispatch claims the whole `_screenshot/` subtree, so a realm
  // file stored under it could never be read back. The reservation refuses
  // creation writes up front — at the direct-write seam and the `/_atomic`
  // precheck — so the collision surfaces at write time instead of as a
  // permanently-404ing file.
  module('writes under _screenshot/ are refused', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        mary: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: (args: { testRealm: Realm; request: SuperTest<Test> }) => {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('PUT, PATCH, and POST are refused as reserved', async function (assert) {
      for (let method of ['put', 'patch', 'post'] as const) {
        let response = await request[method]('/_screenshot/logo.png')
          .set('Accept', SupportedMimeType.CardSource)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', ['read', 'write'])}`,
          )
          .send('some bytes');
        assert.strictEqual(response.status, 400, `${method} is refused`);
      }
    });

    test('an atomic operation targeting the subtree is refused as reserved', async function (assert) {
      let response = await request
        .post('/_atomic')
        .set('Accept', SupportedMimeType.JSONAPI)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'mary', ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'add',
                href: '_screenshot/logo.gts',
                data: {
                  type: 'source',
                  attributes: { content: '// content' },
                  meta: {},
                },
              },
            ],
          }),
        );
      assert.strictEqual(response.status, 422);
      assert.strictEqual(response.body.errors?.[0]?.title, 'Reserved path');
    });
  });
});
