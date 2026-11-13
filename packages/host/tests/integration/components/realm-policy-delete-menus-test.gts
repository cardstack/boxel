import { waitUntil, waitFor, click, triggerEvent } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  rri,
  type CapabilityCheck,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupOperatorModeStateCleanup,
  realmConfigCardJSON,
} from '../../helpers';

import { setupCatalogTestSubset } from '../../helpers/catalog-test-subset';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';

// A realm that judges the host's requests by its ACL and its policy, as a
// deployed realm does. Its ACL lets the test user only read it, and its policy
// lets them delete a pet but not a toy.
const POLICY_REALM = testRealmURL;
const TEST_USER = '@testuser:localhost';
const REALM_ADMIN = '@realm-admin:localhost';
const MANGO = `${POLICY_REALM}Pet/mango`;
const BEAN = `${POLICY_REALM}Pet/bean`;
const BALL = `${POLICY_REALM}Toy/ball`;

const PET_MODULE = `
  import { contains, field, CardDef } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
  }

  export class Toy extends CardDef {
    static displayName = 'Toy';
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Toy) {
        return this.name;
      },
    });
  }
`;

const petDeletePolicy: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Pets' },
      rules: [
        {
          targetType: { module: `${POLICY_REALM}pet`, name: 'Pet' },
          grants: [{ operation: 'delete' }],
        },
      ],
    },
    meta: {
      adoptsFrom: {
        module: rri('@cardstack/catalog/realm-policy/realm-policy'),
        name: 'RealmPolicy',
      },
    },
  },
};

function instanceOf(name: string, attributes: Record<string, unknown>) {
  return {
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: '../pet', name } },
    },
  };
}

