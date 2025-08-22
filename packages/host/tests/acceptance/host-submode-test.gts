import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';

import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';

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
  let originalFetchSubscriptionData: any;

  hooks.beforeEach(function () {
    realmContents = {
      'index.json': new CardsGrid(),
      '.realm.json': {
        name: 'Test Workspace B',
        backgroundURL:
          'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
        iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        publishable: false,
      },
      'person.gts': personCardSource,
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
    };

    // Store the original billing service method
    let billingService = getService('billing-service');
    originalFetchSubscriptionData = billingService.fetchSubscriptionData;
    // Mock the fetch here
    billingService.fetchSubscriptionData = async () => {
      return new Response(
        JSON.stringify({
          data: {
            attributes: {
              creditsAvailableInPlanAllowance: 5000,
              creditsIncludedInPlanAllowance: 5000,
              extraCreditsAvailableInBalance: 0,
            },
          },
          included: [
            {
              type: 'plan',
              attributes: {
                name: 'Creator',
                monthlyPrice: 12,
                creditsIncluded: 5000,
              },
            },
          ],
        }),
      );
    };
  });

  hooks.afterEach(function () {
    // Restore the original billing service method
    let billingService = getService('billing-service');
    billingService.fetchSubscriptionData = originalFetchSubscriptionData;
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
        submode: 'code',
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
      assert.dom('[data-test-host-submode-card]').exists();
      assert.dom('[data-test-host-submode-card]').hasText('Title: A B');
    });

    test('entering from code mode shows the index card', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}Person/1.json`,
      });

      await click('[data-test-submode-switcher] button');
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-host-submode-card]').exists();
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
      assert.dom('[data-test-host-submode-card]').exists();
      assert.dom('[data-test-host-submode-card]').hasText('Title: A B');
    });

    test('wide format cards use full width', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}index.json`], // CardsGrid has prefersWideFormat = true
      });

      assert.dom('.host-mode-content').hasClass('is-wide');
      assert.dom('.container').hasClass('container');
      // The width is applied via CSS class, not inline style
      assert.dom('.host-mode-content.is-wide').exists();
    });

    test('regular format cards use standard width', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('.host-mode-content').doesNotHaveClass('is-wide');
      assert.dom('.container').hasClass('container');
      // The width is applied via CSS class, not inline style
      assert.dom('.host-mode-content:not(.is-wide)').exists();
    });

    test('shows error state when card is not found', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}nonexistent.json`],
      });

      // Wait for loading to complete and error to show
      await new Promise((resolve) => setTimeout(resolve, 100));

      assert.dom('[data-test-host-submode-error]').exists();
      assert
        .dom('[data-test-host-submode-error]')
        .hasText(`Card not found: ${testRealmURL}nonexistent`);
    });
  });

  module('with subscription-based access control', function (hooks) {
    hooks.beforeEach(async function () {
      let publishableRealmContents = { ...realmContents };
      publishableRealmContents['.realm.json'].publishable = true;

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: publishableRealmContents,
      });
    });

    test('host submode is visible for free plan users but shows upgrade prompt when accessed', async function (assert) {
      let billingService = getService('billing-service');

      // Override with free plan subscription data for this test
      billingService.fetchSubscriptionData = async () => {
        return new Response(
          JSON.stringify({
            data: {
              attributes: {
                creditsAvailableInPlanAllowance: 1000,
                creditsIncludedInPlanAllowance: 1000,
                extraCreditsAvailableInBalance: 0,
              },
            },
            included: [
              {
                type: 'plan',
                attributes: {
                  name: 'Free',
                  monthlyPrice: 0,
                  creditsIncluded: 1000,
                },
              },
            ],
          }),
        );
      };

      await billingService.loadSubscriptionData();

      await visitOperatorMode({
        submode: 'code',
        stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
      });

      // Host option should be visible in the dropdown
      await click('[data-test-submode-switcher] button');
      assert.dom('[data-test-boxel-menu-item-text="Host"]').exists();

      // But when clicked, it should show the upgrade prompt
      await click('[data-test-boxel-menu-item-text="Host"]');
      assert.dom('[data-test-upgrade-subscription]').exists();
      assert
        .dom('.subscription-required-message')
        .containsText('Host mode requires a paid monthly subscription plan');

      // Clicking upgrade button should open subscription modal
      await click('[data-test-upgrade-subscription]');
      assert.dom('[data-test-choose-subscription-plan-modal]').exists();
    });

    test('free plan users see subscription upgrade prompt when accessing host submode directly', async function (assert) {
      let billingService = getService('billing-service');

      // Override with free plan subscription data for this test
      billingService.fetchSubscriptionData = async () => {
        return new Response(
          JSON.stringify({
            data: {
              attributes: {
                creditsAvailableInPlanAllowance: 1000,
                creditsIncludedInPlanAllowance: 1000,
                extraCreditsAvailableInBalance: 0,
              },
            },
            included: [
              {
                type: 'plan',
                attributes: {
                  name: 'Free',
                  monthlyPrice: 0,
                  creditsIncluded: 1000,
                },
              },
            ],
          }),
        );
      };

      await billingService.loadSubscriptionData();

      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('[data-test-upgrade-subscription]').exists();
      assert
        .dom('.subscription-required-message')
        .containsText('Host mode requires a paid monthly subscription plan');

      // Clicking upgrade button should open subscription modal
      await click('[data-test-upgrade-subscription]');
      assert.dom('[data-test-choose-subscription-plan-modal]').exists();
    });

    test('paid plan users can access host submode normally', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        trail: [`${testRealmURL}Person/1.json`],
      });

      assert.dom('[data-test-host-submode-card]').exists();
      assert.dom('[data-test-upgrade-subscription]').doesNotExist();
    });
  });
});
