import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { MatrixBackendAuthentication } from '@cardstack/runtime-common/matrix-backend-authentication';
import type { Utils } from '@cardstack/runtime-common/matrix-backend-authentication';

const PAIRED_SERVER = 'localhost';
const PAIRED_USER = '@someone:localhost';
const OTHER_SERVER = 'other.example';
const OTHER_USER = '@someone:other.example';

// Drives `createSession` without a homeserver: the client records which
// issuing server it was asked to verify the token with, and names the user
// `vouchedFor` says it does.
function makeAuthentication() {
  let verifications: Array<{ token: string; serverName: string }> = [];
  let vouchedFor: Record<string, string | undefined> = {
    [PAIRED_SERVER]: PAIRED_USER,
    [OTHER_SERVER]: OTHER_USER,
  };
  let matrixClient = {
    serverName: PAIRED_SERVER,
    isTokenValid: async () => true,
    login: async () => {},
    verifyOpenIdToken: async (token: string, serverName: string) => {
      verifications.push({ token, serverName });
      return vouchedFor[serverName];
    },
    getUserId: () => '@realm:localhost',
  } as unknown as MatrixClient;
  let minted: string[] = [];
  let utils = {
    badRequest: (message: string) =>
      new Response(message, { status: 400, statusText: 'Bad Request' }),
    createResponse: (body: BodyInit | null, init: ResponseInit | undefined) =>
      new Response(body, init),
    createJWT: async (user: string) => {
      minted.push(user);
      return `jwt-for-${user}`;
    },
    ensureSessionRoom: async () => '!session:localhost',
  } as Utils;
  return {
    auth: new MatrixBackendAuthentication(matrixClient, utils),
    verifications,
    minted,
    vouchedFor,
  };
}

