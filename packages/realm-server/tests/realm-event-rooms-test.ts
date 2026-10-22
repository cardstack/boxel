import QUnit from 'qunit';
const { module, test } = QUnit;
import type { SuperTest, Test as SupertestTest } from 'supertest';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { insertPermissions } from '@cardstack/runtime-common';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';
import {
  APP_BOXEL_REALM_EVENT_ROOM_TYPE,
  APP_BOXEL_REALM_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import {
  matrixURL,
  realmSecretSeed,
  setupPermissionedRealmCached,
  testRealmHref,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

module(basename(import.meta.filename), function () {
  module('realm event rooms handler', function (hooks) {
    let dbAdapter: PgAdapter;
    let request: SuperTest<SupertestTest>;
    const matrixUserId = '@test_realm:localhost';

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: ({ dbAdapter: adapter, request: req }) => {
        dbAdapter = adapter;
        request = req;
      },
    });

    function realmEventRooms(realms: string[]) {
      return request
        .post('/_realm-event-rooms')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'server-session-room' },
            realmSecretSeed,
          )}`,
        )
        .send(JSON.stringify({ realms }));
    }

    // A client for a user other than the realm's, the way a host is one.
    async function loginAsMember() {
      let response = await fetch(
        new URL('_matrix/client/v3/login', matrixURL),
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: { type: 'm.id.user', user: 'test_realm' },
            password: await passwordFromSeed('test_realm', realmSecretSeed),
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

    test('answers a world-readable realm with the same room each time', async function (assert) {
      let first = await realmEventRooms([testRealmHref]);
      assert.strictEqual(first.status, 200, 'HTTP 200 status');
      let roomId = first.body.rooms[testRealmHref];
      assert.ok(roomId, 'the realm has an event room');

      let second = await realmEventRooms([testRealmHref]);
      assert.strictEqual(
        second.body.rooms[testRealmHref],
        roomId,
        'asking again answers with the same room',
      );
    });

    test('leaves out a realm that is not world-readable', async function (assert) {
      let privateRealmURL = new URL('http://127.0.0.1:4444/private/');
      await insertPermissions(dbAdapter, privateRealmURL, {
        [matrixUserId]: ['read', 'write'],
      });

      let response = await realmEventRooms([
        privateRealmURL.href,
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

    test('lets any user join the room, and only the realm send in it', async function (assert) {
      let roomId: string = (await realmEventRooms([testRealmHref])).body.rooms[
        testRealmHref
      ];
      let member = await loginAsMember();

      let join = await member(`join/${encodeURIComponent(roomId)}`, {
        method: 'POST',
        body: '{}',
      });
      assert.strictEqual(join.status, 200, 'a user who was not invited joins');

      let create = await member(
        `rooms/${encodeURIComponent(roomId)}/state/m.room.create/`,
      );
      assert.strictEqual(
        ((await create.json()) as { type?: string }).type,
        APP_BOXEL_REALM_EVENT_ROOM_TYPE,
        'the room has the realm event room type',
      );

      let send = await member(
        `rooms/${encodeURIComponent(roomId)}/send/${APP_BOXEL_REALM_EVENT_TYPE}/forged-${Date.now()}`,
        { method: 'PUT', body: JSON.stringify({ eventName: 'index' }) },
      );
      assert.strictEqual(
        send.status,
        403,
        'a member may not send a realm event into the room',
      );
    });
  });
});
