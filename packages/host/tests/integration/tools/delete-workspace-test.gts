import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import DeleteWorkspaceTool from '@cardstack/host/tools/delete-workspace';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | delete-workspace', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  let deleteRealmCalls: string[];
  hooks.beforeEach(async function () {
    deleteRealmCalls = [];
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        permissions: {
          '@testuser:localhost': ['read', 'write', 'realm-owner'],
        },
      }),
    );
    let realmServer = getService('realm-server') as RealmServerService;
    realmServer.deleteRealm = async (realmURL) => {
      deleteRealmCalls.push(realmURL);
    };
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

  test('cleans up the published copies the realm server deletes along with the workspace', async function (assert) {
    let toolService = getService('tool-service');
    let realmService = getService('realm') as RealmService;
    let recentFilesService = getService('recent-files-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    let publishedRealmURL = 'https://team.boxel.site/';
    let originalInfo = realmService.info;
    realmService.info = ((url: string) => ({
      ...originalInfo(url),
      lastPublishedAt: { [publishedRealmURL]: '1700000000000' },
    })) as RealmService['info'];
    recentFilesService.recentFiles.push(
      {
        realmURL: new URL(publishedRealmURL),
        filePath: 'index.json',
        cursorPosition: null,
        timestamp: 2,
      },
      {
        realmURL: new URL('https://other.boxel.site/'),
        filePath: 'index.json',
        cursorPosition: null,
        timestamp: 1,
      },
    );
    // The user is viewing the published copy, not the source workspace.
    operatorModeStateService.restore({
      stacks: [[{ id: `${publishedRealmURL}index`, format: 'isolated' }]],
      submode: 'interact',
    });

    let tool = new DeleteWorkspaceTool(toolService.toolContext);
    await tool.execute({ realmIdentifier: testRealmURL });

    assert.deepEqual(deleteRealmCalls, [testRealmURL]);
    assert.deepEqual(
      recentFilesService.recentFiles.map((file) => file.realmURL.href),
      ['https://other.boxel.site/'],
      'recent files of the published copy are removed too',
    );
    assert.strictEqual(
      operatorModeStateService.state?.stacks.length,
      0,
      'stacks showing the deleted published copy are cleared',
    );
    assert.true(
      operatorModeStateService.state?.workspaceChooserOpened,
      'the app falls back to the workspace chooser',
    );
  });

  test('always waits for the user before running', function (assert) {
    assert.true(
      DeleteWorkspaceTool.neverAutoExecutes,
      'a realm deletion is never run without a click, whatever the room mode',
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
