import {
  click,
  fillIn,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Deferred, baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  testRealmInfo,
} from '../helpers';

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
    @field title = contains(StringField, {
      computeVia: function (this: Person) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
          <p>Title: <@fields.title /></p>
      </template>
    };
  }
`;

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
      '.realm.json': {
        name: 'Test Workspace B',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        publishable: false,
      },
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
            title: 'Primary View Demo',
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
            title: 'Secondary View Demo',
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
            title: 'Tertiary View Demo',
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
      let publishableRealmContents = { ...realmContents };
      publishableRealmContents['.realm.json'].publishable = true;

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: publishableRealmContents,
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

      // Wait for loading to complete and error to show
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.dom('[data-test-host-mode-error]').exists();
      assert
        .dom('[data-test-host-mode-error]')
        .hasText(`Could not find ${testRealmURL}nonexistent`);
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

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Interact"]');
      assert.dom('[data-test-open-ai-assistant]').exists();
      assert.dom('[data-test-ai-assistant-panel]').exists();

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-open-ai-assistant]').doesNotExist();
      assert.dom('[data-test-ai-assistant-panel]').doesNotExist();

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
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
            data: {
              type: 'published_realm',
              id: '1',
              attributes: {
                sourceRealmURL,
                publishedRealmURL,
                lastPublishedAt: new Date().getTime(),
              },
            },
          };
        };

        let unpublishRealm = async (_publishedRealmURL: string) => {
          await unpublishDeferred.promise;
          return { success: true };
        };

        getService('realm-server').publishRealm = publishRealm;
        getService('realm-server').unpublishRealm = unpublishRealm;
      });

      test('can publish realm', async function (assert) {
        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

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
          .containsText(`Publishing to: http://testuser.localhost:4201/test/`);
        assert.dom('.publishing-realm-popover').exists();
        assert.dom('.loading-icon').exists();

        publishDeferred.fulfill();

        await waitUntil(() => {
          return !document.querySelector(
            '[data-test-publish-realm-button].publishing',
          );
        });

        assert.dom('[data-test-publish-realm-button]').hasText('Publish Site');
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
          .hasAttribute('href', 'http://testuser.localhost:4201/test/')
          .hasAttribute('target', '_blank');
      });

      test('can unpublish realm', async function (assert) {
        let mockRealmInfoResponse = async (request: Request) => {
          console.log(request.url);
          if (!request.url.includes('test') || !request.url.includes('_info')) {
            return null;
          }

          return new Response(
            JSON.stringify({
              data: {
                type: 'realm-info',
                id: testRealmURL,
                attributes: {
                  ...testRealmInfo,
                  lastPublishedAt: {
                    ['http://testuser.localhost:4201/test/']: (
                      new Date().getTime() -
                      3 * 24 * 60 * 60 * 1000
                    ).toString(), //3 days ago,
                  },
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
        getService('network').mount(mockRealmInfoResponse, { prepend: true });

        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        await click('[data-test-publish-realm-button]');
        assert.dom('[data-test-last-published-at]').containsText('3 days ago');
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
        getService('network').resetState();
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
            'http://my-boxel-site.localhost:4201/ Not published yet',
          );
        assert.dom('[data-test-unclaim-custom-subdomain-button]').exists();
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
        // Mock realm info with published state
        let mockRealmInfoResponse = async (request: Request) => {
          if (!request.url.includes('test') || !request.url.includes('_info')) {
            return null;
          }

          let now = Date.now();

          return new Response(
            JSON.stringify({
              data: {
                type: 'realm-info',
                id: testRealmURL,
                attributes: {
                  ...testRealmInfo,
                  lastPublishedAt: {
                    'http://testuser.localhost:4201/test/': now,
                    'https://another-domain.com/realm/': now - 1000,
                  },
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
        getService('network').mount(mockRealmInfoResponse, { prepend: true });

        await visitOperatorMode({
          submode: 'host',
          trail: [`${testRealmURL}Person/1.json`],
        });

        // Check that the main button has the correct href
        assert
          .dom('[data-test-open-site-button]')
          .hasAttribute('href', 'http://testuser.localhost:4201/test/Person/1')
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
          .dom('[data-test-published-realm-item] [data-test-open-site-button]')
          .exists({ count: 2 });

        assert
          .dom(
            '[data-test-published-realm-item="http://testuser.localhost:4201/test/Person/1"]',
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
            '[data-test-published-realm-item="http://testuser.localhost:4201/test/Person/1"] [data-test-open-site-button]',
          )
          .hasAttribute('href', 'http://testuser.localhost:4201/test/Person/1')
          .hasAttribute('target', '_blank');

        assert
          .dom(
            '[data-test-published-realm-item="https://another-domain.com/realm/Person/1"] [data-test-open-site-button]',
          )
          .hasAttribute('href', 'https://another-domain.com/realm/Person/1')
          .hasAttribute('target', '_blank');

        getService('network').resetState();
      });

      test('claimed custom site name displays details and reverts after unclaim', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;
        let originalDeleteClaimed = realmServer.deleteBoxelClaimedDomain;

        let deleteCalled = false;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: 'custom-site-name.localhost:4201',
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
            '[data-test-publish-realm-modal] .domain-option:nth-of-type(2)';
          await waitFor(`${customDomainOption} .realm-icon`);

          assert
            .dom(`${customDomainOption} .realm-icon`)
            .exists('shows realm icon when site name is claimed');
          assert
            .dom(`${customDomainOption} .domain-url`)
            .hasText(
              'http://custom-site-name.localhost:4201/',
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
              'http://custom-site-name.localhost:4201/',
              'displays placeholder custom site URL after unclaim',
            );
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
          realmServer.deleteBoxelClaimedDomain = originalDeleteClaimed;
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

        let defaultUrl = 'http://testuser.localhost:4201/test/';
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
          hostname: 'my-custom-site.localhost:4201',
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        let defaultUrl = 'http://testuser.localhost:4201/test/';
        let customUrl = 'http://my-custom-site.localhost:4201/';

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
            data: {
              type: 'published_realm',
              id: '1',
              attributes: {
                sourceRealmURL: _sourceURL,
                publishedRealmURL: publishedURL,
                lastPublishedAt: new Date().getTime(),
              },
            },
          };
        };

        try {
          await visitOperatorMode({
            submode: 'host',
            trail: [`${testRealmURL}Person/1.json`],
          });

          await click('[data-test-publish-realm-button]');
          await waitFor('[data-test-publish-realm-modal]');

          // Check both checkboxes
          await click('[data-test-default-domain-checkbox]');
          await click('[data-test-custom-subdomain-checkbox]');

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
          hostname: 'my-custom-site.localhost:4201',
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

          // Check both checkboxes
          await click('[data-test-default-domain-checkbox]');
          await click('[data-test-custom-subdomain-checkbox]');

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
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(2)',
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
            .hasAttribute('href', 'http://my-custom-site.localhost:4201/index')
            .hasAttribute('target', '_blank');
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
        }
      });

      test('can unpublish claimed domain', async function (assert) {
        let realmServer = getService('realm-server') as any;
        let originalFetchClaimed = realmServer.fetchBoxelClaimedDomain;

        realmServer.fetchBoxelClaimedDomain = async () => ({
          id: 'claimed-domain-1',
          hostname: 'my-custom-site.localhost:4201',
          subdomain: 'my-custom-site',
          sourceRealmURL: testRealmURL,
        });

        let mockRealmInfoResponse = async (request: Request) => {
          if (!request.url.includes('test') || !request.url.includes('_info')) {
            return null;
          }

          return new Response(
            JSON.stringify({
              data: {
                type: 'realm-info',
                id: testRealmURL,
                attributes: {
                  ...testRealmInfo,
                  lastPublishedAt: {
                    ['http://my-custom-site.localhost:4201/']: (
                      new Date().getTime() -
                      2 * 24 * 60 * 60 * 1000
                    ).toString(), //2 days ago
                  },
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
        getService('network').mount(mockRealmInfoResponse, { prepend: true });

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
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(2) .last-published-at',
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
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(2) .not-published-yet',
            )
            .exists();
          assert
            .dom(
              '[data-test-publish-realm-modal] .domain-option:nth-of-type(2)',
            )
            .containsText('Not published yet');
        } finally {
          realmServer.fetchBoxelClaimedDomain = originalFetchClaimed;
          getService('network').resetState();
        }
      });
    });
  });
});
