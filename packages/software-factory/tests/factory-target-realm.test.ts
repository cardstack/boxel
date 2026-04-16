import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
} from '../src/factory-target-realm';
import { installTestProfile } from './helpers/test-profile';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

module('factory-target-realm', function (hooks) {
  let cleanupProfile: (() => void) | undefined;
  let originalFetch = globalThis.fetch;

  hooks.afterEach(function () {
    cleanupProfile?.();
    cleanupProfile = undefined;
    globalThis.fetch = originalFetch;
  });

  function setupHassanProfile() {
    cleanupProfile = installTestProfile({
      username: 'hassan',
      matrixUrl: 'https://matrix.example.test/',
      realmServerUrl: 'https://realms.example.test/',
      password: 'secret',
    });
  }

  test('resolveFactoryTargetRealm resolves owner from active profile', function (assert) {
    setupHassanProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    assert.strictEqual(resolution.url, targetRealmUrl);
    assert.strictEqual(
      resolution.serverUrl,
      'https://realms.example.test/',
      'defaults to active profile realmServerUrl when --realm-server-url is not provided',
    );
    assert.strictEqual(resolution.ownerUsername, 'hassan');
  });

  test('resolveFactoryTargetRealm accepts an explicit realm server URL override', function (assert) {
    setupHassanProfile();

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
    setupHassanProfile();

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

  test('resolveFactoryTargetRealm rejects when no active profile is configured', function (assert) {
    cleanupProfile = installTestProfile({
      username: 'nobody',
      matrixUrl: 'https://matrix.example.test/',
      realmServerUrl: 'https://realms.example.test/',
      password: 'secret',
    });
    // Overwrite with an empty profiles file to simulate no profile
    let { writeFileSync } = require('node:fs');
    let { join } = require('node:path');
    writeFileSync(
      join(process.env.HOME!, '.boxel-cli', 'profiles.json'),
      JSON.stringify({ profiles: {}, activeProfile: null }),
    );

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealmUrl,
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        (error.message.includes('boxel profile add') ||
          error.message.includes('active Boxel profile')),
    );
  });

  test('bootstrapFactoryTargetRealm creates the realm through the API', async function (assert) {
    setupHassanProfile();

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
    setupHassanProfile();

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
    setupHassanProfile();

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

    setupHassanProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: 'https://realms.example.test/',
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

    setupHassanProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: 'https://realms.example.test/',
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
