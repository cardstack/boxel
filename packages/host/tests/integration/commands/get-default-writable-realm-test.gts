import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import GetDefaultWritableRealmCommand from '@cardstack/host/commands/get-default-writable-realm';
import RealmService from '@cardstack/host/services/realm';

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

class StubRealmServiceWithWritable extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
  get defaultWritableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

class StubRealmServiceWithoutWritable extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
  get defaultWritableRealm() {
    return null;
  }
}

module('Integration | commands | get-default-writable-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
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

  test('returns realm path when a default writable realm exists', async function (this: RenderingTestContext, assert) {
    getOwner(this)!.register('service:realm', StubRealmServiceWithWritable);
    let commandService = getService('command-service');
    let command = new GetDefaultWritableRealmCommand(
      commandService.commandContext,
    );
    let result = await command.execute();
    assert.strictEqual(result.realmUrl, testRealmURL);
  });

  test('returns empty string when no default writable realm exists', async function (this: RenderingTestContext, assert) {
    getOwner(this)!.register('service:realm', StubRealmServiceWithoutWritable);
    let commandService = getService('command-service');
    let command = new GetDefaultWritableRealmCommand(
      commandService.commandContext,
    );
    let result = await command.execute();
    assert.strictEqual(result.realmUrl, '');
  });
});
