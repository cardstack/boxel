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

  test('stores modal payload in operator mode state', async function (assert) {
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
      openCardIds: [`${testRealmURL}Pet/mango`],
    } as never);

    assert.deepEqual(operatorModeStateService.createListingModalPayload, {
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
    });
  });

  test('stores modal payload without openCardIds', async function (assert) {
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

    let payload = operatorModeStateService.createListingModalPayload;
    assert.deepEqual(payload?.codeRef, {
      module: `${testRealmURL}pet`,
      name: 'Pet',
    });
    assert.strictEqual(payload?.targetRealm, testRealmURL);
    assert.deepEqual(
      payload?.openCardIds,
      [],
      'openCardIds is empty when not provided',
    );
  });

  test('dismissCreateListingModal clears the payload', async function (assert) {
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
      openCardIds: [`${testRealmURL}Pet/mango`],
    } as never);

    assert.ok(
      operatorModeStateService.createListingModalPayload,
      'payload is set after execute',
    );

    operatorModeStateService.dismissCreateListingModal();

    assert.strictEqual(
      operatorModeStateService.createListingModalPayload,
      undefined,
      'payload is cleared after dismissCreateListingModal',
    );
  });
});
