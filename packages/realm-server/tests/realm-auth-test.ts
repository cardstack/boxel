import { module, test } from 'qunit';
import type { SuperTest, Test as SupertestTest } from 'supertest';
import sinon from 'sinon';
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { fetchSessionRoom } from '@cardstack/runtime-common/db-queries/session-room-queries';

import type { Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealm,
  insertUser,
  realmSecretSeed,
  testRealmHref,
  createJWT,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';
import { getAuthCookieName, parseAuthCookieName } from '../utils/auth-cookie';

module(basename(__filename), function () {
  module('realm auth handler', function (hooks) {
    let dbAdapter: PgAdapter;
    let request: SuperTest<SupertestTest>;
    const matrixUserId = '@firsttimer:localhost';

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

    test('POST /_realm-auth sets auth cookies for each realm', async function (assert) {
      sinon
        .stub(MatrixClient.prototype, 'createDM')
        .resolves('!session-room:localhost');
      sinon.stub(MatrixClient.prototype, 'sendEvent').resolves();
      sinon.stub(MatrixClient.prototype, 'getJoinedRooms').resolves({
        joined_rooms: [],
      });
      sinon.stub(MatrixClient.prototype, 'joinRoom').resolves();

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

      // Verify Set-Cookie headers are present
      let setCookieHeaders = response.headers[
        'set-cookie'
      ] as unknown as string[];
      assert.ok(setCookieHeaders, 'Set-Cookie headers are present in response');
      assert.true(
        Array.isArray(setCookieHeaders),
        'Multiple Set-Cookie headers are returned',
      );

      // Check that we have a cookie for the test realm
      let expectedCookieName = getAuthCookieName(testRealmHref);
      let realmCookie = setCookieHeaders.find((cookie: string) =>
        cookie.startsWith(expectedCookieName),
      );
      assert.ok(realmCookie, 'Cookie for test realm is set');

      // Verify cookie attributes
      assert.true(
        realmCookie!.includes('HttpOnly'),
        'Cookie has HttpOnly attribute',
      );
      assert.true(
        realmCookie!.includes('SameSite=Lax'),
        'Cookie has SameSite=Lax attribute',
      );
      assert.true(realmCookie!.includes('Path='), 'Cookie has Path attribute');
      assert.true(
        realmCookie!.includes('Max-Age='),
        'Cookie has Max-Age attribute',
      );

      // Verify the cookie name can be parsed back to realm path
      let realmPath = parseAuthCookieName(expectedCookieName);
      assert.ok(realmPath, 'Cookie name can be parsed back to realm path');
    });
  });

  module('cookie auth middleware', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<SupertestTest>;
    const userId = 'john';

    // Use a permissioned realm (not public) to test cookie auth
    setupPermissionedRealm(hooks, {
      permissions: {
        [userId]: ['read', 'write'],
      },
      onRealmSetup: ({ testRealm: realm, request: req }) => {
        testRealm = realm;
        request = req;
      },
    });

    test('GET request with valid auth cookie succeeds', async function (assert) {
      // Create a JWT for the user
      let token = createJWT(testRealm, userId, ['read']);

      // Create the Cookie header (name=value format)
      let cookieName = getAuthCookieName(testRealmHref);
      let cookieHeader = `${cookieName}=${encodeURIComponent(token)}`;

      // Make GET request with only cookie (no Authorization header)
      let response = await request
        .get('/dir/')
        .set('Accept', 'application/vnd.api+json')
        .set('Cookie', cookieHeader);

      assert.strictEqual(
        response.status,
        200,
        'GET request with cookie succeeds',
      );
    });

    test('GET request without auth cookie or Authorization header fails', async function (assert) {
      // Make GET request without any auth
      let response = await request
        .get('/dir/')
        .set('Accept', 'application/vnd.api+json');

      assert.strictEqual(
        response.status,
        401,
        'GET request without auth fails with 401',
      );
    });

    test('POST request with only cookie fails (requires Authorization header)', async function (assert) {
      // Create a JWT for the user with write permissions
      let token = createJWT(testRealm, userId, ['read', 'write']);

      // Create the cookie header
      let cookieName = getAuthCookieName(testRealmHref);
      let cookieHeader = `${cookieName}=${encodeURIComponent(token)}`;

      // Make POST request with only cookie (no Authorization header)
      // This should fail because cookie auth only works for GET/HEAD
      let response = await request
        .post('/new-card.json')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/vnd.card+json')
        .set('Cookie', cookieHeader)
        .send(
          JSON.stringify({
            data: {
              type: 'card',
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/card-api',
                  name: 'CardDef',
                },
              },
            },
          }),
        );

      assert.strictEqual(
        response.status,
        401,
        'POST request with only cookie fails with 401',
      );
    });

    test('Authorization header takes precedence over cookie', async function (assert) {
      // Create a valid token for cookie
      let cookieToken = createJWT(testRealm, userId, ['read']);
      let cookieName = getAuthCookieName(testRealmHref);
      let cookieHeader = `${cookieName}=${encodeURIComponent(cookieToken)}`;

      // Use an invalid Authorization header
      let response = await request
        .get('/dir/')
        .set('Accept', 'application/vnd.api+json')
        .set('Cookie', cookieHeader)
        .set('Authorization', 'Bearer invalid-token');

      // Should fail because Authorization header (invalid) takes precedence
      assert.strictEqual(
        response.status,
        401,
        'Invalid Authorization header takes precedence over valid cookie',
      );
    });

    test('HEAD request with valid auth cookie succeeds', async function (assert) {
      // Create a JWT for the user
      let token = createJWT(testRealm, userId, ['read']);

      // Create the cookie header
      let cookieName = getAuthCookieName(testRealmHref);
      let cookieHeader = `${cookieName}=${encodeURIComponent(token)}`;

      // Make HEAD request with only cookie (no Authorization header)
      let response = await request
        .head('/dir/')
        .set('Accept', 'application/vnd.api+json')
        .set('Cookie', cookieHeader);

      assert.strictEqual(
        response.status,
        200,
        'HEAD request with cookie succeeds',
      );
    });
  });
});
