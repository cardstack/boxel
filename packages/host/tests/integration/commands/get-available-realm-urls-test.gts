import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import GetAvailableRealmUrlsCommand from '@cardstack/host/commands/get-available-realm-urls';
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
  availableRealmURLs = [
    'https://example.com/realm-a/',
    'https://example.com/realm-b/',
  ];
  async fetchCatalogRealms() {}
  setClient() {}
}

module('Integration | commands | get-available-realm-urls', function (hooks) {
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

  test('returns the list of available realm URLs', async function (assert) {
    let commandService = getService('command-service');
    let command = new GetAvailableRealmUrlsCommand(
      commandService.commandContext,
    );
    let result = await command.execute();
    assert.deepEqual(result.urls, [
      'https://example.com/realm-a/',
      'https://example.com/realm-b/',
    ]);
  });
});
