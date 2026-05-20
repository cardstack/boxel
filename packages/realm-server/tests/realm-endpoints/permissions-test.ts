import { module, test } from 'qunit';
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import {
  fetchRealmPermissions,
  insertPermissions,
  REALM_INDEX_UPDATED_CHANNEL,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmHref,
  testRealmURL,
  createJWT,
  waitUntil,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';
import type { PgAdapter } from '@cardstack/postgres';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | _permissions', function () {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter;
    }

    module('permissions requests', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'blank',
        permissions: {
          mary: ['read', 'write', 'realm-owner'],
          bob: ['read', 'write'],
        },
        onRealmSetup,
      });

      test('non-owner GET /_permissions', async function (assert) {
        let response = await request
          .get('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'bob', ['read', 'write'])}`,
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('realm-owner GET /_permissions', async function (assert) {
        let response = await request
          .get('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                  bob: ['read', 'write'],
                },
              },
            },
          },
          'permissions response is correct',
        );
      });

      test('non-owner PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'bob', ['read', 'write'])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions did not change',
        );
      });

      test('realm-owner PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                  bob: ['read', 'write'],
                  mango: ['read'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
            mango: ['read'],
          },
          'permissions are correct',
        );
      });

      test('remove permissions from PATCH /_permissions using empty array', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  bob: [],
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
          },
          'permissions are correct',
        );
      });

      test('remove permissions from PATCH /_permissions using null', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  bob: null,
                },
              },
            },
          });

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        let json = response.body;
        assert.deepEqual(
          json,
          {
            data: {
              type: 'permissions',
              id: testRealmHref,
              attributes: {
                permissions: {
                  mary: ['read', 'write', 'realm-owner'],
                },
              },
            },
          },
          'permissions response is correct',
        );
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
          },
          'permissions are correct',
        );
      });

      test('cannot remove realm-owner permissions from PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mary: [],
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      test('cannot add realm-owner permissions from PATCH /_permissions', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  mango: ['realm-owner', 'write', 'read'],
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      // CS-11126: realm visibility / world-readable used to be memoized
      // per Realm instance, so a `*: read` grant or revoke on replica A
      // would be silently ignored by every other replica until restart.
      // With the caches dropped, every visibility() call re-reads
      // realm_permissions, so an out-of-band DB write (which is what a
      // peer's commit looks like from this replica's vantage) is
      // observed on the next call. Simulating "peer write" via direct
      // insertPermissions/DELETE keeps the test single-process.
      test('visibility() reflects out-of-band realm_permissions changes without restart', async function (assert) {
        assert.strictEqual(
          await testRealm.visibility(),
          'shared',
          'baseline: realm with mary+bob (no `*`) is shared',
        );

        // peer-side grant: *: read directly in the DB
        await insertPermissions(dbAdapter, testRealmURL, { '*': ['read'] });
        assert.strictEqual(
          await testRealm.visibility(),
          'public',
          'after out-of-band *: read grant, visibility is public on next call',
        );

        // peer-side revoke: drop *: read
        await insertPermissions(dbAdapter, testRealmURL, { '*': [] });
        assert.strictEqual(
          await testRealm.visibility(),
          'shared',
          'after out-of-band *: read revoke, visibility flips back without restart',
        );
      });

      // CS-11178: `RealmInfo.visibility` is permissions-derived but
      // memoized into `Realm#cachedRealmInfo` and consumed by every
      // card-document response via `attachRealmInfo()` and by the
      // card-JSON ETag hash. A `_permissions` PATCH must therefore
      // invalidate that cache locally AND broadcast the same wipe on
      // `realm_index_updated` so peer replicas drop their copies too.
      // Two assertions:
      //   1. `getRealmInfo()` after the PATCH reflects the new
      //      visibility (proves the local `#cachedRealmInfo` clear ran).
      //   2. A NOTIFY on `realm_index_updated` lands with this realm's
      //      URL (proves the broadcast half ran). If a future refactor
      //      replaces `clearRealmIndexCachesAndBroadcast()` with the
      //      bare `clearRealmIndexCaches()`, the second assertion is
      //      what catches it — peer replicas would silently keep
      //      serving stale `meta.realmInfo.visibility` from their own
      //      cached RealmInfo.
      // Dispatch on the receiver side is covered separately in
      // `realm-index-updated-listener-test.ts`.
      test('PATCH /_permissions invalidates cached RealmInfo and broadcasts to peers', async function (assert) {
        // Only count NOTIFYs whose payload matches this realm — the
        // `realm_index_updated` channel is shared across every realm
        // mounted in this process, and the test fixture's own boot
        // sequence (or any racing index swap) can fan out unrelated
        // payloads on the same listener. Filtering by `testRealm.url`
        // keeps the assertion specific to the PATCH under test.
        let sawNotifyForThisRealm = false;
        let subscription = await dbAdapter.subscribe(
          REALM_INDEX_UPDATED_CHANNEL,
          (notification) => {
            if (notification.payload === testRealm.url) {
              sawNotifyForThisRealm = true;
            }
          },
        );
        try {
          let beforeInfo = await testRealm.getRealmInfo();
          assert.strictEqual(
            beforeInfo.visibility,
            'shared',
            'baseline: cached RealmInfo reflects mary+bob (shared)',
          );

          let response = await request
            .patch('/_permissions')
            .set('Accept', 'application/vnd.api+json')
            .set(
              'Authorization',
              `Bearer ${createJWT(testRealm, 'mary', [
                'read',
                'write',
                'realm-owner',
              ])}`,
            )
            .send({
              data: {
                id: testRealmHref,
                type: 'permissions',
                attributes: {
                  permissions: {
                    '*': ['read'],
                  },
                },
              },
            });
          assert.strictEqual(response.status, 200, 'HTTP 200 status');

          let afterInfo = await testRealm.getRealmInfo();
          assert.strictEqual(
            afterInfo.visibility,
            'public',
            'after PATCH, next getRealmInfo() reflects the new *: read grant (local cache invalidated)',
          );

          // The NOTIFY is delivered over a separate libpq connection,
          // so it may arrive slightly after the HTTP response.
          await waitUntil(async () => sawNotifyForThisRealm, {
            timeout: 3000,
            timeoutMessage: `expected NOTIFY ${REALM_INDEX_UPDATED_CHANNEL} for ${testRealm.url} after PATCH /_permissions`,
          });
          assert.ok(
            sawNotifyForThisRealm,
            'realm_index_updated NOTIFY emitted with this realm URL (peer replicas drop their #cachedRealmInfo on receipt)',
          );
        } finally {
          await subscription.unsubscribe();
        }
      });

      test('receive 400 error on invalid JSON API', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: { nothing: null },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });

      test('receive 400 error on invalid permissions shape', async function (assert) {
        let response = await request
          .patch('/_permissions')
          .set('Accept', 'application/vnd.api+json')
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'mary', [
              'read',
              'write',
              'realm-owner',
            ])}`,
          )
          .send({
            data: {
              id: testRealmHref,
              type: 'permissions',
              attributes: {
                permissions: {
                  larry: { read: true },
                },
              },
            },
          });

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        let permissions = await fetchRealmPermissions(dbAdapter, testRealmURL);
        assert.deepEqual(
          permissions,
          {
            mary: ['read', 'write', 'realm-owner'],
            bob: ['read', 'write'],
          },
          'permissions are correct',
        );
      });
    });
  });
});
