import QUnit from 'qunit';
const { module, test } = QUnit;
import type { SuperTest, Test as SupertestTest } from 'supertest';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import type { Realm } from '@cardstack/runtime-common';
import {
  fetchRealmEventRoom,
  fetchRealmNamedGrantees,
  insertPermissions,
  insertRealmEventRoom,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';
import {
  APP_BOXEL_REALM_EVENT_ROOM_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  createJWT,
  matrixURL,
  realmSecretSeed,
  setupDB,
  setupPermissionedRealmCached,
  testRealmHref,
  waitUntil,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { RealmEventDispatcher } from '../realm-event-dispatcher.ts';
import {
  ensureRealmEventRoom,
  retireRealmEventRoom,
  syncRealmEventRoom,
} from '../realm-event-rooms.ts';

const SELF = '@realm_server:localhost';

// A matrix client that keeps room memberships in memory and records what it
// was asked to do.
function fakeMatrixClient() {
  let rooms = new Map<string, Map<string, string>>();
  let calls: string[] = [];
  let created = 0;
  let matrixClient = {
    login: async () => undefined,
    isLoggedIn: () => true,
    getUserId: () => SELF,
    nextTxnId: () => 'txn',
    createRealmEventRoom: async () => {
      let roomId = `!created-${++created}:localhost`;
      rooms.set(roomId, new Map());
      calls.push(`create ${roomId}`);
      return roomId;
    },
    getRoomMemberships: async (roomId: string) => {
      let room = rooms.get(roomId);
      if (!room) {
        throw new Error(
          `Unable to read the members of room ${roomId}: status 403 - {"errcode":"M_FORBIDDEN","error":"User ${SELF} not in room ${roomId}"}`,
        );
      }
      return new Map(room);
    },
    inviteUser: async (roomId: string, userId: string) => {
      rooms.get(roomId)!.set(userId, 'invite');
      calls.push(`invite ${userId}`);
    },
    kickUser: async (roomId: string, userId: string) => {
      rooms.get(roomId)!.set(userId, 'leave');
      calls.push(`kick ${userId}`);
    },
    leaveRoom: async (roomId: string) => {
      calls.push(`leave ${roomId}`);
    },
  } as unknown as MatrixClient;
  return { matrixClient, rooms, calls };
}

module(basename(import.meta.filename), function () {
  module('membership', function (hooks) {
    let dbAdapter: PgAdapter;
    const realmURL = 'http://127.0.0.1:4444/private/';

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
      },
    });

    function deps(matrixClient: MatrixClient) {
      return {
        realmURL,
        matrixClient,
        dbAdapter,
        dispatcher: new RealmEventDispatcher({ sendsPerSecond: 1000 }),
      };
    }

    test('names every user with their own grant, and neither the public grant nor a bare username', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '*': ['read'],
        mary: ['read', 'write', 'realm-owner'],
        '@alice:localhost': ['read', 'write', 'realm-owner'],
        '@bob:localhost': ['read'],
      });
      assert.deepEqual(await fetchRealmNamedGrantees(dbAdapter, realmURL), [
        '@alice:localhost',
        '@bob:localhost',
      ]);
    });

    test("creates a private realm's room for a grantee, inviting every grantee but the realm server", async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
        '@bob:localhost': ['read'],
        [SELF]: ['read'],
      });
      let { matrixClient, calls } = fakeMatrixClient();

      let roomId = await ensureRealmEventRoom(
        deps(matrixClient),
        '@bob:localhost',
      );

      assert.strictEqual(roomId, '!created-1:localhost');
      assert.deepEqual(
        calls,
        [
          'create !created-1:localhost',
          'invite @alice:localhost',
          'invite @bob:localhost',
        ],
        'the grantees are invited before the room is answered',
      );
      assert.deepEqual(await fetchRealmEventRoom(dbAdapter, realmURL), {
        isPrivate: true,
        roomId: roomId!,
      });

      let again = await ensureRealmEventRoom(
        deps(matrixClient),
        '@alice:localhost',
      );
      assert.strictEqual(again, roomId, 'asking again answers the same room');
      assert.strictEqual(calls.length, 3, 'and changes nothing');
    });

    test('answers no room to a user no grant names, and creates none', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
      });
      let { matrixClient, calls } = fakeMatrixClient();

      assert.strictEqual(
        await ensureRealmEventRoom(deps(matrixClient), '@mallory:localhost'),
        undefined,
      );
      assert.deepEqual(calls, []);
      assert.strictEqual(
        (await fetchRealmEventRoom(dbAdapter, realmURL)).roomId,
        null,
      );
    });

    test('answers no room for a world-readable realm, even to a grantee', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '*': ['read'],
        '@alice:localhost': ['read', 'write', 'realm-owner'],
      });
      let { matrixClient, calls } = fakeMatrixClient();

      assert.strictEqual(
        await ensureRealmEventRoom(deps(matrixClient), '@alice:localhost'),
        undefined,
      );
      assert.deepEqual(calls, []);
    });

    test('uses the room another process stored first, and leaves its own', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
      });
      let { matrixClient, rooms, calls } = fakeMatrixClient();
      let realCreate = matrixClient.createRealmEventRoom.bind(matrixClient);
      (matrixClient as any).createRealmEventRoom = async (url: string) => {
        let created = await realCreate(url);
        // Another process stores its room while this one is creating.
        rooms.set('!winner:localhost', new Map());
        await insertRealmEventRoom(dbAdapter, realmURL, '!winner:localhost');
        return created;
      };

      let roomId = await ensureRealmEventRoom(
        deps(matrixClient),
        '@alice:localhost',
      );

      assert.strictEqual(roomId, '!winner:localhost');
      assert.deepEqual(calls, [
        'create !created-1:localhost',
        'leave !created-1:localhost',
        'invite @alice:localhost',
      ]);
    });

    test('syncing invites a new grantee and kicks a member whose grant was revoked', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
        '@bob:localhost': ['read'],
      });
      let { matrixClient, rooms, calls } = fakeMatrixClient();
      let roomId = (await ensureRealmEventRoom(
        deps(matrixClient),
        '@alice:localhost',
      ))!;
      rooms.get(roomId)!.set('@alice:localhost', 'join');
      calls.length = 0;

      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@bob:localhost': [],
        '@carol:localhost': ['read'],
      });
      await syncRealmEventRoom(deps(matrixClient));

      assert.deepEqual(calls.sort(), [
        'invite @carol:localhost',
        'kick @bob:localhost',
      ]);
      assert.deepEqual(
        Object.fromEntries(rooms.get(roomId)!),
        {
          '@alice:localhost': 'join',
          '@bob:localhost': 'leave',
          '@carol:localhost': 'invite',
        },
        'the members are the users the grants name',
      );

      calls.length = 0;
      await syncRealmEventRoom(deps(matrixClient));
      assert.deepEqual(calls, [], 'a second sync changes nothing');
    });

    test('syncing a realm without a room does nothing', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
      });
      let { matrixClient, calls } = fakeMatrixClient();
      await syncRealmEventRoom(deps(matrixClient));
      assert.deepEqual(calls, []);
    });

    test('forgets a stored room the realm server is no longer in', async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
      });
      await insertRealmEventRoom(dbAdapter, realmURL, '!gone:localhost');
      let { matrixClient } = fakeMatrixClient();

      await syncRealmEventRoom(deps(matrixClient));

      assert.strictEqual(
        (await fetchRealmEventRoom(dbAdapter, realmURL)).roomId,
        null,
        'the next host to ask gets a new room',
      );
    });

    test("retiring a realm's room forgets it, kicks every member, then leaves", async function (assert) {
      await insertPermissions(dbAdapter, new URL(realmURL), {
        '@alice:localhost': ['read', 'write', 'realm-owner'],
        '@bob:localhost': ['read'],
      });
      let { matrixClient, calls } = fakeMatrixClient();
      let roomId = await ensureRealmEventRoom(
        deps(matrixClient),
        '@alice:localhost',
      );
      calls.length = 0;

      await retireRealmEventRoom(deps(matrixClient));

      assert.deepEqual(calls, [
        'kick @alice:localhost',
        'kick @bob:localhost',
        `leave ${roomId}`,
      ]);
      assert.strictEqual(
        (await fetchRealmEventRoom(dbAdapter, realmURL)).roomId,
        null,
      );
    });
  });

  module('realm event rooms endpoint', function (hooks) {
    let dbAdapter: PgAdapter;
    let request: SuperTest<SupertestTest>;
    let testRealm: Realm;
    // The realm's own matrix user creates its room; these are other users.
    const member = '@node-test_realm:localhost';
    const newcomer = '@experiments_realm:localhost';
    const outsider = '@catalog_realm:localhost';

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        mary: ['read', 'write', 'realm-owner'],
        [member]: ['read', 'write'],
      },
      onRealmSetup: ({
        dbAdapter: adapter,
        request: req,
        testRealm: realm,
      }) => {
        dbAdapter = adapter;
        request = req;
        testRealm = realm;
      },
    });

    function realmEventRooms(realms: string[], user = member) {
      return request
        .post('/_realm-event-rooms')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user, sessionRoom: 'server-session-room' },
            realmSecretSeed,
          )}`,
        )
        .send(JSON.stringify({ realms }));
    }

    function patchPermissions(permissions: Record<string, string[]>) {
      return request
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
            attributes: { permissions },
          },
        });
    }

    // A client for one of the test matrix users, the way a host is one.
    async function loginAs(userId: string) {
      let username = userId.slice(1, userId.indexOf(':'));
      let response = await fetch(
        new URL('_matrix/client/v3/login', matrixURL),
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: { type: 'm.id.user', user: username },
            password: await passwordFromSeed(username, realmSecretSeed),
            type: 'm.login.password',
          }),
        },
      );
      let { access_token } = (await response.json()) as {
        access_token: string;
      };
      return (path: string, init: RequestInit = {}) =>
        fetch(new URL(`_matrix/client/v3/${path}`, matrixURL), {
          ...init,
          headers: { Authorization: `Bearer ${access_token}` },
        });
    }

    // Read as the realm's own matrix user, the room's creator.
    async function membershipOf(roomId: string, userId: string) {
      let asRealm = await loginAs('@test_realm:localhost');
      let response = await asRealm(
        `rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
      );
      if (response.status === 404) {
        return undefined;
      }
      return ((await response.json()) as { membership?: string }).membership;
    }

    test("answers a grantee with the realm's room, the same each time, having invited them", async function (assert) {
      let first = await realmEventRooms([testRealmHref]);
      assert.strictEqual(first.status, 200, 'HTTP 200 status');
      let roomId = first.body.rooms[testRealmHref];
      assert.ok(roomId, 'the realm has an event room');
      assert.strictEqual(
        await membershipOf(roomId, member),
        'invite',
        'the grantee is invited by the time the answer arrives',
      );

      let second = await realmEventRooms([testRealmHref]);
      assert.strictEqual(
        second.body.rooms[testRealmHref],
        roomId,
        'asking again answers with the same room',
      );
    });

    test('leaves out a realm whose grants do not name the user, a world-readable realm, and an unknown realm', async function (assert) {
      let response = await realmEventRooms([testRealmHref], outsider);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { rooms: {} }, 'no room for an outsider');
      assert.strictEqual(
        (await fetchRealmEventRoom(dbAdapter, testRealmHref)).roomId,
        null,
        "an outsider's ask creates no room",
      );

      let publicRealmURL = new URL('http://127.0.0.1:4444/public/');
      await insertPermissions(dbAdapter, publicRealmURL, {
        '*': ['read'],
        [member]: ['read', 'write'],
      });
      response = await realmEventRooms([
        publicRealmURL.href,
        'http://127.0.0.1:4444/unknown/',
      ]);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { rooms: {} }, 'no room is answered');
    });

    test('rejects a request without a session', async function (assert) {
      let response = await request
        .post('/_realm-event-rooms')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ realms: [testRealmHref] }));

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('rejects a body without a list of realms', async function (assert) {
      let response = await realmEventRooms('not a list' as unknown as string[]);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('lets only invited users join the room, and only the realm send in it', async function (assert) {
      let roomId: string = (await realmEventRooms([testRealmHref])).body.rooms[
        testRealmHref
      ];

      let asOutsider = await loginAs(outsider);
      let outsiderJoin = await asOutsider(
        `join/${encodeURIComponent(roomId)}`,
        { method: 'POST', body: '{}' },
      );
      assert.strictEqual(
        outsiderJoin.status,
        403,
        'a user who was not invited may not join',
      );
      let outsiderMembers = await asOutsider(
        `rooms/${encodeURIComponent(roomId)}/members`,
      );
      assert.strictEqual(
        outsiderMembers.status,
        403,
        'a user outside the room may not list its members',
      );

      let asMember = await loginAs(member);
      let join = await asMember(`join/${encodeURIComponent(roomId)}`, {
        method: 'POST',
        body: '{}',
      });
      assert.strictEqual(join.status, 200, 'the invited grantee joins');

      let create = await asMember(
        `rooms/${encodeURIComponent(roomId)}/state/m.room.create/`,
      );
      assert.strictEqual(
        ((await create.json()) as { type?: string }).type,
        APP_BOXEL_REALM_EVENT_ROOM_TYPE,
        'the room has the realm event room type',
      );
      let history = await asMember(
        `rooms/${encodeURIComponent(roomId)}/state/m.room.history_visibility/`,
      );
      assert.strictEqual(
        ((await history.json()) as { history_visibility?: string })
          .history_visibility,
        'invited',
        'a member sees the history from their invite on',
      );

      let send = await asMember(
        `rooms/${encodeURIComponent(roomId)}/send/${APP_BOXEL_REALM_EVENT_TYPE}/forged-${Date.now()}`,
        { method: 'PUT', body: JSON.stringify({ eventName: 'index' }) },
      );
      assert.strictEqual(
        send.status,
        403,
        'a member may not send a realm event into the room',
      );
    });

    test('a grant invites its user to the room, and revoking it removes them', async function (assert) {
      let roomId: string = (await realmEventRooms([testRealmHref])).body.rooms[
        testRealmHref
      ];
      assert.strictEqual(await membershipOf(roomId, newcomer), undefined);

      let granted = await patchPermissions({ [newcomer]: ['read'] });
      assert.strictEqual(granted.status, 200, 'the grant succeeds');
      await waitUntil(
        async () => (await membershipOf(roomId, newcomer)) === 'invite',
        { timeout: 10_000, timeoutMessage: 'the grantee was never invited' },
      );

      let revoked = await patchPermissions({ [newcomer]: [] });
      assert.strictEqual(revoked.status, 200, 'the revocation succeeds');
      await waitUntil(
        async () => (await membershipOf(roomId, newcomer)) === 'leave',
        {
          timeout: 10_000,
          timeoutMessage: 'the revoked user was never removed',
        },
      );
      assert.strictEqual(
        await membershipOf(roomId, member),
        'invite',
        'the remaining grantee is still a member',
      );
    });

    test('syncing repairs a grant change made while nothing applied it', async function (assert) {
      let roomId: string = (await realmEventRooms([testRealmHref])).body.rooms[
        testRealmHref
      ];
      // Written straight to the table, the way a grant reaches a realm that
      // no process is serving.
      await insertPermissions(dbAdapter, new URL(testRealmHref), {
        [newcomer]: ['read'],
      });
      assert.strictEqual(await membershipOf(roomId, newcomer), undefined);

      await testRealm.syncRealmEventRoom();

      assert.strictEqual(await membershipOf(roomId, newcomer), 'invite');
    });
  });
});
