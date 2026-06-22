import {
  click,
  fillIn,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { TrackedObject } from 'tracked-built-ins';

import { Deferred, baseRealm, param, query } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  getDbAdapter,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  testRealmInfo,
  realmConfigCardJSON,
} from '../helpers';

// Per-user published-realm URL host. Standard mode: `localhost:4201`;
// env mode: `realm-server.<slug>.localhost`. The publishing UI builds
// URLs of the form `https://<username>.<host>/<realm>/` (or
// `<custom-subdomain>.<host>/` for boxel-site claims), so the
// assertions need to derive the host the same way the UI does.
// publishedRealmBoxelSpaceDomain and publishedRealmBoxelSiteDomain are
// distinct in the host config, but in this test environment they
// resolve to the same value, so one const covers both.
const publishedSpaceHost = ENV.publishedRealmBoxelSpaceDomain;

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

import { viewCardDemoCardSource } from '../helpers/cards/view-card-demo';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const personCardSource = `
  import { contains, containsMany, field, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";

  export class Person extends CardDef {
    static displayName = 'Person';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
          <p>Title: <@fields.cardTitle /></p>
      </template>
    };
  }
`;

function withUpdatedTestRealmInfo(
  updates: Partial<typeof testRealmInfo>,
): () => void {
  let realmService = getService('realm') as any;
  let realmResource = realmService.realms.get(testRealmURL);
  if (!realmResource) {
    throw new Error('Test realm resource is not registered');
  }

  let previousInfo = realmResource.info;
  let baseInfo = previousInfo ? { ...previousInfo } : { ...testRealmInfo };

  realmResource.info = new TrackedObject({
    ...baseInfo,
    ...updates,
  });

  return () => {
    realmResource.info = previousInfo;
  };
}

// Stubs the realm-server `allocateUnlistedPath` method (which normally hits the
// server that owns the random slug), returning the given slug(s) — successive
// calls walk the list and then stick on the last entry, so passing two slugs
// covers the initial load + a "New link" regenerate. Returns a restore function.
function stubUnlistedPath(slugs: string | string[]): () => void {
  let realmServer = getService('realm-server') as any;
  let original = realmServer.allocateUnlistedPath;
  let queue = Array.isArray(slugs) ? [...slugs] : [slugs];
  realmServer.allocateUnlistedPath = async (sourceRealmURL: string) => {
    let slug = queue.length > 1 ? queue.shift()! : queue[0];
    return { sourceRealmURL, slug };
  };
  return () => {
    realmServer.allocateUnlistedPath = original;
  };
}

