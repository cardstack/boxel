import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import GetDefaultWritableRealmCommand from '@cardstack/host/commands/get-default-writable-realm';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  setupRealmServerEndpoints,
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

module('Integration | commands | get-default-writable-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
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

  test('returns realm path when a default writable realm exists', async function (assert) {
    let commandService = getService('command-service');
    let command = new GetDefaultWritableRealmCommand(
      commandService.commandContext,
    );
    let result = await command.execute();
    assert.strictEqual(result.realmIdentifier, testRealmURL);
  });

  test('returns empty string when no default writable realm exists', async function (assert) {
    let realmService = getService('realm') as RealmService;
    Object.defineProperty(realmService, 'defaultWritableRealm', {
      get() {
        return null;
      },
      configurable: true,
    });
    let commandService = getService('command-service');
    let command = new GetDefaultWritableRealmCommand(
      commandService.commandContext,
    );
    let result = await command.execute();
    assert.strictEqual(result.realmIdentifier, '');
  });
});
