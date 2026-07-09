import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import CanReadRealmCommand from '@cardstack/host/tools/can-read-realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  setupRealmServerEndpoints,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let readableUrls: string[];

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | commands | can-read-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupRealmServerEndpoints(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
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

  hooks.beforeEach(function () {
    let realmService = getService('realm') as RealmService;
    realmService.canRead = (url: string): boolean => {
      return readableUrls.includes(url);
    };
  });

  test('returns true for a readable realm', async function (assert) {
    readableUrls = ['https://example.com/readable/'];
    let commandService = getService('command-service');
    let command = new CanReadRealmCommand(commandService.commandContext);
    let result = await command.execute({
      realmIdentifier: 'https://example.com/readable/',
    });
    assert.true(result.canRead);
  });

  test('returns false for an unreadable realm', async function (assert) {
    readableUrls = [];
    let commandService = getService('command-service');
    let command = new CanReadRealmCommand(commandService.commandContext);
    let result = await command.execute({
      realmIdentifier: 'https://example.com/private/',
    });
    assert.false(result.canRead);
  });
});
