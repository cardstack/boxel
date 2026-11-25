import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import type { HostURL } from '@cardstack/host/services/realm-server';
import { HostURLRequestError } from '@cardstack/host/services/realm-server';
import UnmountHostURLTool from '@cardstack/host/tools/unmount-host-url';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupFeatureFlag } from '../../helpers/feature-flags';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const SITE_URL = `http://my-site.${ENV.publishedRealmBoxelSiteDomain}/`;
const SPACE_URL = `https://testuser.${ENV.publishedRealmBoxelSpaceDomain}/test/`;

// A stand-in for the realm server's host URL endpoints, set on the methods of
// the realm-server service. It records each call in `calls`.
class FakeHostURLs {
  hostURLs: HostURL[] = [
    {
      id: 'host-url-1',
      url: SPACE_URL,
      kind: 'boxel-space',
      isCanonical: true,
    },
    { id: 'host-url-2', url: SITE_URL, kind: 'site-name', isCanonical: false },
  ];
  refusal: string | undefined;
  calls: string[] = [];

  install() {
    let realmServer = getService('realm-server') as any;
    realmServer.listHostURLs = async (realmURL: string) => {
      this.calls.push(`list ${realmURL}`);
      return { hostURLs: this.hostURLs.map((h) => ({ ...h })) };
    };
    realmServer.unmountHostURL = async (id: string) => {
      this.calls.push(`unmount ${id}`);
      if (this.refusal) {
        throw new HostURLRequestError(422, this.refusal);
      }
      this.hostURLs = this.hostURLs.filter((h) => h.id !== id);
    };
  }
}

module('Integration | tools | unmount-host-url', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  let fake: FakeHostURLs;

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
    fake = new FakeHostURLs();
    fake.install();
  });

  function makeTool() {
    let toolService = getService('tool-service');
    return new UnmountHostURLTool(toolService.toolContext);
  }

  test('refuses to run when the hostModeV2 flag is off', async function (assert) {
    await assert.rejects(
      makeTool().execute({ realmURL: testRealmURL, url: SITE_URL }),
      /hostModeV2 feature flag is off/,
    );
    assert.deepEqual(fake.calls, [], 'read and unmounted nothing');
  });

  module('with hostModeV2 on', function (hooks) {
    setupFeatureFlag(hooks, 'hostModeV2');

    test('finds the host URL by its host and path, whatever the scheme and trailing slash', async function (assert) {
      let result = await makeTool().execute({
        realmURL: testRealmURL.replace(/\/$/, ''),
        url: `my-site.${ENV.publishedRealmBoxelSiteDomain}`,
      });

      assert.deepEqual(fake.calls, [
        `list ${testRealmURL}`,
        'unmount host-url-2',
      ]);
      assert.strictEqual(result.url, SITE_URL);
      assert.strictEqual(result.status, 'unmounted');
    });

    test('refuses a URL that the realm is not mounted at', async function (assert) {
      await assert.rejects(
        makeTool().execute({
          realmURL: testRealmURL,
          url: 'https://www.example.com/',
        }),
        /is not mounted at https:\/\/www\.example\.com\//,
      );
      assert.deepEqual(
        fake.calls,
        [`list ${testRealmURL}`],
        'unmounted nothing',
      );
    });

    test('gives the reason for a refusal from the realm server unchanged', async function (assert) {
      fake.refusal =
        'Make another host URL canonical before you unmount the canonical host URL.';

      await assert.rejects(
        makeTool().execute({ realmURL: testRealmURL, url: SPACE_URL }),
        (error: Error) =>
          error.message ===
          'Make another host URL canonical before you unmount the canonical host URL.',
      );
      assert.deepEqual(fake.calls, [
        `list ${testRealmURL}`,
        'unmount host-url-1',
      ]);
    });
  });
});
