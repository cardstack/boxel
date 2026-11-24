import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { CardsGrid } from '@cardstack/base/cards-grid';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';
import { TrackedObject } from 'tracked-built-ins';

import { baseRealm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import type RealmService from '@cardstack/host/services/realm';

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
import { FakeHostURLs, SPACE_URL } from '../helpers/fake-host-urls';
import { setupFeatureFlag } from '../helpers/feature-flags';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { TEST_CLOCK_INSTANT } from '../helpers/test-clock';

const spaceDomain = ENV.publishedRealmBoxelSpaceDomain;
const siteDomain = ENV.publishedRealmBoxelSiteDomain;
const SHOP_URL = `https://shop.${siteDomain}/`;
const V1_URL = `https://testuser.${spaceDomain}/old-copy/`;
const CARD_PATH = 'Person/1';

// The main Open Site button in the top bar. The popover's buttons carry the
// same attribute, so the main one is the first match.
const OPEN_SITE = '[data-test-open-site-button]';

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

// Gives the test realm a site published with v1. Returns a function that
// takes it away again.
async function withV1Site(url: string): Promise<() => void> {
  let realmService = getService('realm') as RealmService;
  await realmService.ensureRealmMeta(testRealmURL);
  let resource = (realmService as any).realms.get(testRealmURL);
  let previousInfo = resource.info;
  resource.info = new TrackedObject({
    ...previousInfo,
    lastPublishedAt: { [url]: String(TEST_CLOCK_INSTANT) },
  });
  return () => {
    resource.info = previousInfo;
  };
}

async function visitPerson() {
  await visitOperatorMode({
    submode: 'host',
    trail: [`${testRealmURL}${CARD_PATH}.json`],
  });
}

function setupRealm(hooks: NestedHooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

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
  });
}

