import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import OpenCreatePRModalCommand from '@cardstack/host/commands/open-create-pr-modal';

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

module('Integration | commands | open-create-pr-modal', function (hooks) {
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

    let command = new OpenCreatePRModalCommand(commandService.commandContext);

    await command.execute({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    } as never);

    assert.deepEqual(operatorModeStateService.createPRModalPayload, {
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    });
  });

  test('stores modal payload without listingName', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreatePRModalCommand(commandService.commandContext);

    await command.execute({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
    } as never);

    let payload = operatorModeStateService.createPRModalPayload;
    assert.strictEqual(payload?.realm, testRealmURL);
    assert.strictEqual(payload?.listingId, `${testRealmURL}Listing/1`);
    assert.strictEqual(
      payload?.listingName,
      undefined,
      'listingName is undefined when not provided',
    );
  });

  test('dismissCreatePRModal clears the payload', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreatePRModalCommand(commandService.commandContext);

    await command.execute({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    } as never);

    assert.ok(
      operatorModeStateService.createPRModalPayload,
      'payload is set after execute',
    );

    operatorModeStateService.dismissCreatePRModal();

    assert.strictEqual(
      operatorModeStateService.createPRModalPayload,
      undefined,
      'payload is cleared after dismissCreatePRModal',
    );
  });
});
