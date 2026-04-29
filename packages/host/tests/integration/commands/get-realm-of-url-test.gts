import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import GetRealmOfUrlCommand from '@cardstack/host/commands/get-realm-of-url';
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

let realmOfURLMap: Map<string, URL | undefined>;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
  realmOf = (input: URL | string): URL | undefined => {
    let str = input instanceof URL ? input.href : input;
    for (const [prefix, realmUrl] of realmOfURLMap) {
      if (str.startsWith(prefix)) {
        return realmUrl;
      }
    }
    return undefined;
  };
}

module('Integration | commands | get-realm-of-url', function (hooks) {
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

  test('returns the realm URL containing a given URL', async function (assert) {
    realmOfURLMap = new Map([[testRealmURL, new URL(testRealmURL)]]);
    let commandService = getService('command-service');
    let command = new GetRealmOfUrlCommand(commandService.commandContext);
    let result = await command.execute({
      url: `${testRealmURL}some-card`,
    });
    assert.strictEqual(result.realmUrl, testRealmURL);
  });

  test('returns empty string when URL is not in any realm', async function (assert) {
    realmOfURLMap = new Map();
    let commandService = getService('command-service');
    let command = new GetRealmOfUrlCommand(commandService.commandContext);
    let result = await command.execute({
      url: 'https://unknown.example.com/card',
    });
    assert.strictEqual(result.realmUrl, '');
  });
});