module('Acceptance | host mode open site', function (hooks) {
  setupRealm(hooks);
  setupFeatureFlag(hooks, 'hostModeV2');

  let fake: FakeHostURLs;

  hooks.beforeEach(function () {
    fake = new FakeHostURLs();
    fake.install();
  });

  hooks.afterEach(function () {
    fake.restore();
  });

  test('with a host URL and no v1 site, the button opens the canonical host URL at the card', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SHOP_URL, kind: 'site-name', isCanonical: false },
      { id: 'b', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
    ];
    await visitPerson();
    await waitFor(OPEN_SITE);
    assert
      .dom(OPEN_SITE)
      .hasAttribute('href', `${SPACE_URL}${CARD_PATH}`)
      .hasAttribute('target', '_blank');
  });

  test('Shift+Click lists the host URLs, canonical first and marked, then the v1 sites', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SHOP_URL, kind: 'site-name', isCanonical: false },
      { id: 'b', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
    ];
    let restore = await withV1Site(V1_URL);
    try {
      await visitPerson();
      await waitUntil(() =>
        document
          .querySelector(OPEN_SITE)
          ?.getAttribute('href')
          ?.startsWith(SPACE_URL),
      );
      await click(OPEN_SITE, { shiftKey: true });
      assert.dom('[data-test-open-site-popover]').exists();

      let hostURLs = [
        ...document.querySelectorAll('[data-test-open-site-host-url]'),
      ].map((el) => el.getAttribute('data-test-open-site-host-url'));
      assert.deepEqual(
        hostURLs,
        [`${SPACE_URL}${CARD_PATH}`, `${SHOP_URL}${CARD_PATH}`],
        'the canonical host URL is first',
      );
      assert
        .dom(
          `[data-test-open-site-host-url="${SPACE_URL}${CARD_PATH}"] [data-test-open-site-canonical]`,
        )
        .hasText('Canonical');
      assert
        .dom(
          `[data-test-open-site-host-url="${SHOP_URL}${CARD_PATH}"] [data-test-open-site-canonical]`,
        )
        .doesNotExist();
      assert
        .dom(
          `[data-test-open-site-host-url="${SHOP_URL}${CARD_PATH}"] [data-test-open-site-button]`,
        )
        .hasAttribute('href', `${SHOP_URL}${CARD_PATH}`);

      assert.dom('[data-test-open-site-group="host-urls"]').exists();
      assert.dom('[data-test-open-site-group="v1-sites"]').exists();
      assert
        .dom(`[data-test-published-realm-item="${V1_URL}${CARD_PATH}"]`)
        .exists('the v1 site is listed after the host URLs');
      let items = [
        ...document.querySelectorAll(
          '[data-test-open-site-host-url], [data-test-published-realm-item]',
        ),
      ];
      assert.true(
        items[items.length - 1].hasAttribute('data-test-published-realm-item'),
        'the v1 site comes last',
      );
    } finally {
      restore();
    }
  });

  test('with no host URL and no v1 site, there is no button', async function (assert) {
    await visitPerson();
    await waitUntil(() => fake.listCalls > 0);
    await settled();
    assert.dom(OPEN_SITE).doesNotExist();
  });

  test('with only a v1 site, the button opens the v1 site', async function (assert) {
    let restore = await withV1Site(V1_URL);
    try {
      await visitPerson();
      await waitUntil(() => fake.listCalls > 0);
      await settled();
      assert.dom(OPEN_SITE).hasAttribute('href', `${V1_URL}${CARD_PATH}`);
    } finally {
      restore();
    }
  });

  test('a host URL mounted in the host URL manager shows the button, and unmounting it takes the button away', async function (assert) {
    await visitPerson();
    await waitUntil(() => fake.listCalls > 0);
    await settled();
    assert.dom(OPEN_SITE).doesNotExist();

    await click('[data-test-publish-realm-button]');
    await waitFor('[data-test-mount="boxel-space"]');
    await click('[data-test-mount="boxel-space"]');
    await waitFor(`[data-test-host-url="${SPACE_URL}"]`);
    assert.dom(OPEN_SITE).hasAttribute('href', `${SPACE_URL}${CARD_PATH}`);

    await click(`[data-test-unmount-host-url="${SPACE_URL}"]`);
    await click('[data-test-confirm-unmount-button]');
    await waitFor('[data-test-no-host-urls]');
    assert.dom(OPEN_SITE).doesNotExist();
  });

  test('making another host URL canonical in the manager changes where the button goes', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
      { id: 'b', url: SHOP_URL, kind: 'site-name', isCanonical: false },
    ];
    await visitPerson();
    await waitFor(OPEN_SITE);
    assert.dom(OPEN_SITE).hasAttribute('href', `${SPACE_URL}${CARD_PATH}`);

    await click('[data-test-publish-realm-button]');
    await waitFor(`[data-test-make-canonical="${SHOP_URL}"]`);
    await click(`[data-test-make-canonical="${SHOP_URL}"]`);
    await waitFor(
      `[data-test-host-url="${SHOP_URL}"] [data-test-host-url-canonical]`,
    );
    assert.dom(OPEN_SITE).hasAttribute('href', `${SHOP_URL}${CARD_PATH}`);
  });

  test('when the host URLs can’t be read, the button falls back to the v1 site', async function (assert) {
    let realmServer = getService('realm-server') as any;
    let fakeList = realmServer.listHostURLs;
    let failedReads = 0;
    realmServer.listHostURLs = async () => {
      failedReads++;
      throw new Error('The realm server is unreachable');
    };
    let restore = await withV1Site(V1_URL);
    try {
      await visitPerson();
      await waitUntil(() => failedReads > 0);
      await settled();
      assert.dom(OPEN_SITE).hasAttribute('href', `${V1_URL}${CARD_PATH}`);

      await click(OPEN_SITE, { shiftKey: true });
      assert
        .dom(`[data-test-published-realm-item="${V1_URL}${CARD_PATH}"]`)
        .exists();
      assert.dom('[data-test-open-site-host-url]').doesNotExist();
      assert
        .dom('[data-test-open-site-group]')
        .doesNotExist('with only the v1 sites, the list has no headings');
    } finally {
      realmServer.listHostURLs = fakeList;
      restore();
    }
  });
});

module('Acceptance | host mode open site, Host Mode v2 off', function (hooks) {
  setupRealm(hooks);

  let fake: FakeHostURLs;

  hooks.beforeEach(function () {
    fake = new FakeHostURLs();
    fake.install();
  });

  hooks.afterEach(function () {
    fake.restore();
  });

  test('reads no host URLs, and the button opens the v1 site', async function (assert) {
    fake.hostURLs = [
      { id: 'a', url: SPACE_URL, kind: 'boxel-space', isCanonical: true },
    ];
    let restore = await withV1Site(V1_URL);
    try {
      await visitPerson();
      await settled();
      assert.dom(OPEN_SITE).hasAttribute('href', `${V1_URL}${CARD_PATH}`);
      await click(OPEN_SITE, { shiftKey: true });
      assert.dom('[data-test-open-site-host-url]').doesNotExist();
      assert.strictEqual(fake.listCalls, 0, 'nothing reads /_host-urls');
    } finally {
      restore();
    }
  });
});
