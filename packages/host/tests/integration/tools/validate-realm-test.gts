import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import ValidateRealmTool from '@cardstack/host/tools/validate-realm';

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

module('Integration | tools | validate-realm', function (hooks) {
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
  });

  test('returns normalized realm URL for a valid realm', async function (assert) {
    let toolService = getService('tool-service');
    let command = new ValidateRealmTool(toolService.toolContext);
    let result = await command.execute({ realmIdentifier: testRealmURL });
    assert.strictEqual(result.realmIdentifier, testRealmURL);
  });

  test('normalizes an equivalent URL spelling of a valid realm', async function (assert) {
    // The input is model-authored, so it can name the right realm in a
    // non-canonical spelling. Parsing canonicalizes those away; without it the
    // membership check compares literally and rejects a realm that exists.
    let toolService = getService('tool-service');
    let command = new ValidateRealmTool(toolService.toolContext);
    let { host, pathname } = new URL(testRealmURL);
    for (let spelling of [
      `http://${host.toUpperCase()}${pathname}`,
      `http://${host}${pathname}sub/../`,
    ]) {
      let result = await command.execute({ realmIdentifier: spelling });
      assert.strictEqual(
        result.realmIdentifier,
        testRealmURL,
        `${spelling} normalizes to the realm it names`,
      );
    }
  });

  test('throws error for an invalid realm URL', async function (assert) {
    let toolService = getService('tool-service');
    let command = new ValidateRealmTool(toolService.toolContext);
    try {
      await command.execute({
        realmIdentifier: 'https://invalid.example.com/realm/',
      });
      assert.ok(false, 'should have thrown');
    } catch (e: any) {
      assert.ok(
        e.message.includes('Invalid realm'),
        `Error message includes "Invalid realm": ${e.message}`,
      );
    }
  });
});
