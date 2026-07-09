import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ValidateRealmCommand from '@cardstack/host/tools/validate-realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
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

module('Integration | commands | validate-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
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
    let commandService = getService('command-service');
    let command = new ValidateRealmCommand(commandService.commandContext);
    let result = await command.execute({ realmIdentifier: testRealmURL });
    assert.strictEqual(result.realmIdentifier, testRealmURL);
  });

  test('throws error for an invalid realm URL', async function (assert) {
    let commandService = getService('command-service');
    let command = new ValidateRealmCommand(commandService.commandContext);
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
    }
  });
});
