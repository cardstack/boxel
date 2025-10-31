import { module, test } from 'qunit';
import type { SuperTest, Test as SupertestTest } from 'supertest';
import sinon from 'sinon';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { fetchSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';

import {
  setupPermissionedRealm,
  insertUser,
  realmSecretSeed,
  testRealmHref,
  setupBaseRealmServer,
  matrixURL,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';

module(basename(__filename), function () {
  module('realm auth handler', function (hooks) {
    let dbAdapter: PgAdapter;
    let request: SuperTest<SupertestTest>;
    const matrixUserId = '@firsttimer:localhost';

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read'],
        [matrixUserId]: ['read', 'write'],
      },
      onRealmSetup: ({ dbAdapter: adapter, request: req }) => {
        dbAdapter = adapter;
        request = req;
      },
    });

    hooks.beforeEach(async function () {
      await insertUser(dbAdapter, matrixUserId, 'cus_test', null);
    });

    hooks.afterEach(function () {
      sinon.restore();
    });

    test('POST /_realm-auth creates session rooms when missing', async function (assert) {
      let expectedRoomId = '!new-session-room:localhost';
      let createDMStub = sinon
        .stub(MatrixClient.prototype, 'createDM')
        .resolves(expectedRoomId);
      sinon.stub(MatrixClient.prototype, 'sendEvent').resolves();
      sinon.stub(MatrixClient.prototype, 'getJoinedRooms').resolves({
        joined_rooms: [],
      });
      sinon.stub(MatrixClient.prototype, 'joinRoom').resolves();

      let existingRoom = await fetchSessionRoom(
        dbAdapter,
        testRealmHref,
        matrixUserId,
      );
      assert.strictEqual(
        existingRoom,
        null,
        'no session room exists before requesting realm auth',
      );

      let response = await request
        .post('/_realm-auth')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: matrixUserId, sessionRoom: 'server-session-room' },
            realmSecretSeed,
          )}`,
        )
        .send('{}');

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(
        response.body[testRealmHref],
        'response includes a JWT for the requested realm',
      );
      assert.true(createDMStub.called, 'realm attempted to create a DM room');
      assert.true(
        createDMStub.calledWith(matrixUserId),
        'realm created the DM room for the requesting user',
      );

      let sessionRoom = await fetchSessionRoom(
        dbAdapter,
        testRealmHref,
        matrixUserId,
      );
      assert.strictEqual(
        sessionRoom,
        expectedRoomId,
        'session room is persisted after the realm auth request',
      );
    });
  });
});
