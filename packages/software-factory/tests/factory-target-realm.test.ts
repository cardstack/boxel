import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { module, test } from 'qunit';

import {
  setProfileManager,
  resetProfileManager,
} from '@cardstack/boxel-cli/api';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors.ts';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
} from '../src/factory-target-realm.ts';
import { installTestProfile } from './helpers/test-profile.ts';

const targetRealm = 'https://realms.example.test/testuser/personal/';

module('factory-target-realm', function (hooks) {
  let cleanupProfile: (() => void) | undefined;

  hooks.afterEach(function () {
    cleanupProfile?.();
    cleanupProfile = undefined;
  });

  function useTestProfile() {
    cleanupProfile = installTestProfile({
      username: 'testuser',
      matrixUrl: 'https://matrix.example.test/',
      realmServerUrl: 'https://realms.example.test/',
      password: 'secret',
    });
  }

  test('resolveFactoryTargetRealm resolves owner from active profile', function (assert) {
    useTestProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealm,
      realmServerUrl: null,
    });

    assert.strictEqual(resolution.url, targetRealm);
    assert.strictEqual(
      resolution.serverUrl,
      'https://realms.example.test/',
      'defaults to active profile realmServerUrl when --realm-server-url is not provided',
    );
    assert.strictEqual(resolution.ownerUsername, 'testuser');
  });

  test('resolveFactoryTargetRealm accepts an explicit realm server URL override', function (assert) {
    useTestProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealm: 'https://realms.example.test/boxel/testuser/personal/',
      realmServerUrl: 'https://realms.example.test/boxel/',
    });

    assert.strictEqual(
      resolution.serverUrl,
      'https://realms.example.test/boxel/',
    );
  });

  test('resolveFactoryTargetRealm rejects when target realm URL is missing', function (assert) {
    useTestProfile();

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealm: null,
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message === 'Missing required --target-realm',
    );
  });

  test('resolveFactoryTargetRealm rejects when target realm origin does not match profile', function (assert) {
    // Profile points to staging, but target realm is localhost
    cleanupProfile = installTestProfile({
      username: 'testuser',
      matrixUrl: 'https://matrix-staging.stack.cards/',
      realmServerUrl: 'https://realms-staging.stack.cards/',
      password: 'secret',
    });

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealm: 'http://localhost:4201/testuser/my-realm/',
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message.includes('does not match the realm server') &&
        error.message.includes('boxel profile switch'),
    );
  });

  test('resolveFactoryTargetRealm rejects when no active profile is configured', function (assert) {
    // Point the singleton at a temp dir with an empty profiles file
    let tempConfigDir = mkdtempSync(join(tmpdir(), 'boxel-test-empty-'));
    writeFileSync(
      join(tempConfigDir, 'profiles.json'),
      JSON.stringify({ profiles: {}, activeProfile: null }),
    );
    setProfileManager(tempConfigDir);
    cleanupProfile = () => {
      resetProfileManager();
      rmSync(tempConfigDir, { recursive: true, force: true });
    };

    assert.throws(
      () =>
        resolveFactoryTargetRealm({
          targetRealm,
          realmServerUrl: null,
        }),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        (error.message.includes('boxel profile add') ||
          error.message.includes('active Boxel profile')),
    );
  });

  test('bootstrapFactoryTargetRealm creates the realm through the API', async function (assert) {
    useTestProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealm,
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
    useTestProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealm,
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
    useTestProfile();

    let resolution = resolveFactoryTargetRealm({
      targetRealm: 'https://realms.example.test/typed-by-user/personal/',
      realmServerUrl: null,
    });

    let result = await bootstrapFactoryTargetRealm(resolution, {
      createRealm: async () => ({
        createdRealm: true,
        url: 'https://realms.example.test/testuser/personal/',
      }),
    });

    assert.strictEqual(
      result.url,
      'https://realms.example.test/testuser/personal/',
    );
  });
});
