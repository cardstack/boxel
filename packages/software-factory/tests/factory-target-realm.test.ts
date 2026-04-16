import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { module, test } from 'qunit';

import { resetProfileManager } from '@cardstack/boxel-cli/api';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
} from '../src/factory-target-realm';
import { installTestProfile } from './helpers/test-profile';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

module('factory-target-realm', function (hooks) {
  let cleanupProfile: (() => void) | undefined;

  hooks.afterEach(function () {
    cleanupProfile?.();
    cleanupProfile = undefined;
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

  test('resolveFactoryTargetRealm rejects when target realm origin does not match profile', function (assert) {
    // Profile points to staging, but target realm is localhost
    cleanupProfile = installTestProfile({
      username: 'hassan',
      matrixUrl: 'https://matrix-staging.stack.cards/',
      realmServerUrl: 'https://realms-staging.stack.cards/',
      password: 'secret',
    });

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealmUrl: 'http://localhost:4201/hassan/my-realm/',
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message.includes('does not match the realm server') &&
        error.message.includes('boxel profile switch'),
    );
  });

  test('resolveFactoryTargetRealm rejects when no active profile is configured', function (assert) {
    let profilesFile = join(homedir(), '.boxel-cli', 'profiles.json');
    let backup = existsSync(profilesFile)
      ? readFileSync(profilesFile, 'utf8')
      : undefined;

    try {
      writeFileSync(
        profilesFile,
        JSON.stringify({ profiles: {}, activeProfile: null }),
      );
      resetProfileManager();

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
    } finally {
      if (backup !== undefined) {
        writeFileSync(profilesFile, backup);
      }
      resetProfileManager();
    }
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
});
