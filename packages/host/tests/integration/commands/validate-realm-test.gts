import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ValidateRealmCommand from '@cardstack/host/commands/validate-realm';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
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

class StubRealmServerService extends Service {
  availableRealmURLs = [testRealmURL];
  async fetchCatalogRealms() {}
  setClient() {}
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

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    getOwner(this)!.register('service:realm-server', StubRealmServerService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  test('returns normalized realm URL for a valid realm', async function (assert) {
    let commandService = getService('command-service');
    let command = new ValidateRealmCommand(commandService.commandContext);
    let result = await command.execute({ realmUrl: testRealmURL });
    assert.strictEqual(result.realmUrl, testRealmURL);
  });

  test('throws error for an invalid realm URL', async function (assert) {
    let commandService = getService('command-service');
    let command = new ValidateRealmCommand(commandService.commandContext);
    try {
      await command.execute({ realmUrl: 'https://invalid.example.com/realm/' });
      assert.ok(false, 'should have thrown');
    } catch (e: any) {
      assert.ok(
        e.message.includes('Invalid realm'),
        `Error message includes "Invalid realm": ${e.message}`,
      );
    }
  });
});
