import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import GetAvailableRealmIdentifiersTool from '@cardstack/host/tools/get-available-realm-identifiers';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module(
  'Integration | tools | get-available-realm-identifiers',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    setupRealmServerEndpoints(hooks);

    setupRealmCacheTeardown(hooks);

    hooks.beforeEach(async function (this: RenderingTestContext) {
      getOwner(this)!.register('service:realm', StubRealmService);

      await withCachedRealmSetup(async () =>
        setupIntegrationTestRealm({
          mockMatrixUtils,
          realmURL: testRealmURL,
          contents: {},
        }),
      );

      let realmServer = getService('realm-server') as RealmServerService;
      Object.defineProperty(realmServer, 'availableRealmIdentifiers', {
        get: () => [
          'https://example.com/realm-a/',
          'https://example.com/realm-b/',
        ],
        configurable: true,
      });
    });

    test('returns the list of available realm identifiers', async function (assert) {
      let toolService = getService('tool-service');
      let command = new GetAvailableRealmIdentifiersTool(
        toolService.toolContext,
      );
      let result = await command.execute();
      assert.deepEqual(result.realmIdentifiers, [
        'https://example.com/realm-a/',
        'https://example.com/realm-b/',
      ]);
    });
  },
);
