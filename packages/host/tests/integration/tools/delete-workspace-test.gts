import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';
import DeleteWorkspaceTool from '@cardstack/host/tools/delete-workspace';

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

module('Integration | tools | delete-workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  let deleteRealmCalls: string[];
  hooks.beforeEach(async function () {
    deleteRealmCalls = [];
    let realmServer = getService('realm-server') as RealmServerService;
    realmServer.deleteRealm = async (realmURL) => {
      deleteRealmCalls.push(realmURL);
    };
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
      }),
    );
  });

  test('deletes an owned workspace and drops it from the realm list', async function (assert) {
    let toolService = getService('tool-service');
    let realmServer = getService('realm-server') as RealmServerService;
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      submode: 'interact',
    });
    assert.true(realmServer.userRealmIdentifiers.includes(ri(testRealmURL)));

    let tool = new DeleteWorkspaceTool(toolService.toolContext);
    await tool.execute({
      realmIdentifier: testRealmURL.replace(/\/$/, ''),
    });

    assert.deepEqual(deleteRealmCalls, [testRealmURL]);
    assert.false(
      realmServer.userRealmIdentifiers.includes(ri(testRealmURL)),
      'the deleted workspace leaves the realm list the chooser renders',
    );
    assert.strictEqual(
      operatorModeStateService.state?.stacks.length,
      0,
      'stacks showing the deleted workspace are cleared',
    );
    assert.true(
      operatorModeStateService.state?.workspaceChooserOpened,
      'the app falls back to the workspace chooser',
    );
  });

  test('refuses to delete a workspace the user does not own', async function (assert) {
    let toolService = getService('tool-service');
    let realmService = getService('realm');
    realmService.isRealmOwner = () => false;
    let tool = new DeleteWorkspaceTool(toolService.toolContext);

    await assert.rejects(
      tool.execute({ realmIdentifier: testRealmURL }),
      /not its owner/,
    );
    assert.deepEqual(deleteRealmCalls, [], 'nothing is deleted');
  });
});
