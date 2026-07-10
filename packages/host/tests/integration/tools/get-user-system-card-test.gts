import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import GetUserSystemCardTool from '@cardstack/host/tools/get-user-system-card';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm, SystemCard } from '../../helpers/base-realm';
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

module('Integration | tools | get-user-system-card', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
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

  test('returns undefined cardId when no system card is set', async function (assert) {
    let toolService = getService('tool-service');
    let command = new GetUserSystemCardTool(toolService.toolContext);

    let result = await command.execute();
    assert.strictEqual(
      result.cardId,
      undefined,
      'cardId should be undefined when no system card is set',
    );
    assert.true(
      result.isDefault,
      'isDefault should be true when no system card is set',
    );
  });

  test('returns the active system card ID when one is set', async function (assert) {
    let systemCardId = `${testRealmURL}SystemCard/my-system-card`;

    // Set the system card on the matrix service directly
    let matrixService = getService('matrix-service') as any;
    matrixService._systemCard = new SystemCard({ id: systemCardId });

    let toolService = getService('tool-service');
    let command = new GetUserSystemCardTool(toolService.toolContext);

    let result = await command.execute();
    assert.strictEqual(result.cardId, systemCardId);
    assert.false(
      result.isDefault,
      'isDefault should be false when a non-default system card is set',
    );
  });
});
