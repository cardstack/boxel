import { module, test } from 'qunit';
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { insertPermissions } from '@cardstack/runtime-common';
import {
  fetchRealmSessionRooms,
  upsertSessionRoom,
} from '@cardstack/runtime-common/db-queries/session-room-queries';
import { setupDB, insertUser } from './helpers';

module(basename(__filename), function () {
  module('fetchRealmSessionRooms', function (hooks) {
    let dbAdapter: PgAdapter;
    const realmURL = new URL('http://127.0.0.1:4444/test/');

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    test('returns users with explicit read permission for the realm', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      await insertPermissions(dbAdapter, realmURL, {
        '@alice:localhost': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
        },
        'returns the user with read permission',
      );
    });

    test('returns users with explicit write permission for the realm', async function (assert) {
      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@bob:localhost',
        '!room-bob:localhost',
      );

      await insertPermissions(dbAdapter, realmURL, {
        '@bob:localhost': ['write'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@bob:localhost': '!room-bob:localhost',
        },
        'returns the user with write permission',
      );
    });

    test('returns multiple users with different permissions', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@bob:localhost',
        '!room-bob:localhost',
      );

      await insertPermissions(dbAdapter, realmURL, {
        '@alice:localhost': ['read'],
        '@bob:localhost': ['read', 'write'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
          '@bob:localhost': '!room-bob:localhost',
        },
        'returns both users with permissions',
      );
    });

    test('excludes users without permission on a non-world-readable realm', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      await insertUser(
        dbAdapter,
        '@eve:localhost',
        'cus_eve',
        'eve@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@eve:localhost',
        '!room-eve:localhost',
      );

      // Only alice has permission, not eve
      await insertPermissions(dbAdapter, realmURL, {
        '@alice:localhost': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
        },
        'only returns the user with permission, excludes eve',
      );
    });

    test('excludes users without a session room even when they have permissions', async function (assert) {
      // alice has a session room
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      // bob does NOT have a session room (never authenticated via realm-auth)
      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );

      await insertPermissions(dbAdapter, realmURL, {
        '@alice:localhost': ['read'],
        '@bob:localhost': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
        },
        'only returns users that have a session room',
      );
    });

    test('returns all users with session rooms when the realm is world-readable', async function (assert) {
      // Create multiple users with session rooms
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@bob:localhost',
        '!room-bob:localhost',
      );

      await insertUser(
        dbAdapter,
        '@charlie:localhost',
        'cus_charlie',
        'charlie@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@charlie:localhost',
        '!room-charlie:localhost',
      );

      // World-readable realm: username='*' with read=true
      // No per-user permission rows for alice, bob, or charlie
      await insertPermissions(dbAdapter, realmURL, {
        '*': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
          '@bob:localhost': '!room-bob:localhost',
          '@charlie:localhost': '!room-charlie:localhost',
        },
        'returns ALL users with session rooms for world-readable realm',
      );
    });

    test('world-readable realm still excludes users without session rooms', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      // bob has no session room
      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );

      await insertPermissions(dbAdapter, realmURL, {
        '*': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {
          '@alice:localhost': '!room-alice:localhost',
        },
        'excludes users without session rooms even for world-readable realm',
      );
    });

    test('returns empty result when no users have permissions', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      // No permissions set for this realm at all
      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(result, {}, 'returns empty when no permissions exist');
    });

    test('does not return users from a different realm', async function (assert) {
      let otherRealmURL = new URL('http://127.0.0.1:4444/other/');

      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      // alice has permission on the OTHER realm, not on our test realm
      await insertPermissions(dbAdapter, otherRealmURL, {
        '@alice:localhost': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {},
        'returns empty for a realm where alice has no permission',
      );
    });

    test('combines explicit permissions and world-readable access', async function (assert) {
      await insertUser(
        dbAdapter,
        '@alice:localhost',
        'cus_alice',
        'alice@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      await insertUser(
        dbAdapter,
        '@bob:localhost',
        'cus_bob',
        'bob@example.com',
      );
      await upsertSessionRoom(
        dbAdapter,
        '@bob:localhost',
        '!room-bob:localhost',
      );

      // alice has explicit write permission AND the realm is world-readable
      await insertPermissions(dbAdapter, realmURL, {
        '*': ['read'],
        '@alice:localhost': ['read', 'write'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      // Both users should be returned: alice via explicit + world-readable, bob via world-readable
      assert.strictEqual(Object.keys(result).length, 2, 'returns 2 users');
      assert.strictEqual(
        result['@alice:localhost'],
        '!room-alice:localhost',
        'alice is included',
      );
      assert.strictEqual(
        result['@bob:localhost'],
        '!room-bob:localhost',
        'bob is included via world-readable access',
      );
    });
  });
});
