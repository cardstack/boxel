import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ri } from '@cardstack/runtime-common';

import SanitizeModuleListCommand from '@cardstack/host/commands/sanitize-module-list';
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

let readableRealms: Set<string>;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
  realmOf = (input: URL | string) => {
    let str = input instanceof URL ? input.href : input;
    for (const realm of readableRealms) {
      if (str.startsWith(realm)) {
        return ri(realm);
      }
    }
    return undefined;
  };
  canRead = (url: string): boolean => {
    return readableRealms.has(url);
  };
}

module('Integration | commands | sanitize-module-list', function (hooks) {
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
    readableRealms = new Set([testRealmURL]);
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

  test('filters out global URLs and keeps realm modules', async function (assert) {
    let commandService = getService('command-service');
    let command = new SanitizeModuleListCommand(commandService.commandContext);
    let result = await command.execute({
      moduleIdentifiers: [
        `${testRealmURL}my-module.gts`,
        'https://cardstack.com/base/card-api',
        'https://packages/some-pkg',
        'https://boxel-icons.boxel.ai/icons/star',
      ],
    });
    assert.deepEqual(result.moduleIdentifiers, [
      `${testRealmURL}my-module.gts`,
    ]);
  });

  test('deduplicates modules by normalized URL', async function (assert) {
    let commandService = getService('command-service');
    let command = new SanitizeModuleListCommand(commandService.commandContext);
    let result = await command.execute({
      moduleIdentifiers: [
        `${testRealmURL}my-module.gts`,
        `${testRealmURL}my-module`,
      ],
    });
    assert.strictEqual(result.moduleIdentifiers.length, 1);
    assert.strictEqual(
      result.moduleIdentifiers[0],
      `${testRealmURL}my-module.gts`,
    );
  });

  test('excludes modules from unreadable realms', async function (assert) {
    readableRealms = new Set([testRealmURL]);
    let commandService = getService('command-service');
    let command = new SanitizeModuleListCommand(commandService.commandContext);
    let result = await command.execute({
      moduleIdentifiers: [
        `${testRealmURL}my-module.gts`,
        'https://other-realm.example.com/module.gts',
      ],
    });
    assert.deepEqual(result.moduleIdentifiers, [
      `${testRealmURL}my-module.gts`,
    ]);
  });
});
