import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';
import GetRealmOfResourceIdentifierCommand from '@cardstack/host/tools/get-realm-of-resource-identifier';

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

let realmOfURLMap: Map<string, URL | undefined>;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
  realmOf = (input: URL | string) => {
    let str = input instanceof URL ? input.href : input;
    for (const [prefix, realmUrl] of realmOfURLMap) {
      if (str.startsWith(prefix)) {
        return realmUrl ? ri(realmUrl.href) : undefined;
      }
    }
    return undefined;
  };
}

module(
  'Integration | commands | get-realm-of-resource-identifier',
  function (hooks) {
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

    test('returns the realm identifier containing a given resource', async function (assert) {
      realmOfURLMap = new Map([[testRealmURL, new URL(testRealmURL)]]);
      let toolService = getService('tool-service');
      let command = new GetRealmOfResourceIdentifierCommand(
        toolService.commandContext,
      );
      let result = await command.execute({
        resourceIdentifier: `${testRealmURL}some-card`,
      });
      assert.strictEqual(result.realmIdentifier, testRealmURL);
    });

    test('returns empty string when resource is not in any realm', async function (assert) {
      realmOfURLMap = new Map();
      let toolService = getService('tool-service');
      let command = new GetRealmOfResourceIdentifierCommand(
        toolService.commandContext,
      );
      let result = await command.execute({
        resourceIdentifier: 'https://unknown.example.com/card',
      });
      assert.strictEqual(result.realmIdentifier, '');
    });
  },
);
