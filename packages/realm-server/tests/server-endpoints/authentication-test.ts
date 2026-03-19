import { module, test } from 'qunit';
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type { RealmServerTokenClaim } from '../../utils/jwt';
import {
  realmSecretSeed,
  realmServerTestMatrix,
  setupPermissionedRealmCached,
  testRealmURL,
} from '../helpers';
import { createRealmServerSession } from './helpers';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import type { PgAdapter } from '@cardstack/postgres';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`server-endpoints/${basename(__filename)}`, function () {
  module('Realm server authentication', function (hooks) {
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    function onRealmSetup(args: {
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dbAdapter: PgAdapter;
    }) {
      dbAdapter = args.dbAdapter;
      request = args.request;
    }

    setupPermissionedRealmCached(hooks, {
      fileSystem: {},
      permissions: {
        '@test_realm:localhost': ['read', 'realm-owner'],
      },
      realmURL: testRealmURL,
      onRealmSetup: onRealmSetup,
    });

    test('authenticates user and creates session room', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        // it's a little awkward that we are hijacking a realm user to pretend to
        // act like a normal user, but that's what's happening here
        username: 'test_realm',
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let userId = matrixClient.getUserId()!;

      // User exists (created by ensureTestUser in test setup) but has no session room
      let userBefore = await getUserByMatrixUserId(dbAdapter, userId);
      assert.ok(userBefore, 'User exists from test setup');
      assert.strictEqual(
        userBefore!.sessionRoomId,
        null,
        'No session room before first session',
      );

      let { jwt: token, status } = await createRealmServerSession(
        matrixClient,
        request,
      );

      assert.strictEqual(status, 201, 'HTTP 201 status');
      let decoded = jwt.verify(token, realmSecretSeed) as RealmServerTokenClaim;
      assert.strictEqual(decoded.user, userId);
      assert.notStrictEqual(
        decoded.sessionRoom,
        undefined,
        'sessionRoom should be defined',
      );

      // Session room should now be stored
      let userAfter = await getUserByMatrixUserId(dbAdapter, userId);
      assert.ok(userAfter!.sessionRoomId, 'Session room was created');

      // Creating another session should reuse the session room
      let { status: status2, sessionRoom: sessionRoom2 } =
        await createRealmServerSession(matrixClient, request);
      assert.strictEqual(status2, 201, 'Second session creation succeeds');
      assert.strictEqual(
        sessionRoom2,
        decoded.sessionRoom,
        'Second session reuses the same session room',
      );
    });

    test('saves registration token passed during session creation', async function (assert) {
      let matrixClient = new MatrixClient({
        matrixURL: realmServerTestMatrix.url,
        username: 'test_realm',
        seed: realmSecretSeed,
      });
      await matrixClient.login();
      let userId = matrixClient.getUserId()!;

      // User exists from test setup but has no registration token
      let userBefore = await getUserByMatrixUserId(dbAdapter, userId);
      assert.strictEqual(
        userBefore!.matrixRegistrationToken,
        null,
        'No registration token before session',
      );

      // Create session with a registration token (simulates initial signup)
      let { status } = await createRealmServerSession(matrixClient, request, {
        registrationToken: 'my-invite-code',
      });
      assert.strictEqual(status, 201, 'HTTP 201 status');

      let user = await getUserByMatrixUserId(dbAdapter, userId);
      assert.strictEqual(
        user!.matrixRegistrationToken,
        'my-invite-code',
        'Registration token was saved during session creation',
      );
    });
  });
});
