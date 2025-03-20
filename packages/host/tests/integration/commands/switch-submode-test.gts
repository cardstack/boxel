import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import SwitchSubmodeCommand from '@cardstack/host/commands/switch-submode';
import type CommandService from '@cardstack/host/services/command-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  lookupLoaderService,
  lookupService,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

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
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = lookupLoaderService().loader;
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {},
    });
  });

  test('switch to code submode', async function (assert) {
    let commandService = lookupService<CommandService>('command-service');
    let operatorModeStateService = lookupService<OperatorModeStateService>(
      'operator-mode-state-service',
    );
    let switchSubmodeCommand = new SwitchSubmodeCommand(
      commandService.commandContext,
    );
    assert.strictEqual(operatorModeStateService.state?.submode, 'interact');
    await switchSubmodeCommand.execute({
      submode: 'code',
    });
    assert.strictEqual(operatorModeStateService.state?.submode, 'code');
  });
});
