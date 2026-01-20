import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { localId } from '@cardstack/runtime-common';

import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { CardDef, setupBaseRealm } from '../../helpers/base-realm';
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
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    store = getService('store');
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });
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

  test('createFile creates a blank file when it does not exist', async function (assert) {
    assert.expect(5);

    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[]],
      submode: 'interact',
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    let fileUrl = `${testRealmURL}new-file.gts`;

    let result = await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: fileUrl,
      createFile: true,
    });

    assert.strictEqual(operatorModeStateService.state?.submode, 'code');
    assert.strictEqual(operatorModeStateService.state?.codePath?.href, fileUrl);
    assert.notOk(result, 'no result card when using requested path');

    let { status, content } = await cardService.getSource(new URL(fileUrl));
    assert.strictEqual(status, 200);
    assert.strictEqual(content, '');
  });

  test('createFile picks a non-conflicting filename when the target exists', async function (assert) {
    assert.expect(6);

    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[]],
      submode: 'interact',
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    let fileUrl = `${testRealmURL}existing-file.gts`;
    let newFileUrl = `${testRealmURL}existing-file-1.gts`;

    await cardService.saveSource(
      new URL(fileUrl),
      'existing content',
      'create-file',
    );

    let result = await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: fileUrl,
      createFile: true,
    });

    assert.ok(result, 'returns a result card with the new filename');
    assert.strictEqual(result?.codePath, newFileUrl);
    assert.strictEqual(result?.requestedCodePath, fileUrl);
    assert.strictEqual(
      operatorModeStateService.state?.codePath?.href,
      newFileUrl,
    );

    let { status, content } = await cardService.getSource(new URL(newFileUrl));
    assert.strictEqual(status, 200);
    assert.strictEqual(content, '');
  });

  test('createFile reuses an existing blank file', async function (assert) {
    assert.expect(5);

    let commandService = getService('command-service');
    let cardService = getService('card-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    operatorModeStateService.restore({
      stacks: [[]],
      submode: 'interact',
    });
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    let fileUrl = `${testRealmURL}empty-file.gts`;

    await cardService.saveSource(new URL(fileUrl), '', 'create-file');

    let result = await switchSubmodeCommand.execute({
      submode: 'code',
      codePath: fileUrl,
      createFile: true,
    });

    assert.strictEqual(operatorModeStateService.state?.codePath?.href, fileUrl);
    assert.notOk(result, 'no result card when using existing blank file');

    let { status, content } = await cardService.getSource(new URL(fileUrl));
    assert.strictEqual(status, 200);
    assert.strictEqual(content, '');

    let nonConflicting = await cardService.getSource(
      new URL(`${testRealmURL}empty-file-1.gts`),
    );
    assert.strictEqual(nonConflicting.status, 404);
  });
});
