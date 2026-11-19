import { click, fillIn, waitFor } from '@ember/test-helpers';

import { CardsGrid } from '@cardstack/base/cards-grid';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import { baseRealm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type RealmService from '@cardstack/host/services/realm';
import type {
  ClaimedDomain,
  HomePageCheck,
  HostURL,
} from '@cardstack/host/services/realm-server';
import { HostURLRequestError } from '@cardstack/host/services/realm-server';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
} from '../helpers';
import { setupFeatureFlag } from '../helpers/feature-flags';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { TEST_CLOCK_INSTANT } from '../helpers/test-clock';

// The UI builds Boxel Space and site-name URLs from these domains, which are
// the same in the test build.
const spaceDomain = ENV.publishedRealmBoxelSpaceDomain;
const siteDomain = ENV.publishedRealmBoxelSiteDomain;
const SPACE_URL = `https://testuser.${spaceDomain}/test/`;

const personCardSource = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><p><@fields.firstName /></p></template>
    };
  }
`;

const VIEWABLE: HomePageCheck = {
  homeCardId: `${testRealmURL}index`,
  homeCardReadable: true,
  homeCardStatus: 200,
  unloadableModules: [],
  anonymousCanView: true,
};

// A stand-in for the realm server's `/_host-urls` endpoints, set on the
// realm-server service's methods. It keeps the realm's host URLs, and records
// each change in `calls`.
class FakeHostURLs {
  hostURLs: HostURL[] = [];
  homePage: HomePageCheck = VIEWABLE;
  calls: string[] = [];
  refusal: string | undefined;
  claimedDomain: ClaimedDomain | null = null;
  #nextId = 1;
  #restore: (() => void)[] = [];

  install() {
    let realmServer = getService('realm-server') as any;
    let stub = (name: string, fn: (...args: any[]) => unknown) => {
      let original = realmServer[name];
      realmServer[name] = fn;
      this.#restore.push(() => (realmServer[name] = original));
    };
    stub('listHostURLs', async () => this.hostURLs.map((h) => ({ ...h })));
    stub('checkHomePage', async () => this.homePage);
    stub('fetchBoxelClaimedDomain', async () => this.claimedDomain);
    stub('mountHostURL', async (_realmURL: string, url: string) => {
      this.calls.push(`mount ${url}`);
      if (this.refusal) {
        throw new HostURLRequestError(422, this.refusal);
      }
      let hostURL: HostURL = {
        id: `host-url-${this.#nextId++}`,
        url,
        kind: url.includes(spaceDomain) ? 'boxel-space' : 'custom-domain',
        isCanonical: this.hostURLs.length === 0,
      };
      this.hostURLs.push(hostURL);
      return hostURL;
    });
    stub('setCanonicalHostURL', async (id: string) => {
      this.calls.push(`canonical ${id}`);
      for (let hostURL of this.hostURLs) {
        hostURL.isCanonical = hostURL.id === id;
      }
    });
    stub('unpublishRealm', async (publishedRealmURL: string) => {
      this.calls.push(`unpublish ${publishedRealmURL}`);
      return { sourceRealmURL: null, publishedRealmURL, lastPublishedAt: null };
    });
    stub('unmountHostURL', async (id: string) => {
      this.calls.push(`unmount ${id}`);
      // Unmounting a site name frees its claim.
      if (this.hostURLs.find((h) => h.id === id)?.kind === 'site-name') {
        this.claimedDomain = null;
      }
      this.hostURLs = this.hostURLs.filter((h) => h.id !== id);
    });
  }

  restore() {
    for (let restore of this.#restore) {
      restore();
    }
  }
}

