import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { insertPermissions } from '@cardstack/runtime-common';
import {
  clearSessionRoom,
  fetchRealmEventRoom,
  fetchSessionRoom,
  fetchRealmSessionRooms,
  insertRealmEventRoom,
  upsertSessionRoom,
} from '@cardstack/runtime-common/db-queries/session-room-queries';
import { setupDB, insertUser } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
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

    test('a world-readable grant adds no users', async function (assert) {
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
        '*': ['read'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        {},
        "a world-readable realm's events go to its own room, not to session rooms",
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

    test('returns only users with their own grant on a world-readable realm', async function (assert) {
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
        '*': ['read'],
        '@alice:localhost': ['read', 'write'],
      });

      let result = await fetchRealmSessionRooms(dbAdapter, realmURL.href);

      assert.deepEqual(
        result,
        { '@alice:localhost': '!room-alice:localhost' },
        'alice is included through her own grant, and bob is not',
      );
    });
  });

  module('realm event rooms', function (hooks) {
    let dbAdapter: PgAdapter;
    const realmURL = new URL('http://127.0.0.1:4444/test/');

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    test('a realm that is not world-readable has no event room', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, {
        '@alice:localhost': ['read', 'write'],
      });

      assert.deepEqual(await fetchRealmEventRoom(dbAdapter, realmURL.href), {
        worldReadable: false,
        roomId: null,
      });
    });

    test('a world-readable realm has no event room until one is stored', async function (assert) {
      await insertPermissions(dbAdapter, realmURL, { '*': ['read'] });

      assert.deepEqual(
        await fetchRealmEventRoom(dbAdapter, realmURL.href),
        { worldReadable: true, roomId: null },
        'no room before one is stored',
      );

      let stored = await insertRealmEventRoom(
        dbAdapter,
        realmURL.href,
        '!events:localhost',
      );
      assert.strictEqual(stored, '!events:localhost', 'the room is stored');
      assert.deepEqual(
        await fetchRealmEventRoom(dbAdapter, realmURL.href),
        { worldReadable: true, roomId: '!events:localhost' },
        'the stored room is reported',
      );
    });

    test('storing a second room for a realm keeps the first', async function (assert) {
      await insertRealmEventRoom(dbAdapter, realmURL.href, '!first:localhost');
      let stored = await insertRealmEventRoom(
        dbAdapter,
        realmURL.href,
        '!second:localhost',
      );

      assert.strictEqual(
        stored,
        '!first:localhost',
        'the room stored first is the one returned',
      );
    });
  });

  module('clearSessionRoom', function (hooks) {
    let dbAdapter: PgAdapter;

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    test('clears the stored session room when it matches', async function (assert) {
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

      let cleared = await clearSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!room-alice:localhost',
      );

      assert.true(cleared, 'reports that the room was cleared');
      let remainingRoom = await fetchSessionRoom(dbAdapter, '@alice:localhost');
      assert.strictEqual(
        remainingRoom,
        null,
        'stored session room is removed from the user record',
      );
    });

    test('does not clear the stored session room when the room id does not match', async function (assert) {
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

      let cleared = await clearSessionRoom(
        dbAdapter,
        '@alice:localhost',
        '!different-room:localhost',
      );

      assert.false(cleared, 'reports that nothing was cleared');
      let remainingRoom = await fetchSessionRoom(dbAdapter, '@alice:localhost');
      assert.strictEqual(
        remainingRoom,
        '!room-alice:localhost',
        'stored session room is left untouched',
      );
    });
  });
});
