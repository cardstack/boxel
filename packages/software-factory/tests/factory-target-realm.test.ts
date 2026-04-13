import { module, test } from 'qunit';

import type { ActiveProfileSummary } from '@cardstack/boxel-cli';

import { FactoryEntrypointUsageError } from '../src/factory-entrypoint-errors';
import {
  bootstrapFactoryTargetRealm,
  resolveFactoryTargetRealm,
  type FactoryTargetRealmBootstrapResult,
  type FactoryTargetRealmResolution,
} from '../src/factory-target-realm';

const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

function makeActiveProfile(
  overrides: Partial<ActiveProfileSummary> = {},
): ActiveProfileSummary {
  return {
    matrixId: '@hassan:example.test',
    username: 'hassan',
    matrixUrl: 'https://matrix.example.test/',
    realmServerUrl: 'https://realms.example.test/',
    ...overrides,
  };
}

module('factory-target-realm', function () {
  module('resolveFactoryTargetRealm', function () {
    test('uses the active profile username and explicit target URL', function (assert) {
      let resolution = resolveFactoryTargetRealm({
        targetRealmUrl,
        realmServerUrl: null,
        activeProfile: makeActiveProfile(),
      });

      assert.strictEqual(resolution.url, targetRealmUrl);
      assert.strictEqual(resolution.serverUrl, 'https://realms.example.test/');
      assert.strictEqual(resolution.ownerUsername, 'hassan');
    });

    test('accepts an explicit realm server URL override', function (assert) {
      let resolution = resolveFactoryTargetRealm({
        targetRealmUrl: 'https://other-realm-server.test/hassan/personal/',
        realmServerUrl: 'https://other-realm-server.test/',
        activeProfile: makeActiveProfile({
          realmServerUrl: 'https://other-realm-server.test/',
        }),
      });

      assert.strictEqual(
        resolution.serverUrl,
        'https://other-realm-server.test/',
      );
    });

    test('throws when --target-realm-url is missing', function (assert) {
      assert.throws(
        () =>
          resolveFactoryTargetRealm({
            targetRealmUrl: null,
            realmServerUrl: null,
            activeProfile: makeActiveProfile(),
          }),
        (error: unknown) =>
          error instanceof FactoryEntrypointUsageError &&
          /target-realm-url/.test(error.message),
      );
    });
  });

  module('bootstrapFactoryTargetRealm', function () {
    test('delegates to the injected createRealm action and returns its result', async function (assert) {
      let resolution: FactoryTargetRealmResolution = {
        url: targetRealmUrl,
        serverUrl: 'https://realms.example.test/',
        ownerUsername: 'hassan',
      };
      let createCalls: FactoryTargetRealmResolution[] = [];

      let result = await bootstrapFactoryTargetRealm(resolution, {
        createRealm: async (r) => {
          createCalls.push(r);
          return { ...r, createdRealm: true };
        },
      });

      assert.strictEqual(createCalls.length, 1);
      assert.deepEqual(createCalls[0], resolution);
      assert.true(result.createdRealm);
      assert.strictEqual(result.url, targetRealmUrl);
    });

    test('passes through createdRealm: false from the action (idempotent path)', async function (assert) {
      let resolution: FactoryTargetRealmResolution = {
        url: targetRealmUrl,
        serverUrl: 'https://realms.example.test/',
        ownerUsername: 'hassan',
      };

      let result: FactoryTargetRealmBootstrapResult =
        await bootstrapFactoryTargetRealm(resolution, {
          createRealm: async (r) => ({ ...r, createdRealm: false }),
        });

      assert.false(result.createdRealm);
    });
  });
});
