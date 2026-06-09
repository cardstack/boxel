import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import GetPublishedRealmsCommand from '@cardstack/host/commands/get-published-realms';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The command reads RealmService.info(realmURL).lastPublishedAt; the stub lets
// each test control that value. (The real value is sourced from realm_registry
// via the realm's _info, which is empty in the integration harness.)
let lastPublishedAtFixture: string | Record<string, string> | null;

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }

  async ensureRealmMeta() {}

  info = (_url: string) =>
    ({
      ...testRealmInfo,
      isIndexing: false,
      isPublic: false,
      lastPublishedAt: lastPublishedAtFixture,
    }) as ReturnType<RealmService['info']>;
}

module('Integration | commands | get-published-realms', function (hooks) {
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
    lastPublishedAtFixture = null;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  function makeCommand() {
    let commandService = getService('command-service');
    return new GetPublishedRealmsCommand(commandService.commandContext);
  }

  test('returns each published destination from the lastPublishedAt map', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    lastPublishedAtFixture = {
      'https://mike.boxel.space/game-mechanics/': '1700000000000',
      'https://mysite.boxel.site/': '1700000005000',
    };

    let result = await makeCommand().execute({ realmURL });

    assert.deepEqual(
      result.results.map((r) => [r.publishedRealmURL, r.lastPublishedAt]),
      [
        ['https://mike.boxel.space/game-mechanics/', '1700000000000'],
        ['https://mysite.boxel.site/', '1700000005000'],
      ],
    );
  });

  test('returns an empty list when the realm has never been published', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    lastPublishedAtFixture = null;

    let result = await makeCommand().execute({ realmURL });

    assert.strictEqual(result.results.length, 0);
  });

  test('returns an empty list when lastPublishedAt is a plain string', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    lastPublishedAtFixture = '1700000000000';

    let result = await makeCommand().execute({ realmURL });

    assert.strictEqual(result.results.length, 0);
  });

  test('keeps a published destination whose timestamp is missing, coerced to a string', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    lastPublishedAtFixture = {
      'https://mysite.boxel.site/': null as unknown as string,
    };

    let result = await makeCommand().execute({ realmURL });

    assert.deepEqual(
      result.results.map((r) => [r.publishedRealmURL, r.lastPublishedAt]),
      [['https://mysite.boxel.site/', '']],
    );
  });
});