module('Integration | realm policy delete menus', function (hooks) {
  let policyAdapter: TestRealmAdapter;
  let noop = () => {};

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: TEST_USER,
    activeRealms: [POLICY_REALM],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    ({ adapter: policyAdapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: POLICY_REALM,
      enforcePermissions: true,
      permissions: {
        [REALM_ADMIN]: ['read', 'write', 'realm-owner'],
        [TEST_USER]: ['read'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'Pet Shelter',
          policy: `${POLICY_REALM}policies/pets`,
        }),
        'pet.gts': PET_MODULE,
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        'Pet/mango.json': instanceOf('Pet', { name: 'Mango' }),
        'Pet/bean.json': instanceOf('Pet', { name: 'Bean' }),
        'Toy/ball.json': instanceOf('Toy', { name: 'Ball' }),
        'policies/pets.json': petDeletePolicy,
      },
    }));
    await getService('realm').login(POLICY_REALM);
    getService('operator-mode-state-service').restore({
      stacks: [
        [{ type: 'card', id: `${POLICY_REALM}index`, format: 'isolated' }],
      ],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item="${MANGO}"]`);
    await waitFor(`[data-test-cards-grid-item="${BEAN}"]`);
    await waitFor(`[data-test-cards-grid-item="${BALL}"]`);
  });

  function hoverTarget(cardId: string) {
    return `[data-test-cards-grid-item="${cardId}"] .field-component-card`;
  }

  async function selectCard(cardId: string) {
    await triggerEvent(hoverTarget(cardId), 'mouseenter');
    await click(
      `[data-test-overlay-card="${cardId}"] [data-test-overlay-select]`,
    );
    await triggerEvent(hoverTarget(cardId), 'mouseleave');
  }

  // Records the `delete` checks each capability request carries, and passes
  // every request on to the realm.
  function recordDeleteChecks(): string[][] {
    let network = getService('network');
    let sent: string[][] = [];
    let real = network.authedFetch;
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        if (url.endsWith('_capabilities')) {
          let { checks } = JSON.parse(String(init!.body)) as {
            checks: CapabilityCheck[];
          };
          let deletes = checks
            .filter((check) => check.operation === 'delete')
            .map((check) => String(check.target));
          if (deletes.length) {
            sent.push(deletes);
          }
        }
        return await real(url, init);
      },
    });
    return sent;
  }

  test('bulk Delete is offered while every selected card is one the policy lets the user delete', async function (assert) {
    await selectCard(MANGO);
    await click('[data-test-selection-dropdown-trigger]');
    await waitFor('[data-test-boxel-menu-item-text="Delete 1 item"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Delete 1 item"]')
      .exists('the policy lets the user delete the pet they can only read');

    await selectCard(BALL);
    assert.dom('[data-test-selection-dropdown-trigger]').containsText('2');
    await click('[data-test-selection-dropdown-trigger]');
    assert
      .dom('[data-test-boxel-menu-item-text="Deselect All"]')
      .exists('the selection menu is open');
    assert
      .dom('[data-test-boxel-menu-item-text^="Delete"]')
      .doesNotExist(
        'nothing grants deleting the toy, so the selection offers no Delete',
      );
  });

  test('a selection of only cards the user may not delete offers no Delete', async function (assert) {
    await selectCard(BALL);
    await click('[data-test-selection-dropdown-trigger]');
    assert
      .dom('[data-test-boxel-menu-item-text="Deselect All"]')
      .exists('the selection menu is open');
    assert
      .dom('[data-test-boxel-menu-item-text^="Delete"]')
      .doesNotExist('the toy is offered no Delete');
  });

  test('the cards a selection adds are asked about in one request', async function (assert) {
    await selectCard(MANGO);
    await click('[data-test-selection-dropdown-trigger]');
    await waitFor('[data-test-boxel-menu-item-text="Delete 1 item"]');

    let sent = recordDeleteChecks();
    await click('[data-test-boxel-menu-item-text="Select All"]');
    assert.strictEqual(
      sent.length,
      1,
      'one request asks about every card Select All added',
    );
    let asked = sent[0] ?? [];
    assert.true(asked.includes(BEAN), 'it asks about the pet');
    assert.true(asked.includes(BALL), 'and about the toy');
    await click('[data-test-selection-dropdown-trigger]');
    assert
      .dom('[data-test-boxel-menu-item-text="Deselect All"]')
      .exists('the selection menu is open');
    assert
      .dom('[data-test-boxel-menu-item-text^="Delete"]')
      .doesNotExist('the toy in the selection keeps Delete off the menu');
  });

  test("a grid card's menu offers Delete where the policy grants it, and not where it does not", async function (assert) {
    await triggerEvent(hoverTarget(MANGO), 'mouseenter');
    await click(
      `[data-test-overlay-card="${MANGO}"] [data-test-overlay-more-options]`,
    );
    await waitFor('[data-test-boxel-menu-item-text="Delete"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Delete"]')
      .exists("the pet's menu offers Delete");
    await triggerEvent(hoverTarget(MANGO), 'mouseleave');

    await triggerEvent(hoverTarget(BALL), 'mouseenter');
    await click(
      `[data-test-overlay-card="${BALL}"] [data-test-overlay-more-options]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Card URL"]')
      .exists("the toy's menu is open");
    assert
      .dom('[data-test-boxel-menu-item-text="Delete"]')
      .doesNotExist("the toy's menu offers no Delete");
  });

  test("an open card's own menu offers Delete where the policy grants it, and not where it does not", async function (assert) {
    let state = getService('operator-mode-state-service');
    state.restore({
      stacks: [
        [
          { type: 'card', id: `${POLICY_REALM}index`, format: 'isolated' },
          { type: 'card', id: MANGO, format: 'isolated' },
        ],
      ],
    });
    await waitFor(
      `[data-test-stack-card="${MANGO}"] [data-test-more-options-button]`,
    );
    await click(
      `[data-test-stack-card="${MANGO}"] [data-test-more-options-button]`,
    );
    await waitFor('[data-test-boxel-menu-item-text="Delete"]');
    assert
      .dom('[data-test-boxel-menu-item-text="Delete"]')
      .exists("the pet's own menu offers Delete");
    assert
      .dom('[data-test-boxel-menu-item-text="New Card of This Type"]')
      .doesNotExist('a delete grant lets the user create nothing');

    state.restore({
      stacks: [
        [
          { type: 'card', id: `${POLICY_REALM}index`, format: 'isolated' },
          { type: 'card', id: BALL, format: 'isolated' },
        ],
      ],
    });
    await waitFor(
      `[data-test-stack-card="${BALL}"] [data-test-more-options-button]`,
    );
    await click(
      `[data-test-stack-card="${BALL}"] [data-test-more-options-button]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Copy Card URL"]')
      .exists("the toy's own menu is open");
    assert
      .dom('[data-test-boxel-menu-item-text="Delete"]')
      .doesNotExist("the toy's own menu offers no Delete");
  });

  test('bulk delete deletes a card the policy lets the user delete', async function (assert) {
    await selectCard(MANGO);
    await click('[data-test-selection-dropdown-trigger]');
    await click('[data-test-boxel-menu-item-text="Delete 1 item"]');
    await click('[data-test-confirm-delete-button]');

    await waitUntil(
      () => !document.querySelector(`[data-test-cards-grid-item="${MANGO}"]`),
    );
    assert.strictEqual(
      await policyAdapter.openFile('Pet/mango.json'),
      undefined,
      'the realm admitted the delete its policy grants',
    );
    assert
      .dom(`[data-test-cards-grid-item="${BALL}"]`)
      .exists('the card that was not selected stays');
  });
});
