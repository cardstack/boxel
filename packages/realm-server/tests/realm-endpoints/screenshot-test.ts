import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { MEDIA_CACHE_MAX_AGE_SECONDS } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached, createJWT } from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

// The `_screenshot/` route's HTTP surface: realm-read auth and the
// uncaptured-miss contract (404 with a short, visibility-correct max-age).
// Hit serving — streaming, ETags, 304s — is pinned against the serving core
// directly in media-cache-serving-test.ts; requests here resolve to no
// capture, since nothing in these realms has been captured.
module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('GET _screenshot on a private realm', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
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
});
