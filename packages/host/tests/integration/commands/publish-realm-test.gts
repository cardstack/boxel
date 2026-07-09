import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import RealmService from '@cardstack/host/services/realm';
import PublishRealmTool from '@cardstack/host/tools/publish-realm';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

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

// Mutable per-test fixtures controlling the mocked realm-server responses.
let publishabilityResponse: {
  publishable: boolean;
  violations: unknown[];
};
let publishShouldFail: boolean;
let publishabilityRequested: boolean;
let publishedURLs: string[];
let loader: Loader;
let PublishTarget: typeof BaseToolModule.PublishTarget;

module('Integration | commands | publish-realm', function (hooks) {
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
      route: 'test/_publishability',
      getResponse: async (req: Request) => {
        publishabilityRequested = true;
        return new Response(
          JSON.stringify({
            data: {
              type: 'realm-publishability',
              attributes: {
                publishable: publishabilityResponse.publishable,
                realmURL: new URL(req.url).origin + '/test/',
                violations: publishabilityResponse.violations,
              },
            },
          }),
          { status: 200 },
        );
      },
    },
    {
      route: '_publish-realm',
      getResponse: async (req: Request) => {
        let body = (await req.json()) as { publishedRealmURL: string };
        publishedURLs.push(body.publishedRealmURL);
        if (publishShouldFail) {
          return new Response('boom', { status: 500 });
        }
        return new Response(
          JSON.stringify({
            data: {
              type: 'published-realm',
              attributes: {
                publishedRealmURL: body.publishedRealmURL,
                lastPublishedAt: '1700000000000',
              },
            },
          }),
          { status: 202 },
        );
      },
    },
    // `realm.publish` polls each target's `_readiness-check` after the 202.
    // The endpoint matcher keys on pathname, so cover the root-domain targets
    // (`/_readiness-check`) and the subdirectory target (`/my-space/...`).
    // Report ready immediately so the command resolves.
    {
      route: '_readiness-check',
      getResponse: async () => new Response(null, { status: 200 }),
    },
    {
      route: 'my-space/_readiness-check',
      getResponse: async () => new Response(null, { status: 200 }),
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = getService('loader-service').loader;
    PublishTarget = (
      await loader.import<typeof BaseToolModule>(`${baseRealm.url}command`)
    ).PublishTarget;
    publishabilityResponse = { publishable: true, violations: [] };
    publishShouldFail = false;
    publishabilityRequested = false;
    publishedURLs = [];

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
    return new PublishRealmTool(toolService.commandContext);
  }

  test('publishes a custom-domain target and reports it published', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await makeCommand().execute({
      realmURL,
      targets: [
        new PublishTarget({ type: 'custom', name: 'mysite.example.com' }),
      ],
    });

    assert.deepEqual(
      publishedURLs,
      ['https://mysite.example.com/'],
      'realm-server received the resolved custom published-realm URL',
    );
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(
      result.results[0].publishedRealmURL,
      'https://mysite.example.com/',
    );
    assert.strictEqual(result.results[0].status, 'published');
  });

  test('publishes pre-resolved publishedRealmURLs (the publish UI path)', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await makeCommand().execute({
      realmURL,
      publishedRealmURLs: [
        'https://mysite.example.com/',
        'https://other.example.com/',
      ],
    });

    assert.deepEqual(publishedURLs, [
      'https://mysite.example.com/',
      'https://other.example.com/',
    ]);
    assert.deepEqual(
      result.results.map((r) => [r.publishedRealmURL, r.status]),
      [
        ['https://mysite.example.com/', 'published'],
        ['https://other.example.com/', 'published'],
      ],
    );
  });

  test('throws when neither targets nor publishedRealmURLs are provided', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    await assert.rejects(
      makeCommand().execute({ realmURL }),
      /at least one entry in `targets` or `publishedRealmURLs`/,
    );
    assert.deepEqual(publishedURLs, [], 'did not call the publish endpoint');
  });

  test('derives a subdirectory URL from the realm session username', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;

    let result = await makeCommand().execute({
      realmURL,
      targets: [new PublishTarget({ type: 'subdirectory', name: 'my-space' })],
    });

    assert.strictEqual(publishedURLs.length, 1);
    assert.ok(
      /^https:\/\/testuser\..+\/my-space\/$/.test(publishedURLs[0]),
      `subdirectory URL "${publishedURLs[0]}" uses the testuser subdomain and my-space path`,
    );
    assert.strictEqual(result.results[0].status, 'published');
  });

  test('blocks publishing when the realm is not publishable', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    publishabilityResponse = {
      publishable: false,
      violations: [
        {
          kind: 'private-dependency',
          resource: `${realmURL}card`,
          externalDependencies: [],
        },
        { kind: 'error-document', resource: `${realmURL}broken` },
      ],
    };

    await assert.rejects(
      makeCommand().execute({
        realmURL,
        targets: [
          new PublishTarget({ type: 'custom', name: 'mysite.example.com' }),
        ],
      }),
      /not publishable/,
      'rejects with a publishability error',
    );
    assert.deepEqual(publishedURLs, [], 'did not call the publish endpoint');
  });

  test('force bypasses the publishability gate', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    publishabilityResponse = { publishable: false, violations: [] };

    let result = await makeCommand().execute({
      realmURL,
      targets: [
        new PublishTarget({ type: 'custom', name: 'mysite.example.com' }),
      ],
      force: true,
    });

    assert.false(
      publishabilityRequested,
      'force skips the publishability check',
    );
    assert.deepEqual(publishedURLs, ['https://mysite.example.com/']);
    assert.strictEqual(result.results[0].status, 'published');
  });

  test('reports an error when the publish request fails', async function (assert) {
    let realmServer = getService('realm-server');
    let realmURL = new URL('test/', realmServer.url).href;
    publishShouldFail = true;

    let result = await makeCommand().execute({
      realmURL,
      targets: [
        new PublishTarget({ type: 'custom', name: 'mysite.example.com' }),
      ],
    });

    assert.strictEqual(result.results[0].status, 'error');
    assert.ok(
      result.results[0].error,
      'includes an error message for the failed target',
    );
  });
});
