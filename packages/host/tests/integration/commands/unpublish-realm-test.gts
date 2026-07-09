import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';
import UnpublishRealmCommand from '@cardstack/host/tools/unpublish-realm';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

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

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

let unpublishShouldFail: boolean;
let unpublishedURLs: string[];
let loader: Loader;
let PublishTarget: typeof BaseCommandModule.PublishTarget;

module('Integration | commands | unpublish-realm', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks, [
    {
      route: '_unpublish-realm',
      getResponse: async (req: Request) => {
        let body = (await req.json()) as { publishedRealmURL: string };
        unpublishedURLs.push(body.publishedRealmURL);
        if (unpublishShouldFail) {
          return new Response('boom', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            data: {
              type: 'published-realm',
              attributes: { publishedRealmURL: body.publishedRealmURL },
            },
          }),
          { status: 200 },
        );
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = getService('loader-service').loader;
    PublishTarget = (
      await loader.import<typeof BaseCommandModule>(`${baseRealm.url}command`)
    ).PublishTarget;
    unpublishShouldFail = false;
    unpublishedURLs = [];

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  function makeCommand() {
    let toolService = getService('tool-service');
    return new UnpublishRealmCommand(toolService.commandContext);
  }

  test('unpublishes an explicit published-realm URL', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await makeCommand().execute({
      realmURL,
      publishedRealmURL: 'https://mysite.example.com/',
    });

    assert.deepEqual(unpublishedURLs, ['https://mysite.example.com/']);
    assert.strictEqual(result.publishedRealmURL, 'https://mysite.example.com/');
    assert.strictEqual(result.status, 'unpublished');
  });

  test('resolves a typed subdirectory target before unpublishing', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await makeCommand().execute({
      realmURL,
      target: new PublishTarget({ type: 'subdirectory', name: 'my-space' }),
    });

    assert.strictEqual(unpublishedURLs.length, 1);
    assert.ok(
      /^https:\/\/testuser\..+\/my-space\/$/.test(unpublishedURLs[0]),
      `resolved subdirectory URL "${unpublishedURLs[0]}"`,
    );
    assert.strictEqual(result.status, 'unpublished');
  });

  test('reports an error when the unpublish request fails', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    unpublishShouldFail = true;

    let result = await makeCommand().execute({
      realmURL,
      publishedRealmURL: 'https://mysite.example.com/',
    });

    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes an error message');
  });

  test('throws when neither target nor publishedRealmURL is provided', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    await assert.rejects(
      makeCommand().execute({ realmURL }),
      /Provide either a `target` or a `publishedRealmURL`/,
    );
    assert.deepEqual(
      unpublishedURLs,
      [],
      'did not call the unpublish endpoint',
    );
  });
});
