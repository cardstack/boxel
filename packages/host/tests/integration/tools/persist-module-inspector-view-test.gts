import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import PersistModuleInspectorViewTool from '@cardstack/host/tools/persist-module-inspector-view';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let persistedCalls: Array<{ codePath: string; view: string }>;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

class StubOperatorModeStateService extends Service {
  persistModuleInspectorView(codePath: string, view: string) {
    persistedCalls.push({ codePath, view });
  }
}

module('Integration | tools | persist-module-inspector-view', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    persistedCalls = [];
    getOwner(this)!.register('service:realm', StubRealmService);
    getOwner(this)!.register(
      'service:operator-mode-state-service',
      StubOperatorModeStateService,
    );
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

  test('persists the module inspector view selection', async function (assert) {
    let toolService = getService('tool-service');
    let command = new PersistModuleInspectorViewTool(toolService.toolContext);
    let result = await command.execute({
      codePath: `${testRealmURL}my-module.gts`,
      moduleInspectorView: 'schema',
    });
    assert.strictEqual(result, undefined);
    assert.strictEqual(persistedCalls.length, 1);
    assert.strictEqual(
      persistedCalls[0].codePath,
      `${testRealmURL}my-module.gts`,
    );
    assert.strictEqual(persistedCalls[0].view, 'schema');
  });
});
