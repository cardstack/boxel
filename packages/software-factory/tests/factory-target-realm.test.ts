import { module, test } from 'qunit';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
} from '../src/factory-target-realm';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

module('factory-target-realm', function (hooks) {
  let originalMatrixUsername = process.env.MATRIX_USERNAME;

  hooks.afterEach(function () {
    restoreEnv('MATRIX_USERNAME', originalMatrixUsername);
  });

  test('resolveFactoryTargetRealm uses MATRIX_USERNAME and explicit target URL', function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

    let resolution = resolveFactoryTargetRealm({
      targetRealmUrl,
      realmServerUrl: null,
    });

    assert.strictEqual(resolution.url, targetRealmUrl);
    assert.strictEqual(
      resolution.serverUrl,
      'http://localhost:4201/',
      'defaults to localhost when --realm-server-url is not provided',
    );
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

  // NOTE: The full HTTP flow (Matrix login → server token → create-realm →
  // realm-auth → readiness check) is tested in boxel-cli's integration tests.
  // The factory's responsibility is just to delegate to BoxelCLIClient.
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
