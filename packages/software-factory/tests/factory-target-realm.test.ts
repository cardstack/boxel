import { module, test } from 'qunit';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
} from '../src/factory-target-realm';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

module('factory-target-realm', function (hooks) {
  let originalHome = process.env.HOME;
  let originalMatrixUsername = process.env.MATRIX_USERNAME;
  let originalMatrixUrl = process.env.MATRIX_URL;
  let originalMatrixPassword = process.env.MATRIX_PASSWORD;
  let originalRealmServerUrl = process.env.REALM_SERVER_URL;
  let originalFetch = globalThis.fetch;

  hooks.afterEach(function () {
    restoreEnv('HOME', originalHome);
    restoreEnv('MATRIX_USERNAME', originalMatrixUsername);
    restoreEnv('MATRIX_URL', originalMatrixUrl);
    restoreEnv('MATRIX_PASSWORD', originalMatrixPassword);
    restoreEnv('REALM_SERVER_URL', originalRealmServerUrl);
    globalThis.fetch = originalFetch;
  });

  test('resolveFactoryTargetRealm uses MATRIX_USERNAME and explicit target URL', function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    assert.strictEqual(resolution.url, targetRealmUrl);
    assert.strictEqual(resolution.serverUrl, 'https://realms.example.test/');
    assert.strictEqual(resolution.ownerUsername, 'hassan');
  });

  test('resolveFactoryTargetRealm accepts an explicit realm server URL override', function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl: 'https://realms.example.test/boxel/hassan/personal/',
      realmServerUrl: 'https://realms.example.test/boxel/',
    });

    assert.strictEqual(
      resolution.serverUrl,
      'https://realms.example.test/boxel/',
    );
  });

  test('resolveFactoryTargetRealm rejects when target realm URL is missing', function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealmUrl: null,
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message === 'Missing required --target-realm-url',
    );
  });

  test('resolveFactoryTargetRealm rejects when MATRIX_USERNAME is missing', function (assert) {
    delete process.env.MATRIX_USERNAME;

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealmUrl,
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message.includes('Set MATRIX_USERNAME'),
    );
  });

  test('bootstrapFactoryTargetRealm creates the realm through the API', async function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';
    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });
    let createCalls = 0;

    let result = await bootstrapFactoryTargetRealm(resolution, {
      createRealm: async () => {
        createCalls++;
        return {
          createdRealm: true,
          url: resolution.url,
        };
      },
    });

    assert.strictEqual(createCalls, 1);
    assert.true(result.createdRealm);
  });

  test('bootstrapFactoryTargetRealm reports when the realm already exists', async function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';
    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    let result = await bootstrapFactoryTargetRealm(resolution, {
      createRealm: async () => ({
        createdRealm: false,
        url: resolution.url,
      }),
    });

    assert.false(result.createdRealm);
  });

  test('bootstrapFactoryTargetRealm uses the canonical realm URL returned by create-realm', async function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';
    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl: 'https://realms.example.test/typed-by-user/personal/',
      realmServerUrl: null,
    });

    let result = await bootstrapFactoryTargetRealm(resolution, {
      createRealm: async () => ({
        createdRealm: true,
        url: 'https://realms.example.test/hassan/personal/',
      }),
    });

    assert.strictEqual(
      result.url,
      'https://realms.example.test/hassan/personal/',
    );
  });

  test('bootstrapFactoryTargetRealm sends the realm-server JWT to create-realm', async function (assert) {
    assert.expect(8);

    process.env.MATRIX_URL = 'https://matrix.example.test/';
    process.env.MATRIX_USERNAME = 'hassan';
    process.env.MATRIX_PASSWORD = 'secret';
    process.env.REALM_SERVER_URL = 'https://realms.example.test/';

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    let accountDataUrl =
      'https://matrix.example.test/_matrix/client/v3/user/%40hassan%3Alocalhost/account_data/app.boxel.realms';

    globalThis.fetch = (async (input, init) => {
      let request = new Request(input, init);
      let response: Response;

      if (
        request.url === 'https://matrix.example.test/_matrix/client/v3/login'
      ) {
        assert.strictEqual(request.headers.get('Authorization'), null);
        response = new Response(
          JSON.stringify({
            access_token: 'matrix-access-token',
            device_id: 'device-id',
            user_id: '@hassan:localhost',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      } else if (
        request.url ===
        'https://matrix.example.test/_matrix/client/v3/user/%40hassan%3Alocalhost/openid/request_token'
      ) {
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer matrix-access-token',
        );
        response = new Response(
          JSON.stringify({
            access_token: 'openid-token',
            expires_in: 300,
            matrix_server_name: 'localhost',
            token_type: 'Bearer',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      } else if (
        request.url === 'https://realms.example.test/_server-session'
      ) {
        assert.strictEqual(request.headers.get('Authorization'), null);
        response = new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer realm-server-token',
          },
        });
      } else if (request.url === 'https://realms.example.test/_create-realm') {
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer realm-server-token',
        );
        assert.deepEqual(await request.json(), {
          data: {
            type: 'realm',
            attributes: {
              endpoint: 'personal',
              name: 'personal',
            },
          },
        });
        response = new Response(
          JSON.stringify({
            data: {
              type: 'realm',
              id: targetRealmUrl,
            },
          }),
          {
            status: 201,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      } else if (request.url === accountDataUrl && request.method === 'GET') {
        // Return empty account data (no realms yet)
        response = new Response(JSON.stringify({ realms: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      } else if (request.url === accountDataUrl && request.method === 'PUT') {
        let body = (await request.json()) as { realms: string[] };
        assert.deepEqual(body.realms, [targetRealmUrl]);
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer matrix-access-token',
        );
        response = new Response('{}', { status: 200 });
      } else {
        throw new Error(`Unexpected url: ${request.method} ${request.url}`);
      }

      return response;
    }) as typeof globalThis.fetch;

    let result = await bootstrapFactoryTargetRealm(resolution);

    assert.true(result.createdRealm);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
