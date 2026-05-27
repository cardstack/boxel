import { module, test } from 'qunit';
import type { SuperTest, Test as SupertestTest } from 'supertest';
import sinon from 'sinon';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { fetchSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';

import {
  setupPermissionedRealmCached,
  realmSecretSeed,
  testRealmHref,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import { insertSourceRealmInRegistry } from '../lib/realm-registry-writes';
import type { RealmServer } from '../server';

module(basename(__filename), function () {
  module('realm auth handler', function (hooks) {
    let dbAdapter: PgAdapter;
    let request: SuperTest<SupertestTest>;
    let testRealmServer: RealmServer;
    const matrixUserId = '@firsttimer:localhost';

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        '*': ['read'],
        [matrixUserId]: ['read', 'write'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup: ({
        dbAdapter: adapter,
        request: req,
        testRealmServer: server,
      }) => {
        dbAdapter = adapter;
        request = req;
        testRealmServer = server.testRealmServer;
      },
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

      let existingRoom = await fetchSessionRoom(dbAdapter, matrixUserId);
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

      let sessionRoom = await fetchSessionRoom(dbAdapter, matrixUserId);
      assert.strictEqual(
        sessionRoom,
        expectedRoomId,
        'session room is persisted after the realm auth request',
      );
    });

    // CS-11264 regression: after a realm-server restart, a non-pinned
    // realm has a row in realm_registry but no active Realm instance
    // on this process until something triggers a lazy mount via the
    // request path. Pre-fix, _realm-auth iterated realms[] directly
    // and silently skipped any realm not yet mounted on this instance
    // — so an owner's first post-restart boxel-cli call
    // (push/publish/sync) failed with "No realm token available".
    // Post-fix, the handler validates against reconciler.knownByUrl
    // (with a registry probe fallback) and issues a JWT without
    // mounting; the mount happens later via the normal request path
    // when the holder of the JWT actually hits a realm endpoint.
    //
    // Mounting per row inside _realm-auth was rejected because
    // fetchUserPermissions(onlyOwnRealms:false) returns every
    // '*'-readable realm, so a single boxel realm list / host login
    // would cold-mount the entire accessible set after a restart.
    test('POST /_realm-auth issues a token for a realm absent from realms[] and reconciler.mounted (post-restart)', async function (assert) {
      sinon
        .stub(MatrixClient.prototype, 'createDM')
        .resolves('!post-restart-session-room:localhost');
      sinon.stub(MatrixClient.prototype, 'sendEvent').resolves();
      sinon.stub(MatrixClient.prototype, 'getJoinedRooms').resolves({
        joined_rooms: [],
      });
      sinon.stub(MatrixClient.prototype, 'joinRoom').resolves();

      // Bring the test fixture's realm into the realm_registry so the
      // post-restart state we're simulating is faithful: in production
      // every realm has a registry row, but runTestRealmServer
      // legacy-registers its testRealm into reconciler.mounted without
      // inserting (registerExistingMounts deliberately bypasses
      // knownByUrl to preserve legacy mounts across reconcile passes).
      // Insert + reconcile so reconciler.knownByUrl reflects the row,
      // matching what a real boot would have done.
      await insertSourceRealmInRegistry(dbAdapter, {
        url: testRealmHref,
        diskId: 'node-test_realm/test',
        ownerUsername: 'node-test_realm',
      });
      await testRealmServer.testingOnlyReconcile();

      // Simulate the post-restart state: registry row + knownByUrl
      // entry are present (reconciler boot has reflected the registry),
      // but neither realms[] nor reconciler.mounted holds an active
      // Realm. The handler must NOT attempt to cold-mount; it must
      // issue a JWT from the registry presence alone.
      testRealmServer.testingOnlyEvictRealmFromRealmsList(testRealmHref);
      assert.false(
        testRealmServer.testingOnlyRealms.some((r) => r.url === testRealmHref),
        'precondition: realm is absent from realms[]',
      );
      assert.false(
        testRealmServer.testingOnlyReconciler.mounted.has(testRealmHref),
        'precondition: realm is absent from reconciler.mounted',
      );
      assert.true(
        testRealmServer.testingOnlyReconciler.knownByUrl.has(testRealmHref),
        'precondition: registry row is still reflected in reconciler.knownByUrl',
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
        'response includes a JWT for the realm even though it was absent from realms[] and reconciler.mounted',
      );
      assert.false(
        testRealmServer.testingOnlyReconciler.mounted.has(testRealmHref),
        'the handler did NOT cold-mount the realm — mount remains deferred to the next per-realm request',
      );
    });
  });
});