module('Acceptance | host URL manager', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupFeatureFlag(hooks, 'hostModeV2');

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  let fake: FakeHostURLs;

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          'realm.json': realmConfigCardJSON({ name: 'Test Workspace B' }),
          'person.gts': personCardSource,
          'Person/1.json': {
            data: {
              type: 'card',
              attributes: { firstName: 'A' },
              meta: { adoptsFrom: { module: '../person', name: 'Person' } },
            },
          },
        },
      });
    });
    fake = new FakeHostURLs();
    fake.install();
  });

  hooks.afterEach(function () {
    fake.restore();
  });

  async function openManager() {
    await visitOperatorMode({
      submode: 'host',
      trail: [`${testRealmURL}Person/1.json`],
    });
    await click('[data-test-publish-realm-button]');
    await waitFor('[data-test-host-url-manager]');
    await waitFor('[data-test-visibility-note]');
  }

  test('the publish dialog is the host URL manager, with no progress or "last published" UI', async function (assert) {
    await openManager();
    assert.dom('[data-test-publish-realm-modal]').doesNotExist();
    assert.dom('[data-test-publish-button]').doesNotExist();
    assert.dom('[data-test-last-published-at]').doesNotExist();
    assert.dom('[data-test-publish-progress-status]').doesNotExist();
    assert.dom('[data-test-unlisted-link-checkbox]').doesNotExist();
    assert.dom('[data-test-no-host-urls]').exists();
    assert.dom('[data-test-home-page-viewable]').exists();
    assert
      .dom('[data-test-visibility-note]')
      .containsText('the realm’s owner rendered it');
  });

  test('mounts the realm in the Boxel Space, and lists the host URL as canonical', async function (assert) {
    await openManager();
    assert
      .dom('[data-test-mount-target="boxel-space"]')
      .containsText(SPACE_URL.replace('https://', ''));
    assert
      .dom('[data-test-mount-target="boxel-space"]')
      .doesNotContainText('https://', 'the URL is shown without its scheme');

    await click('[data-test-mount="boxel-space"]');
    await waitFor(`[data-test-host-url="${SPACE_URL}"]`);

    assert.deepEqual(fake.calls, [`mount ${SPACE_URL}`]);
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] a`)
      .hasAttribute('href', SPACE_URL);
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] a`)
      .containsText(
        SPACE_URL.replace('https://', ''),
        'the link shows the URL without its scheme',
      );
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] a`)
      .hasAttribute('target', '_blank', 'the link opens in a new tab');
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] a`)
      .containsText('(opens in a new tab)');
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] [data-test-host-url-canonical]`)
      .exists('the first host URL is canonical');
    assert
      .dom('[data-test-mount-target="boxel-space"]')
      .doesNotExist('a mounted address is not offered again');
  });

  test('shows the reason the server refuses a mount', async function (assert) {
    fake.refusal = 'A Boxel Space host URL must be in the realm owner’s Space';
    await openManager();
    await click('[data-test-mount="boxel-space"]');
    await waitFor('[data-test-mount-error="boxel-space"]');
    assert.dom('[data-test-mount-error="boxel-space"]').hasText(fake.refusal);
  });

  test('hides the "Mount at" section when there is nowhere left to mount', async function (assert) {
    let siteURL = `https://shop.${siteDomain}/`;
    fake.claimedDomain = {
      id: 'claim-1',
      hostname: `shop.${siteDomain}`,
      subdomain: 'shop',
      sourceRealmURL: testRealmURL,
    };
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
      { id: 'b', url: siteURL, kind: 'site-name', isCanonical: false },
    ];
    await openManager();
    assert.dom(`[data-test-host-url="${siteURL}"]`).exists();
    assert.dom('[data-test-mount-targets]').doesNotExist();
    assert.dom('[data-test-mount-target]').doesNotExist();
  });

  test('marks another host URL canonical', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
      {
        id: 'b',
        url: `https://shop.${siteDomain}/`,
        kind: 'site-name',
        isCanonical: false,
      },
    ];
    await openManager();
    await click(`[data-test-make-canonical="https://shop.${siteDomain}/"]`);
    await waitFor(
      `[data-test-host-url="https://shop.${siteDomain}/"] [data-test-host-url-canonical]`,
    );
    assert.deepEqual(fake.calls, ['canonical b']);
    assert
      .dom(`[data-test-host-url="${SPACE_URL}"] [data-test-host-url-canonical]`)
      .doesNotExist();
  });

  test('to unmount the canonical host URL with one other, makes that one canonical and says so', async function (assert) {
    let shopURL = `https://shop.${siteDomain}/`;
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
      { id: 'b', url: shopURL, kind: 'site-name', isCanonical: false },
    ];
    await openManager();
    await click(`[data-test-unmount-host-url="${SPACE_URL}"]`);
    await waitFor(`[data-test-host-url="${SPACE_URL}"]`, { count: 0 });

    assert
      .dom('[data-test-replace-canonical]')
      .doesNotExist('there is no choice to ask about');
    assert.deepEqual(fake.calls, ['canonical b', 'unmount a']);
    assert
      .dom(`[data-test-host-url="${shopURL}"] [data-test-host-url-canonical]`)
      .exists();
    assert
      .dom('[data-test-host-url-toaster] [data-test-pretui-toast-item]')
      .containsText(`shop.${siteDomain}/ is now the canonical host URL`);
  });

  test('unmounting a canonical site name host URL frees the name, and the manager offers to claim one again', async function (assert) {
    let shopURL = `https://shop.${siteDomain}/`;
    fake.claimedDomain = {
      id: 'claim-1',
      hostname: `shop.${siteDomain}`,
      subdomain: 'shop',
      sourceRealmURL: testRealmURL,
    };
    fake.hostURLs = [
      { id: 'a', url: shopURL, kind: 'site-name', isCanonical: true },
      { id: 'b', url: SPACE_URL, kind: 'boxel-space', isCanonical: false },
    ];
    await openManager();
    await click(`[data-test-unmount-host-url="${shopURL}"]`);
    await waitFor(`[data-test-host-url="${shopURL}"]`, { count: 0 });

    assert.deepEqual(fake.calls, ['canonical b', 'unmount a']);
    assert
      .dom('[data-test-mount-target="site-name"]')
      .doesNotExist('the freed name is not offered for mounting');
    assert.dom('[data-test-mount-target="site-name-claim"]').exists();
  });

  test('to unmount the canonical host URL with several others, asks for the new canonical one first', async function (assert) {
    let shopURL = `https://shop.${siteDomain}/`;
    let storeURL = `https://store.${siteDomain}/`;
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
      { id: 'b', url: shopURL, kind: 'site-name', isCanonical: false },
      { id: 'c', url: storeURL, kind: 'custom-domain', isCanonical: false },
    ];
    await openManager();
    await click(`[data-test-unmount-host-url="${SPACE_URL}"]`);

    assert.dom('[data-test-replace-canonical]').exists();
    assert.deepEqual(fake.calls, [], 'nothing is removed yet');
    assert.dom('[data-test-confirm-replace-canonical]').isDisabled();

    assert
      .dom('[data-test-new-canonical] input[type="radio"]')
      .exists({ count: 2 }, 'only the other host URLs are offered');
    await click('[data-test-new-canonical] input[value="b"]');
    await click('[data-test-confirm-replace-canonical]');
    await waitFor(`[data-test-host-url="${SPACE_URL}"]`, { count: 0 });

    assert.deepEqual(fake.calls, ['canonical b', 'unmount a']);
    assert
      .dom(`[data-test-host-url="${shopURL}"] [data-test-host-url-canonical]`)
      .exists();
    assert.dom('[data-test-replace-canonical]').doesNotExist();
    assert
      .dom('[data-test-host-url-toaster] [data-test-pretui-toast-item]')
      .doesNotExist('no toast when the user chose');
  });

  test('unmounts the only host URL at once', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
    ];
    await openManager();
    await click(`[data-test-unmount-host-url="${SPACE_URL}"]`);
    await waitFor('[data-test-no-host-urls]');
    assert.deepEqual(fake.calls, ['unmount a']);
  });

  test('when visitors who are not signed in can’t view the home page, says why and blocks mounting until a grant', async function (assert) {
    fake.homePage = {
      homeCardId: `${testRealmURL}index`,
      homeCardReadable: false,
      homeCardStatus: 401,
      unloadableModules: [{ url: `${testRealmURL}home`, status: 401 }],
      anonymousCanView: false,
    };
    let realmService = getService('realm') as RealmService;
    let originalGrant = realmService.grantPublicRead;
    let granted = 0;
    realmService.grantPublicRead = async () => {
      granted++;
      fake.homePage = VIEWABLE;
    };
    try {
      await openManager();
      assert.dom('[data-test-home-page-not-viewable]').exists();
      assert
        .dom('[data-test-unloadable-modules]')
        .containsText(`${testRealmURL}home`);
      assert.dom('[data-test-mount="boxel-space"]').isDisabled();

      await click('[data-test-grant-public-read]');
      await waitFor('[data-test-home-page-viewable]');
      assert.strictEqual(granted, 1);
      assert.dom('[data-test-mount="boxel-space"]').isNotDisabled();
    } finally {
      realmService.grantPublicRead = originalGrant;
    }
  });

  test('when the realm’s root redirects, says so and offers no public-read grant', async function (assert) {
    fake.homePage = {
      homeCardId: `${testRealmURL}index`,
      homeCardReadable: true,
      homeCardStatus: 200,
      unloadableModules: [],
      anonymousCanView: false,
      redirectTo: 'https://example.test/elsewhere',
    };
    await openManager();
    assert
      .dom('[data-test-home-page-not-viewable]')
      .containsText('https://example.test/elsewhere');
    assert.dom('[data-test-mount="boxel-space"]').isDisabled();
    assert
      .dom('[data-test-grant-public-read]')
      .doesNotExist('a public-read grant would not stop the redirect');
  });

  test('lists the sites published with v1, each with Remove only', async function (assert) {
    let v1URL = `https://testuser.${spaceDomain}/old-copy/`;
    let realmService = getService('realm') as RealmService;
    await realmService.ensureRealmMeta(testRealmURL);
    let resource = (realmService as any).realms.get(testRealmURL);
    let previousInfo = resource.info;
    resource.info = new TrackedObject({
      ...previousInfo,
      lastPublishedAt: { [v1URL]: String(TEST_CLOCK_INSTANT) },
    });
    try {
      await openManager();
      assert.dom(`[data-test-v1-site="${v1URL}"]`).exists();
      assert
        .dom(`[data-test-v1-site="${v1URL}"] button`)
        .exists({ count: 1 }, 'the only action is Remove');

      await click(`[data-test-remove-v1-site="${v1URL}"]`);
      await waitFor(`[data-test-v1-site="${v1URL}"]`, { count: 0 });
      assert.deepEqual(fake.calls, [`unpublish ${v1URL}`]);
    } finally {
      resource.info = previousInfo;
    }
  });

  test('shows why a site published with v1 could not be removed, and keeps it listed', async function (assert) {
    let v1URL = `https://testuser.${spaceDomain}/old-copy/`;
    let realmServer = getService('realm-server') as any;
    let originalUnpublish = realmServer.unpublishRealm;
    realmServer.unpublishRealm = async () => {
      throw new Error('The realm server could not remove the site');
    };
    let realmService = getService('realm') as RealmService;
    await realmService.ensureRealmMeta(testRealmURL);
    let resource = (realmService as any).realms.get(testRealmURL);
    let previousInfo = resource.info;
    resource.info = new TrackedObject({
      ...previousInfo,
      lastPublishedAt: { [v1URL]: String(TEST_CLOCK_INSTANT) },
    });
    try {
      await openManager();
      await click(`[data-test-remove-v1-site="${v1URL}"]`);
      await waitFor(`[data-test-v1-site-error="${v1URL}"]`);
      assert
        .dom(`[data-test-v1-site-error="${v1URL}"]`)
        .containsText('could not remove the site');
      assert.dom(`[data-test-v1-site="${v1URL}"]`).exists();
    } finally {
      realmServer.unpublishRealm = originalUnpublish;
      resource.info = previousInfo;
    }
  });

  test('claims a site name and mounts the realm there', async function (assert) {
    let realmServer = getService('realm-server') as any;
    let claimed: string[] = [];
    let originalClaim = realmServer.claimBoxelDomain;
    realmServer.claimBoxelDomain = async (_: string, hostname: string) => {
      claimed.push(hostname);
      realmServer.fetchBoxelClaimedDomain = async () => ({
        id: 'claim-1',
        hostname,
        subdomain: 'shop',
        sourceRealmURL: testRealmURL,
      });
    };
    try {
      await openManager();
      await fillIn('[data-test-site-name-input]', 'shop');
      await click('[data-test-claim-site-name]');
      await waitFor(`[data-test-host-url="https://shop.${siteDomain}/"]`);
      assert.deepEqual(claimed, [`shop.${siteDomain}`]);
      assert.deepEqual(fake.calls, [`mount https://shop.${siteDomain}/`]);
    } finally {
      realmServer.claimBoxelDomain = originalClaim;
    }
  });
});
