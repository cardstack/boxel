import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader, localId } from '@cardstack/runtime-common';

import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { CardDef, setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;
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
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = lookupLoaderService().loader;
    store = lookupService<StoreService>('store');
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {},
    });
  });

  test('switch to code submode by local id of a saved instance', async function (assert) {
    let instance = (await store.add(new CardDef())) as CardDefType;
    let commandService = lookupService<CommandService>('command-service');
    let operatorModeStateService = lookupService<OperatorModeStateService>(
      'operator-mode-state-service',
    );
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
    let commandService = lookupService<CommandService>('command-service');
    let operatorModeStateService = lookupService<OperatorModeStateService>(
      'operator-mode-state-service',
    );
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
});
