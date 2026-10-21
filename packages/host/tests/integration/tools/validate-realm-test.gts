import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ValidateRealmTool from '@cardstack/host/tools/validate-realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | tools | validate-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  test('returns normalized realm URL for a valid realm', async function (assert) {
    let toolService = getService('tool-service');
    let command = new ValidateRealmTool(toolService.toolContext);
    let result = await command.execute({ realmIdentifier: testRealmURL });
    assert.strictEqual(result.realmIdentifier, testRealmURL);
  });

  test('accepts a realm by its prefix and by its URL', async function (assert) {
    let { virtualNetwork } = getService('network');
    let testRealmPrefix = '@test/validate-realm/';
    virtualNetwork.addRealmMapping(testRealmPrefix, testRealmURL);
    try {
      let toolService = getService('tool-service');
      let command = new ValidateRealmTool(toolService.toolContext);
      for (let realmIdentifier of [testRealmPrefix, testRealmURL]) {
        let result = await command.execute({ realmIdentifier });
        assert.strictEqual(
          result.realmIdentifier,
          testRealmURL,
          `${realmIdentifier} returns the realm as the realm server lists it`,
        );
      }
    } finally {
      virtualNetwork.removeRealmMapping(testRealmPrefix);
    }
  });

  test('throws error for an invalid realm URL', async function (assert) {
    let toolService = getService('tool-service');
    let command = new ValidateRealmTool(toolService.toolContext);
    try {
      await command.execute({
        realmIdentifier: 'https://invalid.example.com/realm/',
      });
      assert.ok(false, 'should have thrown');
    } catch (e: any) {
      assert.ok(
        e.message.includes('Invalid realm'),
        `Error message includes "Invalid realm": ${e.message}`,
      );
      assert.ok(
        e.message.includes(`Valid realms: `),
        `Error message lists the valid realms: ${e.message}`,
      );
      assert.ok(
        e.message.includes(testRealmURL),
        `The list names the available realm: ${e.message}`,
      );
    }
  });
});
