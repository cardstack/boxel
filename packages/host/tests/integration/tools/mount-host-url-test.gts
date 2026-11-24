import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import type {
  ClaimedDomain,
  HostURL,
} from '@cardstack/host/services/realm-server';
import { HostURLRequestError } from '@cardstack/host/services/realm-server';
import MountHostURLTool from '@cardstack/host/tools/mount-host-url';

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

const siteDomain = ENV.publishedRealmBoxelSiteDomain;
const SPACE_URL = `https://testuser.${ENV.publishedRealmBoxelSpaceDomain}/test/`;

// A stand-in for the realm server's host URL and site name endpoints, set on
// the methods of the realm-server service. It records each change in `calls`.
class FakeHostURLs {
  boxelSpaceURL: string | undefined = SPACE_URL;
  claimedDomain: ClaimedDomain | null = null;
  refusal: string | undefined;
  claimRefusal: { status: number; message: string } | undefined;
  calls: string[] = [];

  install() {
    let realmServer = getService('realm-server') as any;
    realmServer.listHostURLs = async () => ({
      hostURLs: [],
      boxelSpaceURL: this.boxelSpaceURL,
    });
    realmServer.fetchBoxelClaimedDomain = async () => this.claimedDomain;
    realmServer.claimBoxelDomain = async (
      sourceRealmURL: string,
      hostname: string,
    ) => {
      this.calls.push(`claim ${hostname}`);
      if (this.claimRefusal) {
        throw new HostURLRequestError(
          this.claimRefusal.status,
          this.claimRefusal.message,
        );
      }
      this.claimedDomain = {
        id: 'claim-1',
        hostname,
        subdomain: hostname.split('.')[0],
        sourceRealmURL,
      };
      return {};
    };
    realmServer.mountHostURL = async (
      realmURL: string,
      url: string,
    ): Promise<HostURL> => {
      this.calls.push(`mount ${realmURL} ${url}`);
      if (this.refusal) {
        throw new HostURLRequestError(422, this.refusal);
      }
      return {
        id: 'host-url-1',
        url,
        kind: url === this.boxelSpaceURL ? 'boxel-space' : 'site-name',
        isCanonical: true,
      };
    };
  }
}

module('Integration | tools | mount-host-url', function (hooks) {
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
    return new MountHostURLTool(toolService.toolContext);
  }

  test('refuses to run when the hostModeV2 flag is off', async function (assert) {
    await assert.rejects(
      makeTool().execute({ realmURL: testRealmURL, kind: 'boxel-space' }),
      /hostModeV2 feature flag is off/,
    );
    assert.deepEqual(fake.calls, [], 'mounted nothing');
  });

  module('with hostModeV2 on', function (hooks) {
    setupFeatureFlag(hooks, 'hostModeV2');

    test('mounts the realm at its Boxel Space URL', async function (assert) {
      let result = await makeTool().execute({
        realmURL: testRealmURL.replace(/\/$/, ''),
        kind: 'boxel-space',
        name: 'ignored',
      });

      assert.deepEqual(fake.calls, [`mount ${testRealmURL} ${SPACE_URL}`]);
      assert.strictEqual(result.hostURLId, 'host-url-1');
      assert.strictEqual(result.url, SPACE_URL);
      assert.strictEqual(result.kind, 'boxel-space');
      assert.true(result.isCanonical);
    });

    test('refuses a Boxel Space mount when the realm has no Boxel Space URL', async function (assert) {
      fake.boxelSpaceURL = undefined;

      await assert.rejects(
        makeTool().execute({ realmURL: testRealmURL, kind: 'boxel-space' }),
        /has no Boxel Space URL/,
      );
      assert.deepEqual(fake.calls, [], 'mounted nothing');
    });

    test('claims a site name that the realm has not claimed, then mounts it', async function (assert) {
      let result = await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: 'my-site',
      });

      let url = `https://my-site.${siteDomain}/`;
      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} ${url}`,
      ]);
      assert.strictEqual(result.url, url);
    });

    test('mounts a site name that the realm claims without claiming it again', async function (assert) {
      fake.claimedDomain = {
        id: 'claim-1',
        hostname: `my-site.${siteDomain}`,
        subdomain: 'my-site',
        sourceRealmURL: testRealmURL,
      };

      await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: `my-site.${siteDomain}`,
      });

      assert.deepEqual(fake.calls, [
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('claims and mounts a site name when the caller claims a different one for the realm', async function (assert) {
      fake.claimedDomain = {
        id: 'claim-1',
        hostname: `other-site.${siteDomain}`,
        subdomain: 'other-site',
        sourceRealmURL: testRealmURL,
      };

      await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: 'my-site',
      });

      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('mounts a site name when the claim is refused with a 422', async function (assert) {
      fake.claimRefusal = {
        status: 422,
        message: 'Hostname is already claimed',
      };

      let result = await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: 'my-site',
      });

      let url = `https://my-site.${siteDomain}/`;
      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} ${url}`,
      ]);
      assert.strictEqual(result.url, url);
    });

    test('gives the reason for a mount refusal after a claim refused with a 422', async function (assert) {
      fake.claimRefusal = {
        status: 422,
        message: 'Hostname is already claimed',
      };
      fake.refusal = 'The site name is claimed by another user.';

      await assert.rejects(
        makeTool().execute({
          realmURL: testRealmURL,
          kind: 'site-name',
          name: 'my-site',
        }),
        (error: Error) =>
          error.message === 'The site name is claimed by another user.',
      );
      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('refuses a site name when the claim fails with a status other than 422', async function (assert) {
      fake.claimRefusal = { status: 500, message: 'Internal server error' };

      await assert.rejects(
        makeTool().execute({
          realmURL: testRealmURL,
          kind: 'site-name',
          name: 'my-site',
        }),
        (error: Error) => error.message === 'Internal server error',
      );
      assert.deepEqual(
        fake.calls,
        [`claim my-site.${siteDomain}`],
        'mounted nothing',
      );
    });

    test('mounts the realm at a custom domain', async function (assert) {
      await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'custom-domain',
        name: 'www.example.com',
      });

      assert.deepEqual(fake.calls, [
        `mount ${testRealmURL} https://www.example.com/`,
      ]);
    });

    test('refuses a site name or custom domain without a name', async function (assert) {
      await assert.rejects(
        makeTool().execute({ realmURL: testRealmURL, kind: 'custom-domain' }),
        /needs a name/,
      );
      assert.deepEqual(fake.calls, [], 'mounted nothing');
    });

    test('refuses an unknown kind', async function (assert) {
      await assert.rejects(
        makeTool().execute({ realmURL: testRealmURL, kind: 'subdirectory' }),
        /Unknown host URL kind 'subdirectory'/,
      );
      assert.deepEqual(fake.calls, [], 'mounted nothing');
    });

    test('gives the reason for a refusal from the realm server unchanged', async function (assert) {
      fake.refusal =
        'Visitors who are not signed in cannot view the home page of this realm.';

      await assert.rejects(
        makeTool().execute({ realmURL: testRealmURL, kind: 'boxel-space' }),
        (error: Error) =>
          error.message ===
          'Visitors who are not signed in cannot view the home page of this realm.',
      );
    });
  });
});
