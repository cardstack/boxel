import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { localId } from '@cardstack/runtime-common';

import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
} from '../../helpers';
import { CardDef } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let store: StoreService;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | switch-submode', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let snapshot = setupSnapshotRealm<{ store: StoreService }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
        loader,
      });
      return { store: getService('store') as StoreService };
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    ({ store } = snapshot.get());
  });

  test('switch to code submode by local id of a saved instance', async function (assert) {
    let instance = (await store.add(new CardDef())) as CardDefType;
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[{ id: instance[localId], format: 'isolated' }]],
      submode: 'interact',
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    await switchSubmodeCommand.execute({
      submode: 'code',
    });
    assert.strictEqual(operatorModeStateService.state?.submode, 'code');
    assert.strictEqual(
      operatorModeStateService.state?.codePath?.href,
      `${instance.id}.json`,
    );
  });

  test('switch to code submode by remote id of a saved instance', async function (assert) {
    let instance = await store.add(new CardDef());
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[{ id: instance.id!, format: 'isolated' }]],
      submode: 'interact',
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    await switchSubmodeCommand.execute({
      submode: 'code',
    });
    assert.strictEqual(operatorModeStateService.state?.submode, 'code');
    assert.strictEqual(
      operatorModeStateService.state?.codePath?.href,
      `${instance.id}.json`,
    );
  });

  test('when workspace chooser is open, close it when switching', async function (assert) {
    let instance = (await store.add(new CardDef())) as CardDefType;
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[{ id: instance[localId], format: 'isolated' }]],
      submode: 'interact',
      workspaceChooserOpened: true,
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    assert.true(operatorModeStateService.workspaceChooserOpened);
    await switchSubmodeCommand.execute({
      submode: 'code',
    });
    assert.strictEqual(operatorModeStateService.state?.submode, 'code');
    assert.false(
      operatorModeStateService.workspaceChooserOpened,
      'Workspace chooser should be closed after switching submode',
    );
  });
});
