import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { localId } from '@cardstack/runtime-common';

import OpenWorkspaceCommand from '@cardstack/host/commands/open-workspace';
import RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';

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

module('Integration | commands | open-workspace', function (hooks) {
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
  });
});
