import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import jsonwebtoken from 'jsonwebtoken';
import { MatrixBackendAuthentication } from '@cardstack/runtime-common/matrix-backend-authentication';
import type { Utils } from '@cardstack/runtime-common/matrix-backend-authentication';
import {
  EXTENDED_SESSION_TOKEN_TTL,
  SESSION_TOKEN_TTL,
} from '@cardstack/runtime-common/session-token';
import { createJWT } from '../utils/jwt.ts';
import { realmSecretSeed } from './helpers/index.ts';

const user = '@alice:localhost';

function lifetimeSeconds(token: string): number {
  let { iat, exp } = jsonwebtoken.decode(token) as {
    iat: number;
    exp: number;
  };
  return exp - iat;
}

// Drives `createSession` without a Synapse server: the client only has to verify
// the OpenID token and name the user, and `createJWT` records what it was asked
// for so the test can assert the lifetime request survived the round trip.
function makeAuthentication() {
  let createJWTCalls: Array<{ extendedLifetime?: boolean } | undefined> = [];
  let matrixClient = {
    isTokenValid: async () => true,
    login: async () => {},
    verifyOpenIdToken: async () => user,
    getUserId: () => '@realm:localhost',
  } as any;
  let utils = {
    badRequest: (message: string) =>
      new Response(message, { status: 400, statusText: 'Bad Request' }),
    createResponse: (body: BodyInit | null, init: ResponseInit | undefined) =>
      new Response(body, init),
    createJWT: async (
      u: string,
      sessionRoom?: string,
      opts?: { extendedLifetime?: boolean },
    ) => {
      createJWTCalls.push(opts);
      return createJWT(
        { user: u, sessionRoom: sessionRoom ?? '' },
        realmSecretSeed,
        opts?.extendedLifetime ? EXTENDED_SESSION_TOKEN_TTL : SESSION_TOKEN_TTL,
      );
    },
    ensureSessionRoom: async () => '!session:localhost',
  } as Utils;

  return {
    auth: new MatrixBackendAuthentication(matrixClient, utils),
    createJWTCalls,
  };
}

function sessionRequest(body: Record<string, unknown>) {
  return new Request('https://realm.example/_server-session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

module(basename(import.meta.filename), function () {
  module('createJWT lifetime', function () {
    test('defaults to the short session lifetime', function (assert) {
      let token = createJWT({ user, sessionRoom: '' }, realmSecretSeed);
      assert.strictEqual(
        lifetimeSeconds(token),
        24 * 60 * 60,
        'the default token lives 24 hours',
      );
    });

    test('honors an explicit extended lifetime', function (assert) {
      let token = createJWT(
        { user, sessionRoom: '' },
        realmSecretSeed,
        EXTENDED_SESSION_TOKEN_TTL,
      );
      assert.strictEqual(
        lifetimeSeconds(token),
        7 * 24 * 60 * 60,
        'the extended token lives 7 days',
      );
    });
  });

  module('_server-session lifetime negotiation', function () {
    test('omitting lifetime mints the short default', async function (assert) {
      let { auth, createJWTCalls } = makeAuthentication();

      let response = await auth.createSession(
        sessionRequest({ access_token: 'openid' }),
      );

      assert.strictEqual(response.status, 201, 'the session is created');
      assert.false(
        Boolean(createJWTCalls[0]?.extendedLifetime),
        'no extended lifetime was requested',
      );
      assert.strictEqual(
        lifetimeSeconds(response.headers.get('Authorization')!),
        24 * 60 * 60,
        'the issued token lives 24 hours',
      );
    });

    test('lifetime=extended mints the long-lived token', async function (assert) {
      let { auth, createJWTCalls } = makeAuthentication();

      let response = await auth.createSession(
        sessionRequest({ access_token: 'openid', lifetime: 'extended' }),
      );

      assert.strictEqual(response.status, 201, 'the session is created');
      assert.true(
        createJWTCalls[0]?.extendedLifetime,
        'the extended lifetime reached createJWT',
      );
      assert.strictEqual(
        lifetimeSeconds(response.headers.get('Authorization')!),
        7 * 24 * 60 * 60,
        'the issued token lives 7 days',
      );
    });

    test('an unrecognized lifetime is rejected rather than silently ignored', async function (assert) {
      let { auth, createJWTCalls } = makeAuthentication();

      let response = await auth.createSession(
        sessionRequest({ access_token: 'openid', lifetime: 'forever' }),
      );

      assert.strictEqual(response.status, 400, 'the request is rejected');
      assert.strictEqual(
        createJWTCalls.length,
        0,
        'no token was minted for a bad lifetime',
      );
    });
  });
});
