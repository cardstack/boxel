import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import SetUserSystemCardCommand from '@cardstack/host/commands/set-user-system-card';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmInfo,
  testRealmURL,
  setupSnapshotRealm,
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

module('Integration | commands | set-user-system-card', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });
      return {};
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  test('sets the system card account data', async function (assert) {
    let commandService = getService('command-service');
    let command = new SetUserSystemCardCommand(commandService.commandContext);

    let systemCardId = 'http://localhost:4201/catalog/SystemCard/default';

    await command.execute({
      cardId: systemCardId,
    });

    assert.deepEqual(mockMatrixUtils.getSystemCardAccountData(), {
      id: systemCardId,
    });
  });
});
