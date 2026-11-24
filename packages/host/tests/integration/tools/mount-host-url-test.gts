import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import ENV from '@cardstack/host/config/environment';
import type {
  HomePageCheck,
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
// the methods of the realm-server service. It records each claim and mount in
// `calls`, and each home page check and availability check in `checks`.
class FakeHostURLs {
  boxelSpaceURL: string | undefined = SPACE_URL;
  // What the home page check says, or the reason it refuses the caller.
  anonymousCanView = true;
  homePageRefusal: { status: number; message: string } | undefined;
  // What the availability check says about every name.
  available = true;
  availabilityError: string | undefined;
  claimRefusal: { status: number; message: string } | undefined;
  refusal: string | undefined;
  calls: string[] = [];
  checks: string[] = [];

  install() {
    let realmServer = getService('realm-server') as any;
    realmServer.listHostURLs = async () => ({
      hostURLs: [],
      boxelSpaceURL: this.boxelSpaceURL,
    });
    realmServer.checkHomePage = async (
      realmURL: string,
    ): Promise<HomePageCheck> => {
      this.checks.push(`home page ${realmURL}`);
      if (this.homePageRefusal) {
        throw new HostURLRequestError(
          this.homePageRefusal.status,
          this.homePageRefusal.message,
        );
      }
      return {
        homeCardReadable: this.anonymousCanView,
        unloadableModules: [],
        anonymousCanView: this.anonymousCanView,
      };
    };
    realmServer.checkDomainAvailability = async (subdomain: string) => {
      this.checks.push(`availability ${subdomain}`);
      return {
        available: this.available,
        hostname: `${subdomain}.${siteDomain}`,
        ...(this.availabilityError ? { error: this.availabilityError } : {}),
      };
    };
    realmServer.claimBoxelDomain = async (
      _sourceRealmURL: string,
      hostname: string,
    ) => {
      this.calls.push(`claim ${hostname}`);
      if (this.claimRefusal) {
        throw new HostURLRequestError(
          this.claimRefusal.status,
          this.claimRefusal.message,
        );
      }
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

    function mountSiteName() {
      return makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: 'my-site',
      });
    }

    test('claims a site name that no one has claimed, then mounts it', async function (assert) {
      let result = await mountSiteName();

      assert.deepEqual(fake.checks, [
        `home page ${testRealmURL}`,
        'availability my-site',
      ]);
      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
      assert.strictEqual(result.url, `https://my-site.${siteDomain}/`);
    });

    test('accepts the full hostname of a site name', async function (assert) {
      await makeTool().execute({
        realmURL: testRealmURL,
        kind: 'site-name',
        name: `My-Site.${siteDomain}`,
      });

      assert.deepEqual(fake.calls, [
        `claim my-site.${siteDomain}`,
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('leaves a site name that is claimed already to the mount', async function (assert) {
      fake.available = false;

      await mountSiteName();

      assert.deepEqual(fake.calls, [
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('gives the mount’s reason when it refuses a site name that is claimed already', async function (assert) {
      fake.available = false;
      fake.refusal = 'The site name is claimed by another user.';

      await assert.rejects(
        mountSiteName(),
        (error: Error) =>
          error.message === 'The site name is claimed by another user.',
      );
    });

    test('claims nothing for a realm a caller who does not administer it names', async function (assert) {
      fake.homePageRefusal = {
        status: 403,
        message: 'You do not administer this realm.',
      };

      await assert.rejects(
        mountSiteName(),
        (error: Error) => error.message === 'You do not administer this realm.',
      );
      assert.deepEqual(fake.calls, [], 'claimed and mounted nothing');
    });

    test('claims nothing for a realm whose home page the mount refuses, and gives the mount’s reason', async function (assert) {
      fake.anonymousCanView = false;
      fake.refusal =
        "The realm can't be mounted: a visitor who is not signed in can't read its home card.";

      await assert.rejects(mountSiteName(), (error: Error) =>
        error.message.startsWith("The realm can't be mounted"),
      );
      assert.deepEqual(fake.calls, [
        `mount ${testRealmURL} https://my-site.${siteDomain}/`,
      ]);
    });

    test('refuses a site name that can never be claimed, with the reason', async function (assert) {
      fake.available = false;
      fake.availabilityError = 'Subdomain must be lowercase';

      await assert.rejects(
        mountSiteName(),
        (error: Error) => error.message === 'Subdomain must be lowercase',
      );
      assert.deepEqual(fake.calls, [], 'claimed and mounted nothing');
    });

    test('refuses a site name when the claim fails', async function (assert) {
      fake.claimRefusal = { status: 500, message: 'Internal server error' };

      await assert.rejects(
        mountSiteName(),
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
