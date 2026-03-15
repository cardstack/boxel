import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import OpenCreateListingModalCommand from '@cardstack/host/commands/open-create-listing-modal';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | open-create-listing-modal', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
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

  test('stores modal request in operator mode state', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardId: `${testRealmURL}Pet/mango`,
    } as never);

    assert.deepEqual(operatorModeStateService.createListingModalRequest, {
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardId: `${testRealmURL}Pet/mango`,
    });
  });

  test('stores modal request without openCardId', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
    } as never);

    let request = operatorModeStateService.createListingModalRequest;
    assert.deepEqual(request?.codeRef, {
      module: `${testRealmURL}pet`,
      name: 'Pet',
    });
    assert.strictEqual(request?.targetRealm, testRealmURL);
    assert.strictEqual(
      request?.openCardId,
      undefined,
      'openCardId is absent from state',
    );
  });

  test('closeCreateListingModal clears the request', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardId: `${testRealmURL}Pet/mango`,
    } as never);

    assert.ok(
      operatorModeStateService.createListingModalRequest,
      'request is set after execute',
    );

    operatorModeStateService.closeCreateListingModal();

    assert.strictEqual(
      operatorModeStateService.createListingModalRequest,
      undefined,
      'request is cleared after closeCreateListingModal',
    );
  });
});