function sessionRequest(body: Record<string, unknown>) {
  return new Request('https://realm.example/_server-session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

module(basename(import.meta.filename), function () {
  module('the issuing homeserver of an OpenID token', function () {
    test('a token sent without matrix_server_name is verified with the paired homeserver', async function (assert) {
      let { auth, verifications, minted } = makeAuthentication();
      let response = await auth.createSession(
        sessionRequest({ access_token: 'token-1' }),
      );
      assert.strictEqual(response.status, 201);
      assert.deepEqual(verifications, [
        { token: 'token-1', serverName: PAIRED_SERVER },
      ]);
      assert.deepEqual(minted, [PAIRED_USER]);
    });

    test("a token is verified with the homeserver its matrix_server_name names, and the session is that server's user", async function (assert) {
      let { auth, verifications, minted } = makeAuthentication();
      let response = await auth.createSession(
        sessionRequest({
          access_token: 'token-2',
          matrix_server_name: OTHER_SERVER,
        }),
      );
      assert.strictEqual(response.status, 201);
      assert.deepEqual(verifications, [
        { token: 'token-2', serverName: OTHER_SERVER },
      ]);
      assert.deepEqual(minted, [OTHER_USER]);
    });

    test('a matrix_server_name that is not a server name is a bad request and nothing is verified', async function (assert) {
      let { auth, verifications } = makeAuthentication();
      for (let name of [
        'https://other.example',
        'other.example/path',
        42,
        '',
      ]) {
        let response = await auth.createSession(
          sessionRequest({ access_token: 'token-3', matrix_server_name: name }),
        );
        assert.strictEqual(response.status, 400, `${name} is refused`);
        assert.true(
          (await response.text()).includes('matrix_server_name'),
          'the response names the field',
        );
      }
      assert.deepEqual(verifications, []);
    });

    test('a token the issuing homeserver does not vouch for mints no session', async function (assert) {
      let { auth, minted, vouchedFor } = makeAuthentication();
      vouchedFor[OTHER_SERVER] = undefined;
      let response = await auth.createSession(
        sessionRequest({
          access_token: 'token-4',
          matrix_server_name: OTHER_SERVER,
        }),
      );
      assert.strictEqual(response.status, 400);
      assert.deepEqual(minted, []);
    });
  });

  // Exercises `MatrixClient#verifyOpenIdToken` against a stand-in for the
  // network: the paired homeserver and `other.example` answer the federation
  // endpoint, `other.example` publishes a well-known delegation, and the test
  // asserts which servers were asked and whose answers are trusted.
  module('MatrixClient#verifyOpenIdToken', function (hooks) {
    const pairedURL = 'https://matrix.example.test/';
    let realFetch: typeof globalThis.fetch;
    let requested: string[];
    let userinfo: Record<string, { status: number; body: unknown }>;

    hooks.beforeEach(function () {
      realFetch = globalThis.fetch;
      requested = [];
      userinfo = {};
      globalThis.fetch = (async (input: string | URL | Request) => {
        let url = typeof input === 'string' ? input : input.toString();
        requested.push(url);
        if (url === `https://${OTHER_SERVER}/.well-known/matrix/server`) {
          return Response.json({ 'm.server': 'federation.other.example:443' });
        }
        let base = Object.keys(userinfo).find((origin) =>
          url.startsWith(`${origin}_matrix/federation/v1/openid/userinfo?`),
        );
        if (!base) {
          throw new TypeError('fetch failed');
        }
        let { status, body } = userinfo[base];
        return Response.json(body, { status });
      }) as typeof globalThis.fetch;
    });

    hooks.afterEach(function () {
      globalThis.fetch = realFetch;
    });

    function client() {
      return new MatrixClient({
        matrixURL: new URL(pairedURL),
        serverName: 'example.test',
        username: 'realm',
        seed: 'seed',
      });
    }

    test('a token for the paired server is asked of the paired homeserver', async function (assert) {
      userinfo[pairedURL] = {
        status: 200,
        body: { sub: '@someone:example.test' },
      };
      assert.strictEqual(
        await client().verifyOpenIdToken('token', 'example.test'),
        '@someone:example.test',
      );
      assert.deepEqual(requested, [
        `${pairedURL}_matrix/federation/v1/openid/userinfo?access_token=token`,
      ]);
    });

    test('a token for another server is asked of that server, found by discovery', async function (assert) {
      userinfo['https://federation.other.example:443/'] = {
        status: 200,
        body: { sub: OTHER_USER },
      };
      assert.strictEqual(
        await client().verifyOpenIdToken('token', OTHER_SERVER),
        OTHER_USER,
      );
      assert.deepEqual(requested, [
        `https://${OTHER_SERVER}/.well-known/matrix/server`,
        'https://federation.other.example:443/_matrix/federation/v1/openid/userinfo?access_token=token',
      ]);
    });

    test('a server may vouch only for its own users: a sub on another server is refused', async function (assert) {
      userinfo['https://federation.other.example:443/'] = {
        status: 200,
        body: { sub: '@owner:example.test' },
      };
      assert.strictEqual(
        await client().verifyOpenIdToken('token', OTHER_SERVER),
        undefined,
        'other.example cannot vouch for a user of the paired server',
      );
      userinfo[pairedURL] = { status: 200, body: { sub: OTHER_USER } };
      assert.strictEqual(
        await client().verifyOpenIdToken('token', 'example.test'),
        undefined,
        'the paired server cannot vouch for a user of another server',
      );
    });

    test('a token the issuing server refuses, or a server that cannot be reached, verifies nobody', async function (assert) {
      userinfo['https://federation.other.example:443/'] = {
        status: 401,
        body: { errcode: 'M_UNKNOWN_TOKEN' },
      };
      assert.strictEqual(
        await client().verifyOpenIdToken('token', OTHER_SERVER),
        undefined,
      );
      assert.strictEqual(
        await client().verifyOpenIdToken('token', 'unreachable.example'),
        undefined,
      );
      assert.deepEqual(
        requested.slice(-3),
        [
          'https://unreachable.example/.well-known/matrix/server',
          'https://unreachable.example:8448/_matrix/federation/v1/openid/userinfo?access_token=token',
          'https://unreachable.example/_matrix/federation/v1/openid/userinfo?access_token=token',
        ],
        'every URL discovery names is tried',
      );
    });

    test('text that is not a server name is never fetched', async function (assert) {
      assert.strictEqual(
        await client().verifyOpenIdToken('token', 'other.example/../x'),
        undefined,
      );
      assert.deepEqual(requested, []);
    });
  });
});