module('Acceptance | host submode', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  setupBaseRealm(hooks);

  let realmContents: any;

  hooks.beforeEach(function () {
    realmContents = {
      ...SYSTEM_CARD_FIXTURE_CONTENTS,
      'index.json': new CardsGrid(),
      'realm.json': realmConfigCardJSON({
        name: 'Test Workspace B',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
      }),
      'person.gts': personCardSource,
      'view-card-demo.gts': viewCardDemoCardSource,
      'Person/1.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'A',
            lastName: 'B',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
      'Person/2.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'B',
            lastName: 'C',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
      'Person/3.json': {
        data: {
          type: 'card',
          attributes: {
            firstName: 'C',
            lastName: 'D',
          },
          meta: {
            adoptsFrom: {
              module: '../person',
              name: 'Person',
            },
          },
        },
      },
      'ViewCardDemo/1.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Primary View Demo',
            targetCardURL: `${testRealmURL}ViewCardDemo/2.json`,
          },
          meta: {
            adoptsFrom: {
              module: '../view-card-demo',
              name: 'ViewCardDemo',
            },
          },
        },
      },
      'ViewCardDemo/2.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Secondary View Demo',
            targetCardURL: `${testRealmURL}ViewCardDemo/3.json`,
          },
          meta: {
            adoptsFrom: {
              module: '../view-card-demo',
              name: 'ViewCardDemo',
            },
          },
        },
      },
      'ViewCardDemo/3.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Tertiary View Demo',
            targetCardURL: `${testRealmURL}ViewCardDemo/1.json`,
          },
          meta: {
            adoptsFrom: {
              module: '../view-card-demo',
              name: 'ViewCardDemo',
            },
          },
        },
      },
    };
  });

  module('with a dangling host routing rule', function (hooks) {
    hooks.beforeEach(async function () {
      let dbAdapter = await getDbAdapter();
      await query(dbAdapter, [
        `INSERT INTO realm_metadata (url, publishable) VALUES (`,
        param(testRealmURL),
        `,`,
        param(true),
        `) ON CONFLICT (url) DO UPDATE SET publishable = true`,
      ]);
      // A `/` routing rule whose target card was never created, so the
      // `instance` link dangles.
      realmContents['realm.json'] = {
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Test Workspace B' },
            hostRoutingRules: [{ path: '/' }],
          },
          relationships: {
            'hostRoutingRules.0.instance': {
              links: { self: './does-not-exist' },
            },
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
      };
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('publish modal warns that a routing rule points to a missing card', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      await click('[data-test-publish-realm-button]');
      await waitFor('[data-test-publish-realm-modal]');
      await waitFor('[data-test-dangling-routing-warning]');
      assert
        .dom('[data-test-dangling-routing-warning]')
        .exists('the dangling-routing warning shows in the publish modal');
      assert
        .dom('[data-test-dangling-routing-warning]')
        .containsText(
          'does-not-exist',
          'the warning names the missing routing target',
        );
    });
  });

  module('with a realm that is not publishable', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('host submode is not available', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').doesNotExist();
    });

    test('visiting host submode via query parameter shows a button to interact submode', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        stacks: [[{ id: `${testRealmURL}Person/1.json`, format: 'isolated' }]],
      });
      await click('[data-test-switch-to-interact]');

      assert.dom('[data-test-submode-switcher]').hasText('Interact');
      assert.dom(`[data-test-stack-card="${testRealmURL}Person/1"]`).exists();
    });
  });

  module('with a realm that is publishable', function (hooks) {
    hooks.beforeEach(async function () {
      // CS-10053: publishable lives in realm_metadata now. Seed the row
      // BEFORE setupAcceptanceTestRealm so parseRealmInfo's first read
      // (which gets cached) sees publishable: true.
      let dbAdapter = await getDbAdapter();
      await query(dbAdapter, [
        `INSERT INTO realm_metadata (url, publishable) VALUES (`,
        param(testRealmURL),
        `,`,
        param(true),
        `) ON CONFLICT (url) DO UPDATE SET publishable = true`,
      ]);
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('host submode is available', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').exists();
    });

    test('search is not present', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('[data-test-open-search-field]').doesNotExist();
    });

    test('entering from interact mode stays on the same card', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id: `${testRealmURL}Person/1.json`, format: 'isolated' }]],
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-host-mode-card]').exists();
      assert.dom('[data-test-host-mode-card]').hasText('Title: A B');
    });

    test('entering from code mode shows the index card', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-host-mode-card]').exists();
      // CardsGrid should be rendered (index card)
      assert.dom('.boxel-card-container').exists();
    });

    test('entering from code mode with card instance shows the same card', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-host-mode-card]').exists();
      assert.dom('[data-test-host-mode-card]').hasText('Title: A B');
    });

    test('clicking a card in card list stacks it', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}index.json`], // CardsGrid with Person cards
      });

      await click('[data-test-boxel-filter-list-button="All Cards"]');
      // Wait for the cards grid to render
      await waitFor('[data-test-cards-grid-item]');

      // Verify the person card is not in the stack initially
      assert
        .dom(`[data-test-host-mode-stack-item="${testRealmURL}Person/1"]`)
        .doesNotExist();

      // Click on the first person card in the list
      await click(`[data-test-cards-grid-item="${testRealmURL}Person/1"]`);

      // Wait for the card to be added to the stack
      await waitFor(
        `[data-test-host-mode-stack-item="${testRealmURL}Person/1"]`,
      );

      // Verify the card is now in the stack
      assert
        .dom(`[data-test-host-mode-stack-item="${testRealmURL}Person/1"]`)
        .exists();

      // Verify the card content is rendered
      assert
        .dom(`[data-test-host-mode-stack-item="${testRealmURL}Person/1"]`)
        .hasText('Title: A B');
    });

    test('wide format cards use full width', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}index.json`], // CardsGrid has prefersWideFormat = true
      });

      assert.dom('.host-mode-content').hasClass('is-wide');
      // The width is applied via CSS class, not inline style
      assert.dom('.host-mode-content.is-wide').exists();
    });

    test('regular format cards use standard width', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('.host-mode-content').doesNotHaveClass('is-wide');
      // The width is applied via CSS class, not inline style
      assert.dom('.host-mode-content:not(.is-wide)').exists();
    });

    test('viewCard stacks the linked card in host submode', async function (assert) {
      let targetStackId = `${testRealmURL}ViewCardDemo/2`;

      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}ViewCardDemo/1.json`],
      });

      assert
        .dom(`[data-test-host-mode-stack-item="${targetStackId}"]`)
        .doesNotExist();

      await waitFor('[data-test-view-card-demo-button]');
      await click('[data-test-view-card-demo-button]');
      await waitFor(`[data-test-host-mode-stack-item="${targetStackId}"]`);

      assert
        .dom(`[data-test-host-mode-stack-item="${targetStackId}"]`)
        .exists();
    });

    test('viewCard tabs maintain state after stacking and closing cards', async function (assert) {
      let primaryCardId = `${testRealmURL}ViewCardDemo/1`;
      let firstStackCardId = `${testRealmURL}ViewCardDemo/2`;
      let secondStackCardId = `${testRealmURL}ViewCardDemo/3`;

      await visitOperatorMode({
        submode: 'host',
        trail: [`${primaryCardId}.json`],
      });

      let primaryCardSelector = `[data-test-host-mode-card="${primaryCardId}"]`;
      await waitFor(
        `${primaryCardSelector} [data-test-view-card-demo-active-tab]`,
      );
      await waitFor(`${primaryCardSelector} [data-test-view-card-demo-button]`);
      assert
        .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

      await click(
        `${primaryCardSelector} [data-test-view-card-demo-tab="details"]`,
      );

      assert
        .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'details');

      await click(`${primaryCardSelector} [data-test-view-card-demo-button]`);

      let firstStackSelector = `[data-test-host-mode-stack-item="${firstStackCardId}"]`;
      await waitFor(
        `${firstStackSelector} [data-test-view-card-demo-active-tab]`,
      );
      await waitFor(`${firstStackSelector} [data-test-view-card-demo-button]`);
      await waitFor(firstStackSelector);

      assert
        .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'overview');

      await click(
        `${firstStackSelector} [data-test-view-card-demo-tab="history"]`,
      );

      assert
        .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'history');

      await click(`${firstStackSelector} [data-test-view-card-demo-button]`);

      let secondStackSelector = `[data-test-host-mode-stack-item="${secondStackCardId}"]`;
      await waitFor(`${secondStackSelector} [data-test-view-card-demo-button]`);
      await waitFor(secondStackSelector);

      await click(`[data-test-host-mode-breadcrumb="${firstStackCardId}"]`);

      await waitUntil(() => {
        return !document.querySelector(secondStackSelector);
      });

      assert
        .dom(`${firstStackSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'history');

      await click(`[data-test-host-mode-breadcrumb="${primaryCardId}"]`);

      await waitUntil(() => {
        return !document.querySelector(firstStackSelector);
      });

      assert
        .dom(`${primaryCardSelector} [data-test-view-card-demo-active-tab]`)
        .hasAttribute('data-test-view-card-demo-active-tab', 'details');
    });

    test('breadcrumbs can close stacked cards', async function (assert) {
      let card1Id = `${testRealmURL}Person/1`;
      let card2Id = `${testRealmURL}index`;
      let card3Id = `${testRealmURL}Person/2`;

      await visitOperatorMode({
        submode: 'host',
        trail: [`${card1Id}.json`, `${card2Id}.json`, `${card3Id}.json`],
      });

      await waitFor(`[data-test-host-mode-card="${card1Id}"]`);

      assert.dom('[data-test-host-mode-breadcrumb]').exists({ count: 3 });
      assert.dom(`[data-test-host-mode-stack-item="${card2Id}"]`).exists();
      assert.dom(`[data-test-host-mode-stack-item="${card3Id}"]`).exists();

      await click(`[data-test-host-mode-breadcrumb="${card2Id}"]`);

      await waitUntil(() => {
        return !document.querySelector(
          `[data-test-host-mode-stack-item="${card3Id}"]`,
        );
      });

      assert.dom('[data-test-host-mode-breadcrumb]').exists({ count: 2 });
      assert.dom(`[data-test-host-mode-card="${card1Id}"]`).exists();
      assert.dom(`[data-test-host-mode-stack-item="${card2Id}"]`).exists();

      await click(`[data-test-host-mode-breadcrumb="${card1Id}"]`);

      await waitUntil(() => {
        return !document.querySelector('[data-test-host-mode-stack-item]');
      });

      assert.dom(`[data-test-host-mode-card="${card1Id}"]`).exists();
      assert.dom('[data-test-host-mode-breadcrumb]').doesNotExist();
      assert.dom('[data-test-host-mode-breadcrumbs]').doesNotExist();
    });

    test('breadcrumb item shows loading state before card is available', async function (assert) {
      let card1Id = `${testRealmURL}Person/1`;
      let card2Id = `${testRealmURL}index`;
      let card3Id = `${testRealmURL}Person/2`;
      let network = getService('network');

      let handler = async (request: Request) => {
        if (request.url.includes(card3Id)) {
          await waitFor(`[data-test-host-mode-breadcrumb="${card3Id}"]`);
          assert
            .dom(`[data-test-host-mode-breadcrumb="${card3Id}"] .label`)
            .hasText('Loading…');
          return null;
        }
        return null;
      };
      network.mount(handler, { prepend: true });

      try {
        await visitOperatorMode({
          submode: 'host',
          trail: [`${card1Id}.json`, `${card2Id}.json`, `${card3Id}.json`],
        });

        await waitUntil(() => {
          let label = document
            .querySelector(
              `[data-test-host-mode-breadcrumb="${card3Id}"] .label`,
            )
            ?.textContent?.trim();
          return label === 'B C';
        });

        assert
          .dom(`[data-test-host-mode-breadcrumb="${card3Id}"] .label`)
          .hasText('B C');
      } finally {
        network.resetState();
      }
    });

    test('shows error state when card is not found', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}nonexistent.json`],
      });

      await waitFor('[data-test-host-mode-404]');
      assert.dom('[data-test-host-mode-404]').exists();
    });

    test('ai assistant is not displayed in host submode', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
        stacks: [[{ id: `${testRealmURL}Person/1.json`, format: 'isolated' }]],
        aiAssistantOpen: true,
      });

      assert.dom('[data-test-open-ai-assistant]').exists();
      assert.dom('[data-test-ai-assistant-panel]').exists();

      await click('[data-test-submode-switcher-button]');
      await click('[data-test-boxel-menu-item-text="Interact"]');
      assert.dom('[data-test-open-ai-assistant]').exists();
      assert.dom('[data-test-ai-assistant-panel]').exists();

      await click('[data-test-submode-switcher-button]');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-open-ai-assistant]').doesNotExist();
      assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

      await click('[data-test-submode-switcher-button]');
      await click('[data-test-boxel-menu-item-text="Code"]');
      assert.dom('[data-test-open-ai-assistant]').exists();
      assert.dom('[data-test-ai-assistant-panel]').exists();
    });

    module('publish and unpublish realm', function (hooks) {
      let publishDeferred: Deferred<void>;
      let unpublishDeferred: Deferred<void>;

      hooks.beforeEach(function () {
        publishDeferred = new Deferred<void>();
        unpublishDeferred = new Deferred<void>();

        let publishRealm = async (
          sourceRealmURL: string,
          publishedRealmURL: string,
        ) => {
          await publishDeferred.promise;
          return {
            sourceRealmURL,
            publishedRealmURL,
            publishedRealmId: '1',
            lastPublishedAt: String(new Date().getTime()),
            status: 'published',
          };
        };

        let unpublishRealm = async (publishedRealmURL: string) => {
          await unpublishDeferred.promise;
          return {
            sourceRealmURL: null,
            publishedRealmURL,
            lastPublishedAt: null,
          };
        };

        getService('realm-server').publishRealm = publishRealm;
        getService('realm-server').unpublishRealm = unpublishRealm;
        // The publish modal asks the server for the unlisted-link slug on open;
        // default it so the unlisted card renders a URL (not a stuck "Generating
        // link…") in tests that don't exercise it. Tests that do use
        // `stubUnlistedPath` to control the slug.
        getService('realm-server').allocateUnlistedPath = async (
          sourceRealmURL: string,
        ) => ({ sourceRealmURL, slug: 'defaultunlistedab' });
      });

      test('can publish realm', async function (assert) {
        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        assert.dom('[data-test-publish-realm-button]').hasText('Publish Site');
        await click('[data-test-publish-realm-button]');
        assert.dom('[data-test-publish-realm-modal]').exists();

        assert.dom('[data-test-last-published-at]').doesNotExist();
        assert.dom('[data-test-unpublish-button]').doesNotExist();
        assert.dom('[data-test-open-site-button]').doesNotExist();
        assert.dom('[data-test-default-domain-checkbox]').isNotChecked();
        assert.dom('[data-test-publish-button]').isDisabled();

        await click('[data-test-default-domain-checkbox]');
        assert.dom('[data-test-default-domain-checkbox]').isChecked();
        assert.dom('[data-test-publish-button]').isNotDisabled();

        await click('[data-test-publish-button]');
        assert.dom('[data-test-publish-button]').hasText('Publishing…');
        assert.dom('[data-test-publish-button]').hasAttribute('disabled');

        await waitFor('[data-test-publish-realm-button].publishing');
        assert.dom('[data-test-publish-realm-button]').hasText('Publishing…');
        assert.dom('[data-test-publish-realm-button]').hasClass('publishing');

        await click('[data-test-publish-realm-button]');
        await waitFor('.publishing-realm-popover');
        assert.dom('.publishing-realm-popover').exists();
        assert
          .dom('.publishing-realm-popover')
          .containsText(
            `Publishing to: https://testuser.${publishedSpaceHost}/test/`,
          );
        assert.dom('.publishing-realm-popover').exists();
        assert.dom('.loading-icon').exists();

        publishDeferred.fulfill();

        await waitUntil(() => {
          return !document.querySelector(
            '[data-test-publish-realm-button].publishing',
          );
        });

        assert
          .dom('[data-test-publish-realm-button]')
          .hasText('Republish Site');
        assert
          .dom('[data-test-publish-realm-button]')
          .doesNotHaveClass('publishing');
        assert.dom('.publishing-realm-popover').doesNotExist();

        await click('[data-test-publish-realm-button]');

        assert.dom('[data-test-last-published-at]').exists();
        assert.dom('[data-test-last-published-at]').containsText('Published');
        assert.dom('[data-test-unpublish-button]').exists();
        assert.dom('[data-test-unpublish-button]').containsText('Unpublish');
        assert.dom('[data-test-open-site-button]').exists();
        assert.dom('[data-test-open-site-button]').containsText('Open Site');

        assert
          .dom(
            '[data-test-publish-realm-modal] [data-test-open-boxel-space-button]',
          )
          .hasAttribute('href', `https://testuser.${publishedSpaceHost}/test/`)
          .hasAttribute('target', '_blank');
      });

      test('preselects previously published domains on refresh', async function (assert) {
        let now = Date.now();
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `custom-site-name.${publishedSpaceHost}`,
          subdomain: 'custom-site-name',
          sourceRealmURL: testRealmURL,
        });

        let restoreRealmInfo = withUpdatedTestRealmInfo({
          lastPublishedAt: {
            [`https://testuser.${publishedSpaceHost}/test/`]: String(now),
            [`https://custom-site-name.${publishedSpaceHost}/`]: String(now),
          },
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          assert.dom('[data-test-default-domain-checkbox]').isChecked();
          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
          restoreRealmInfo();
        }
      });

      test('default domain checkbox can be checked and unchecked', async function (assert) {
        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        await click('[data-test-publish-realm-button]');

        assert.dom('[data-test-default-domain-checkbox]').isNotChecked();
        assert.dom('[data-test-publish-button]').isDisabled();

        await click('[data-test-default-domain-checkbox]');
        assert.dom('[data-test-default-domain-checkbox]').isChecked();
        assert.dom('[data-test-publish-button]').isNotDisabled();

        await click('[data-test-default-domain-checkbox]');
        assert.dom('[data-test-default-domain-checkbox]').isNotChecked();
        assert.dom('[data-test-publish-button]').isDisabled();
      });

      test('can publish an unlisted link', async function (assert) {
        // The server owns the random slug; the modal just renders what the
        // `_unlisted-realm-path` endpoint returns.
        let restoreUnlisted = stubUnlistedPath('k7f3qz9pbcdmnpqr');
        let unlistedUrl = `https://testuser.${publishedSpaceHost}/k7f3qz9pbcdmnpqr/`;
        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');
          await waitFor('[data-test-unlisted-link-url]');

          // The unlisted link is the user's own space subdomain with the
          // server-issued slug as the path, not the realm name.
          assert.dom('[data-test-unlisted-link-url]').hasText(unlistedUrl);

          assert.dom('[data-test-unlisted-link-checkbox]').isNotChecked();
          await click('[data-test-unlisted-link-checkbox]');
          assert.dom('[data-test-unlisted-link-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();

          await click('[data-test-publish-button]');
          publishDeferred.fulfill();
          await waitUntil(() => {
            return !document.querySelector(
              '[data-test-publish-realm-button].publishing',
            );
          });

          await click('[data-test-publish-realm-button]');
          assert
            .dom(
              '[data-test-publish-realm-modal] [data-test-open-unlisted-link-button]',
            )
            .hasAttribute('href', unlistedUrl)
            .hasAttribute('target', '_blank');
        } finally {
          restoreUnlisted();
        }
      });

      test('unlisted link checkbox can be checked and unchecked', async function (assert) {
        let restoreUnlisted = stubUnlistedPath('k7f3qz9pbcdmnpqr');
        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-unlisted-link-url]');

          assert.dom('[data-test-unlisted-link-checkbox]').isNotChecked();
          assert.dom('[data-test-publish-button]').isDisabled();

          await click('[data-test-unlisted-link-checkbox]');
          assert.dom('[data-test-unlisted-link-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();

          await click('[data-test-unlisted-link-checkbox]');
          assert.dom('[data-test-unlisted-link-checkbox]').isNotChecked();
          assert.dom('[data-test-publish-button]').isDisabled();
        } finally {
          restoreUnlisted();
        }
      });

      test('can regenerate the unlisted link before publishing', async function (assert) {
        let restoreUnlisted = stubUnlistedPath([
          'firstslug00000000',
          'secondslug0000000',
        ]);
        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-unlisted-link-url]');

          assert
            .dom('[data-test-unlisted-link-url]')
            .hasText(
              `https://testuser.${publishedSpaceHost}/firstslug00000000/`,
            );

          await click('[data-test-regenerate-unlisted-link-button]');

          assert
            .dom('[data-test-unlisted-link-url]')
            .hasText(
              `https://testuser.${publishedSpaceHost}/secondslug0000000/`,
            );
        } finally {
          restoreUnlisted();
        }
      });

      test('shows an error with retry when loading the unlisted link fails', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let original = realmServer.allocateUnlistedPath;
        let shouldFail = true;
        realmServer.allocateUnlistedPath = async (sourceRealmURL: string) => {
          if (shouldFail) {
            throw new Error('allocate failed');
          }
          return { sourceRealmURL, slug: 'k7f3qz9pbcdmnpqr' };
        };

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-unlisted-link-error]');

          // Errored, not stuck pretending to still be loading.
          assert.dom('[data-test-unlisted-link-loading]').doesNotExist();
          assert.dom('[data-test-unlisted-link-checkbox]').isDisabled();
          assert.dom('[data-test-retry-unlisted-link-button]').exists();

          // Retry recovers once the server responds.
          shouldFail = false;
          await click('[data-test-retry-unlisted-link-button]');
          await waitFor('[data-test-unlisted-link-url]');

          assert.dom('[data-test-unlisted-link-error]').doesNotExist();
          assert
            .dom('[data-test-unlisted-link-url]')
            .hasText(
              `https://testuser.${publishedSpaceHost}/k7f3qz9pbcdmnpqr/`,
            );
          assert.dom('[data-test-unlisted-link-checkbox]').isNotChecked();
          assert.dom('[data-test-unlisted-link-checkbox]').isNotDisabled();
        } finally {
          realmServer.allocateUnlistedPath = original;
        }
      });

      test('preselects a previously published unlisted link on refresh', async function (assert) {
        let now = Date.now();
        let slug = 'k7f3qz9pbcdmnpqr';
        let unlistedUrl = `https://testuser.${publishedSpaceHost}/${slug}/`;

        // The server returns the realm's existing slug, so the modal shows the
        // same URL that was previously published.
        let restoreUnlisted = stubUnlistedPath(slug);
        let restoreRealmInfo = withUpdatedTestRealmInfo({
          lastPublishedAt: {
            [unlistedUrl]: String(now),
          },
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');
          await waitFor('[data-test-unlisted-link-url]');

          assert.dom('[data-test-unlisted-link-url]').hasText(unlistedUrl);
          assert.dom('[data-test-unlisted-link-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();
        } finally {
          restoreRealmInfo();
          restoreUnlisted();
        }
      });

      test('can unpublish realm', async function (assert) {
        let restoreRealmInfo = withUpdatedTestRealmInfo({
          lastPublishedAt: {
            [`https://testuser.${publishedSpaceHost}/test/`]: (
              new Date().getTime() -
              3 * 24 * 60 * 60 * 1000
            ).toString(),
          },
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          assert
            .dom('[data-test-last-published-at]')
            .containsText('3 days ago');
          assert.dom('[data-test-unpublish-button]').exists();
          assert.dom('[data-test-open-site-button]').exists();
          await click('[data-test-unpublish-button]');
          assert.dom('[data-test-unpublish-button]').hasText('Unpublishing…');
          unpublishDeferred.fulfill();
          await waitUntil(() => {
            return !document.querySelector('[data-test-unpublish-button]');
          });

          assert.dom('[data-test-last-published-at]').doesNotExist();
          assert.dom('[data-test-unpublish-button]').doesNotExist();
          assert.dom('[data-test-open-site-button]').doesNotExist();
        } finally {
          restoreRealmInfo();
        }
      });

      test('open site button only appears when realm is published', async function (assert) {
        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        assert.dom('[data-test-open-site-button]').doesNotExist();
      });

      test('can claim domain for boxel site', async function (assert) {
        let mockDomainValidationResponse = async (request: Request) => {
          if (!request.url.includes('_check-boxel-domain-availability')) {
            return null;
          }

          return new Response(
            JSON.stringify({
              available: true,
              domain: 'my-boxel-site.localhost',
            }),
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        };

        let mockClaimedDomainResponse = async (request: Request) => {
          if (
            request.method !== 'POST' ||
            !request.url.includes('_boxel-claimed-domains')
          ) {
            return null;
          }

          return new Response(
            JSON.stringify({
              data: {
                type: 'claimed-domain',
                id: '1',
                attributes: {
                  hostname: 'my-boxel-site.localhost',
                  subdomain: 'my-boxel-site',
                  sourceRealmURL: testRealmURL,
                },
              },
            }),
            {
              headers: {
                'Content-Type': 'application/vnd.api+json',
              },
            },
          );
        };

        getService('network').mount(mockDomainValidationResponse, {
          prepend: true,
        });
        getService('network').mount(mockClaimedDomainResponse, {
          prepend: true,
        });

        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        await click('[data-test-publish-realm-button]');

        assert.dom('[data-test-custom-subdomain-input]').doesNotExist();
        await click('[data-test-custom-subdomain-setup-button]');
        assert.dom('[data-test-boxel-button]').isDisabled();

        await fillIn(
          '[data-test-custom-subdomain-input] input',
          'my-boxel-site',
        );
        assert.dom('[data-test-claim-custom-subdomain-button]').isNotDisabled();
        await click('[data-test-claim-custom-subdomain-button]');

        assert.dom('[data-test-custom-subdomain-cancel]').doesNotExist();
        assert.dom('[data-test-custom-subdomain-setup-button]').doesNotExist();
        assert
          .dom('[data-test-custom-subdomain-details]')
          .includesText(
            `https://my-boxel-site.${publishedSpaceHost}/ Not published yet`,
          );
        assert.dom('[data-test-unclaim-custom-subdomain-button]').exists();
        assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
      });

      test('shows error when claiming domain fails with 422', async function (assert) {
        let mockDomainValidationResponse = async (request: Request) => {
          if (!request.url.includes('_check-boxel-domain-availability')) {
            return null;
          }

          return new Response(
            JSON.stringify({
              available: true,
              domain: 'my-boxel-site.localhost',
            }),
            {
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        };

        let mockClaimedDomainError = async (request: Request) => {
          if (
            request.method !== 'POST' ||
            !request.url.includes('_boxel-claimed-domains')
          ) {
            return null;
          }

          return new Response('There was an error claiming this domain', {
            status: 422,
            headers: {
              'Content-Type': 'application/vnd.api+json',
            },
          });
        };

        getService('network').mount(mockDomainValidationResponse, {
          prepend: true,
        });
        getService('network').mount(mockClaimedDomainError, {
          prepend: true,
        });

        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        await click('[data-test-publish-realm-button]');
        await click('[data-test-custom-subdomain-setup-button]');
        await fillIn(
          '[data-test-custom-subdomain-input] input',
          'my-boxel-site',
        );
        await click('[data-test-claim-custom-subdomain-button]');

        // Should still show the setup UI since claiming failed
        assert.dom('[data-test-custom-subdomain-cancel]').exists();
        assert.dom('[data-test-custom-subdomain-input]').exists();

        // Should display the error message (extracted from the response)
        assert
          .dom('[data-test-boxel-input-group-error-message]')
          .hasText('There was an error claiming this domain');
      });

      test('open site popover shows published realms and opens them correctly', async function (assert) {
        let now = Date.now();
        let restoreRealmInfo = withUpdatedTestRealmInfo({
          lastPublishedAt: {
            [`https://testuser.${publishedSpaceHost}/test/`]: String(now),
            'https://another-domain.com/realm/': String(now - 1000),
          },
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          // Check that the main button has the correct href
          assert
            .dom('[data-test-open-site-button]')
            .hasAttribute(
              'href',
              `https://testuser.${publishedSpaceHost}/test/Person/1`,
            )
            .hasAttribute('target', '_blank');

          await triggerEvent('[data-test-open-site-button]', 'mouseenter');
          await waitFor('[data-test-tooltip-content]');
          assert
            .dom('[data-test-tooltip-content]')
            .hasText(
              'Open Site in a New Tab (Shift+Click for options)',
              'Tooltip shows correct text when menu is closed',
            );

          assert.dom('[data-test-open-site-popover]').doesNotExist();

          await click('[data-test-open-site-button]', { shiftKey: true });

          assert.dom('[data-test-open-site-popover]').exists();
          assert.dom('[data-test-published-realm-item]').exists({ count: 2 });

          assert
            .dom(
              '[data-test-published-realm-item] [data-test-open-site-button]',
            )
            .exists({ count: 2 });

          assert
            .dom(
              `[data-test-published-realm-item="https://testuser.${publishedSpaceHost}/test/Person/1"]`,
            )
            .exists();
          assert
            .dom(
              '[data-test-published-realm-item="https://another-domain.com/realm/Person/1"]',
            )
            .exists();

          // Check that popover buttons have correct href attributes
          assert
            .dom(
              `[data-test-published-realm-item="https://testuser.${publishedSpaceHost}/test/Person/1"] [data-test-open-site-button]`,
            )
            .hasAttribute(
              'href',
              `https://testuser.${publishedSpaceHost}/test/Person/1`,
            )
            .hasAttribute('target', '_blank');

          assert
            .dom(
              '[data-test-published-realm-item="https://another-domain.com/realm/Person/1"] [data-test-open-site-button]',
            )
            .hasAttribute('href', 'https://another-domain.com/realm/Person/1')
            .hasAttribute('target', '_blank');
        } finally {
          restoreRealmInfo();
        }
      });

      test('claimed custom site name displays details and reverts after unclaim', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;
        let originalDeleteClaimed = realmServer.deleteBoxelClaimedDomain;

        let deleteCalled = false;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `custom-site-name.${publishedSpaceHost}`,
          subdomain: 'custom-site-name',
          sourceRealmURL: testRealmURL,
        });

        realmServer.deleteBoxelClaimedDomain = async () => {
          deleteCalled = true;
          realmServer.fetchBoxelClaimedDomain = async () => null;
        };

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          let customDomainOption =
            '[data-test-publish-realm-modal] .domain-option:nth-of-type(3)';
          await waitFor(`${customDomainOption} .realm-icon`);

          assert
            .dom(`${customDomainOption} .realm-icon`)
            .exists('shows realm icon when site name is claimed');
          assert
            .dom(`${customDomainOption} .domain-url`)
            .hasText(
              `https://custom-site-name.${publishedSpaceHost}/`,
              'shows claimed custom site URL',
            );
          assert
            .dom('[data-test-unclaim-custom-subdomain-button]')
            .exists('shows unclaim button when domain is claimed');
          assert
            .dom('[data-test-custom-subdomain-setup-button]')
            .doesNotExist('setup button hidden while domain is claimed');

          await click('[data-test-unclaim-custom-subdomain-button]');
          assert.true(deleteCalled, 'unclaim endpoint invoked');

          await waitUntil(() => {
            return (
              !document.querySelector(`${customDomainOption} .realm-icon`) &&
              document.querySelector(
                '[data-test-custom-subdomain-setup-button]',
              )
            );
          });

          assert
            .dom('[data-test-custom-subdomain-setup-button]')
            .exists('setup button returns after unclaim');
          assert
            .dom('[data-test-unclaim-custom-subdomain-button]')
            .doesNotExist('unclaim button removed after unclaim');
          assert
            .dom(`${customDomainOption} .domain-url`)
            .hasText(
              `https://custom-site-name.${publishedSpaceHost}/`,
              'displays placeholder custom site URL after unclaim',
            );
          assert
            .dom('[data-test-boxel-input-validation-state="valid"]')
            .doesNotExist('validation check mark not displayed after unclaim');
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
          realmServer.deleteBoxelClaimedDomain = originalDeleteClaimed;
        }
      });

      test('claimed custom domain is preselected even before first publish', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;
        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `custom-site-name.${publishedSpaceHost}`,
          subdomain: 'custom-site-name',
          sourceRealmURL: testRealmURL,
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert.dom('[data-test-default-domain-checkbox]').isNotChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });

      test('custom site checkbox can be checked and unchecked', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `custom-site-name.${publishedSpaceHost}`,
          subdomain: 'custom-site-name',
          sourceRealmURL: testRealmURL,
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-custom-subdomain-checkbox]');

          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();

          await click('[data-test-custom-subdomain-checkbox]'); // uncheck
          assert.dom('[data-test-custom-subdomain-checkbox]').isNotChecked();
          assert.dom('[data-test-publish-button]').isDisabled();

          await click('[data-test-custom-subdomain-checkbox]'); // re-check
          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert.dom('[data-test-publish-button]').isNotDisabled();
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });

      test('shows inline error when publishing to a domain fails', async function (assert) {
        let publishError = new Deferred<void>();

        let publishRealm = async () => {
          await publishError.promise;
          throw new Error('Network error: Failed to publish realm');
        };

        getService('realm-server').publishRealm = publishRealm;

        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        await click('[data-test-publish-realm-button]');
        assert.dom('[data-test-publish-realm-modal]').exists();

        let defaultUrl = `https://testuser.${publishedSpaceHost}/test/`;
        assert
          .dom(`[data-test-domain-publish-error="${defaultUrl}"]`)
          .doesNotExist();

        await click('[data-test-default-domain-checkbox]');
        await click('[data-test-publish-button]');

        publishError.reject(
          new Error('Network error: Failed to publish realm'),
        );

        await waitFor(`[data-test-domain-publish-error="${defaultUrl}"]`);

        // Error should appear inline on the domain option
        assert.dom(`[data-test-domain-publish-error="${defaultUrl}"]`).exists();
        assert
          .dom(`[data-test-domain-publish-error="${defaultUrl}"] .error-text`)
          .hasText('Network error: Failed to publish realm');

        // Verify the modal stays open when there's an error
        assert.dom('[data-test-publish-realm-modal]').exists();
      });

      test('shows inline error for failed domain while allowing successful ones', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;
        let originalPublishRealm = realmServer.publishRealm;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `my-custom-site.${publishedSpaceHost}`,
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        let defaultUrl = `https://testuser.${publishedSpaceHost}/test/`;
        let customUrl = `https://my-custom-site.${publishedSpaceHost}/`;

        // Mock publish to succeed for default, fail for custom
        realmServer.publishRealm = async (
          _sourceURL: string,
          publishedURL: string,
        ) => {
          await publishDeferred.promise;
          if (publishedURL === customUrl) {
            throw new Error('Custom domain validation failed');
          }
          return {
            sourceRealmURL: _sourceURL,
            publishedRealmURL: publishedURL,
            publishedRealmId: '1',
            lastPublishedAt: String(new Date().getTime()),
            status: 'published',
          };
        };

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert.dom('[data-test-default-domain-checkbox]').isNotChecked();

          // Check default checkbox (custom already selected)
          await click('[data-test-default-domain-checkbox]');

          await click('[data-test-publish-button]');
          publishDeferred.fulfill();

          await waitUntil(() => {
            return !document.querySelector(
              '[data-test-publish-realm-button].publishing',
            );
          });

          await click('[data-test-publish-realm-button]');

          // Default domain should show as published (success)
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(1)',
            )
            .containsText('Published');

          // Custom domain should show error (failure)
          assert
            .dom(`[data-test-domain-publish-error="${customUrl}"]`)
            .exists();
          assert
            .dom(`[data-test-domain-publish-error="${customUrl}"] .error-text`)
            .hasText('Custom domain validation failed');

          // Default domain should NOT have error
          assert
            .dom(`[data-test-domain-publish-error="${defaultUrl}"]`)
            .doesNotExist();
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
          realmServer.publishRealm = originalPublishRealm;
        }
      });

      test('can publish claimed domain', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `my-custom-site.${publishedSpaceHost}`,
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          // Custom is preselected; add default checkbox
          await click('[data-test-default-domain-checkbox]');

          assert.dom('[data-test-default-domain-checkbox]').isChecked();
          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();

          await click('[data-test-publish-button]');
          assert.dom('[data-test-publish-button]').hasText('Publishing…');

          publishDeferred.fulfill();

          await waitUntil(() => {
            return !document.querySelector(
              '[data-test-publish-realm-button].publishing',
            );
          });

          await click('[data-test-publish-realm-button]');

          // Both domains should show as published
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(1)',
            )
            .containsText('Published');
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(3)',
            )
            .containsText('Published');

          // Both should have unpublish buttons
          assert.dom('[data-test-unpublish-button]').exists();
          assert.dom('[data-test-unpublish-custom-subdomain-button]').exists();

          // Custom subdomain should have Open Site button
          await waitFor('[data-test-open-custom-subdomain-button]');
          assert.dom('[data-test-open-custom-subdomain-button]').exists();

          assert
            .dom('[data-test-open-custom-subdomain-button]')
            .hasAttribute(
              'href',
              `https://my-custom-site.${publishedSpaceHost}/`,
            )
            .hasAttribute('target', '_blank');
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });

      test('custom subdomain checkbox is checked when modal opens with claimed domain', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `my-custom-site.${publishedSpaceHost}`,
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          assert.dom('[data-test-custom-subdomain-checkbox]').isChecked();
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(3)',
            )
            .containsText('Not published yet');

          // User can still manually select it
          await click('[data-test-custom-subdomain-checkbox]');
          assert.dom('[data-test-custom-subdomain-checkbox]').isNotChecked();
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });

      test('can unpublish claimed domain', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: `my-custom-site.${publishedSpaceHost}`,
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        let restoreRealmInfo = withUpdatedTestRealmInfo({
          lastPublishedAt: {
            [`https://my-custom-site.${publishedSpaceHost}/`]: (
              new Date().getTime() -
              2 * 24 * 60 * 60 * 1000
            ).toString(),
          },
        });

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          // Custom subdomain should show as published
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(3) .last-published-at',
            )
            .containsText('Published 2 days ago');

          assert.dom('[data-test-unpublish-custom-subdomain-button]').exists();

          await click('[data-test-unpublish-custom-subdomain-button]');
          assert
            .dom('[data-test-unpublish-custom-subdomain-button]')
            .hasText('Unpublishing…');

          unpublishDeferred.fulfill();

          await waitUntil(() => {
            return !document.querySelector(
              '[data-test-unpublish-custom-subdomain-button]',
            );
          });

          // Should show "Not published yet" after unpublishing
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(3) .not-published-yet',
            )
            .exists();
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(3)',
            )
            .containsText('Not published yet');
        } finally {
          restoreRealmInfo();
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });
    });
  });
});
