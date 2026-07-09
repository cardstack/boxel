import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CardService from '@cardstack/host/services/card-service';
import RealmService from '@cardstack/host/services/realm';
import ExecuteAtomicOperationsTool from '@cardstack/host/tools/execute-atomic-operations';

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

let mockAtomicResponse: Record<string, any>;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

class StubCardService extends CardService {
  override async executeAtomicOperations(_operations: any[], _realmUrl: URL) {
    return mockAtomicResponse;
  }
}

module('Integration | commands | execute-atomic-operations', function (hooks) {
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
    getOwner(this)!.register('service:card-service', StubCardService);
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

  test('returns results from successful atomic operations', async function (assert) {
    mockAtomicResponse = {
      'atomic:results': [{ id: 'card-1' }, { id: 'card-2' }],
    };
    let toolService = getService('tool-service');
    let command = new ExecuteAtomicOperationsTool(toolService.commandContext);
    let result = await command.execute({
      realmIdentifier: testRealmURL,
      operations: [{ op: 'add', path: 'card-1' }] as any,
    });
    assert.deepEqual(result.results, [{ id: 'card-1' }, { id: 'card-2' }]);
  });

  test('throws error when atomic operations fail', async function (assert) {
    mockAtomicResponse = {
      errors: [{ detail: 'Something went wrong' }],
    };
    let toolService = getService('tool-service');
    let command = new ExecuteAtomicOperationsTool(toolService.commandContext);
    try {
      await command.execute({
        realmIdentifier: testRealmURL,
        operations: [{ op: 'add', path: 'card-1' }] as any,
      });
      assert.ok(false, 'should have thrown');
    } catch (e: any) {
      assert.strictEqual(e.message, 'Something went wrong');
    }
  });
});
