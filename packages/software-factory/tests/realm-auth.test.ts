import { module, test } from 'qunit';

import {
  createBoxelRealmFetch,
  type ActiveBoxelProfile,
} from '../src/realm-auth';

const matrixServerUrl = 'http://matrix.example.test/';
const realmServerUrl = 'http://realm-server.example.test/';
const briefCardUrl =
  'http://realm-server.example.test/factory/guidance-tasks/Wiki/brief-card';
const realmUrl = 'http://realm-server.example.test/factory/guidance-tasks/';

const profile: ActiveBoxelProfile = {
  profileId: '@factory:localhost',
  username: 'factory',
  matrixUrl: matrixServerUrl,
  realmServerUrl,
  password: 'secret',
};

module('realm-auth', function () {
  test('createBoxelRealmFetch returns a fetch that applies an explicit authorization override', async function (assert) {
    let fetchWasCalled = false;
    let fetchImpl = createBoxelRealmFetch(briefCardUrl, {
      authorization: 'Bearer explicit-token',
      profile,
      fetch: async (input, init) => {
        fetchWasCalled = true;
        assert.strictEqual(
          typeof input === 'string'
            ? new Headers(init?.headers).get('Authorization')
            : null,
          'Bearer explicit-token',
        );

        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      },
    });

    await fetchImpl(briefCardUrl);
    assert.true(fetchWasCalled);
  });

  test('createBoxelRealmFetch reauthenticates with runtime-common auth middleware for matching realm-server urls', async function (assert) {
    let calls: Array<{ url: string; authorization: string | null }> = [];
    let originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input, init) => {
      let request = new Request(input, init);
      let url = request.url;
      let authorization = request.headers.get('Authorization');

      calls.push({ url, authorization });

      if (url === briefCardUrl) {
        if (!authorization) {
          return new Response('unauthorized', {
            status: 401,
            headers: {
              'x-boxel-realm-url': realmUrl,
            },
          });
        }

        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        });
      }

      if (url === 'http://matrix.example.test/_matrix/client/v3/login') {
        return jsonResponse({
          access_token: 'matrix-access-token',
          device_id: 'device-id',
          user_id: '@factory:localhost',
        });
      }

      if (
        url ===
        'http://matrix.example.test/_matrix/client/v3/user/%40factory%3Alocalhost/openid/request_token'
      ) {
        return jsonResponse({
          access_token: 'openid-token',
          expires_in: 300,
          matrix_server_name: 'localhost',
          token_type: 'Bearer',
        });
      }

      if (
        url ===
        'http://realm-server.example.test/factory/guidance-tasks/_session'
      ) {
        return new Response('', {
          status: 201,
          headers: {
            Authorization: buildRealmSessionJwt(),
          },
        });
      }

      if (url === 'http://matrix.example.test/_matrix/client/v3/joined_rooms') {
        return jsonResponse({
          joined_rooms: [],
        });
      }

      throw new Error(`Unexpected url: ${url}`);
    }) as typeof globalThis.fetch;

    try {
      let fetchImpl = createBoxelRealmFetch(briefCardUrl, {
        profile,
      });

      let response = await fetchImpl(briefCardUrl);

      assert.strictEqual(response.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.deepEqual(calls, [
      {
        url: briefCardUrl,
        authorization: null,
      },
      {
        url: 'http://matrix.example.test/_matrix/client/v3/login',
        authorization: null,
      },
      {
        url: 'http://matrix.example.test/_matrix/client/v3/user/%40factory%3Alocalhost/openid/request_token',
        authorization: 'Bearer matrix-access-token',
      },
      {
        url: 'http://realm-server.example.test/factory/guidance-tasks/_session',
        authorization: null,
      },
      {
        url: 'http://matrix.example.test/_matrix/client/v3/joined_rooms',
        authorization: 'Bearer matrix-access-token',
      },
      {
        url: briefCardUrl,
        authorization: 'header.eyJzZXNzaW9uUm9vbSI6IiJ9.signature',
      },
    ]);
  });

  test('createBoxelRealmFetch skips runtime-common auth wiring for non-matching origins', async function (assert) {
    let fetchWasCalled = false;

    let fetchImpl = createBoxelRealmFetch(
      'http://127.0.0.1:4011/private/Wiki/brief-card',
      {
        profile,
        fetch: async () => {
          fetchWasCalled = true;
          return new Response('{}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          });
        },
      },
    );

    await fetchImpl('http://127.0.0.1:4011/private/Wiki/brief-card');
    assert.true(fetchWasCalled);
  });
});

function buildRealmSessionJwt(): string {
  return `header.${Buffer.from(
    JSON.stringify({ sessionRoom: '' }),
    'utf8',
  ).toString('base64')}.signature`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}
