import { module, test } from 'qunit';

import { SupportedMimeType } from '../src/mime-types';

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
          authorization: 'Bearer target-realm-token',
        };
      },
    });

    assert.strictEqual(createCalls, 1);
    assert.true(result.createdRealm);
    assert.strictEqual(result.authorization, 'Bearer target-realm-token');
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
        authorization: 'Bearer target-realm-token',
      }),
    });

    assert.false(result.createdRealm);
    assert.strictEqual(result.authorization, 'Bearer target-realm-token');
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
        authorization: 'Bearer target-realm-token',
      }),
    });

    assert.strictEqual(
      result.url,
      'https://realms.example.test/hassan/personal/',
    );
    assert.strictEqual(result.authorization, 'Bearer target-realm-token');
  });

  test('bootstrapFactoryTargetRealm sends the realm-server JWT to create-realm', async function (assert) {
    assert.expect(17);

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
              'content-type': SupportedMimeType.JSON,
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
              'content-type': SupportedMimeType.JSON,
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
            'content-type': SupportedMimeType.JSON,
            Authorization: 'Bearer realm-server-token',
          },
        });
      } else if (request.url === 'https://realms.example.test/_create-realm') {
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer realm-server-token',
        );
        let body = (await request.json()) as {
          data: {
            type: string;
            attributes: {
              endpoint: string;
              name: string;
              iconURL: string;
              backgroundURL: string;
            };
          };
        };
        assert.strictEqual(body.data.attributes.endpoint, 'personal');
        assert.strictEqual(body.data.attributes.name, 'personal');
        assert.strictEqual(
          body.data.attributes.iconURL,
          'https://boxel-images.boxel.ai/icons/Letter-p.png',
        );
        assert.true(
          body.data.attributes.backgroundURL.startsWith(
            'https://boxel-images.boxel.ai/background-images/',
          ),
        );
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
              'content-type': SupportedMimeType.JSON,
            },
          },
        );
      } else if (request.url === accountDataUrl && request.method === 'GET') {
        // Return empty account data (no realms yet)
        response = new Response(JSON.stringify({ realms: [] }), {
          status: 200,
          headers: { 'content-type': SupportedMimeType.JSON },
        });
      } else if (request.url === accountDataUrl && request.method === 'PUT') {
        let body = (await request.json()) as { realms: string[] };
        assert.deepEqual(body.realms, [targetRealmUrl]);
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer matrix-access-token',
        );
        response = new Response('{}', { status: 200 });
      } else if (request.url === 'https://realms.example.test/_realm-auth') {
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer realm-server-token',
        );
        response = new Response(
          JSON.stringify({
            [targetRealmUrl]: 'Bearer target-realm-token',
          }),
          {
            status: 200,
            headers: {
              'content-type': SupportedMimeType.JSON,
            },
          },
        );
      } else if (
        request.url ===
        'https://realms.example.test/hassan/personal/_readiness-check'
      ) {
        assert.strictEqual(
          request.headers.get('Authorization'),
          'Bearer target-realm-token',
        );
        assert.strictEqual(
          request.headers.get('Accept'),
          SupportedMimeType.JSONAPI,
        );
        response = new Response(null, {
          status: 200,
          headers: {
            'content-type': 'text/html',
          },
        });
      } else {
        throw new Error(`Unexpected url: ${request.method} ${request.url}`);
      }

      return response;
    }) as typeof globalThis.fetch;

    let result = await bootstrapFactoryTargetRealm(resolution);

    assert.true(result.createdRealm);
    assert.strictEqual(result.authorization, 'Bearer target-realm-token');
  });

  test('bootstrapFactoryTargetRealm does not surface non-serialized response objects as [object Object]', async function (assert) {
    assert.expect(2);

    process.env.MATRIX_URL = 'https://matrix.example.test/';
    process.env.MATRIX_USERNAME = 'hassan';
    process.env.MATRIX_PASSWORD = 'secret';
    process.env.REALM_SERVER_URL = 'https://realms.example.test/';

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    globalThis.fetch = (async (input, init) => {
      let request = new Request(input, init);

      if (
        request.url === 'https://matrix.example.test/_matrix/client/v3/login'
      ) {
        return new Response(
          JSON.stringify({
            access_token: 'matrix-access-token',
            device_id: 'device-id',
            user_id: '@hassan:localhost',
          }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSON },
          },
        );
      }

      if (
        request.url ===
        'https://matrix.example.test/_matrix/client/v3/user/%40hassan%3Alocalhost/openid/request_token'
      ) {
        return new Response(
          JSON.stringify({
            access_token: 'openid-token',
            expires_in: 300,
            matrix_server_name: 'localhost',
            token_type: 'Bearer',
          }),
          {
            status: 200,
            headers: { 'content-type': SupportedMimeType.JSON },
          },
        );
      }

      if (request.url === 'https://realms.example.test/_server-session') {
        return new Response('{}', {
          status: 200,
          headers: {
            'content-type': SupportedMimeType.JSON,
            Authorization: 'Bearer realm-server-token',
          },
        });
      }

      if (request.url === 'https://realms.example.test/_create-realm') {
        return new Response({ errors: ['boom'] } as unknown as BodyInit, {
          status: 500,
        });
      }

      throw new Error(`Unexpected url: ${request.method} ${request.url}`);
    }) as typeof globalThis.fetch;

    await assert.rejects(
      bootstrapFactoryTargetRealm(resolution),
      (error: unknown) => {
        assert.false(String(error).includes('[object Object]'));
        return (
          error instanceof Error &&
          error.message.includes('server returned a non-serialized object body')
        );
      },
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
