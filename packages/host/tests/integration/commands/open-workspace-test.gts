import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import OpenWorkspaceCommand from '@cardstack/host/commands/open-workspace';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | open-workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
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

  hooks.beforeEach(async function () {
    snapshot.get();
  });

  test('opens specified workspace in interact submode', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [],
      submode: 'interact',
      workspaceChooserOpened: true,
    });
    let openWorkspaceCommand = new OpenWorkspaceCommand(
      commandService.commandContext,
    );
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    await openWorkspaceCommand.execute({
      realmUrl: testRealmURL,
    });
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    assert.strictEqual(operatorModeStateService.state?.stacks.length, 1);
    assert.strictEqual(operatorModeStateService.state?.stacks[0].length, 1);
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0][0].id,
      `${testRealmURL}index`,
    );
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0][0].format,
      'isolated',
    );

    // We logged a case where the realm URL given by the AI assistant was missing a trailing slash.
    // This test ensures that we handle that case correctly.
    let realmUrlWithTrailingSlash = testRealmURL;
    let realmUrlWithoutTrailingSlash = testRealmURL.replace(/\/$/, '');
    await openWorkspaceCommand.execute({
      realmUrl: realmUrlWithoutTrailingSlash,
    });
    assert.strictEqual(
      operatorModeStateService.state?.stacks[0][0].id,
      `${realmUrlWithTrailingSlash}index`,
    );
  });
});
