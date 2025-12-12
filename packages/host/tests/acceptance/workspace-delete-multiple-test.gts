import { click, findAll, triggerEvent, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupSnapshotRealm,
} from '../helpers';
import { setupBaseRealm, CardsGrid } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | workspace-delete-multiple', function (hooks) {
  setupApplicationTest(hooks);

  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;
  let defaultMatrixRoomId: string;
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    acceptanceTest: true,
    async build({ loader, isInitialBuild }) {
      if (isInitialBuild || !defaultMatrixRoomId) {
        defaultMatrixRoomId = createAndJoinRoom({
          sender: '@testuser:localhost',
          name: 'room-test',
        });
      }

      let { field, contains, CardDef, Component } = await loader.import<
        typeof import('https://cardstack.com/base/card-api')
      >(`${baseRealm.url}card-api`);
      let { default: StringField } = await loader.import<
        typeof import('https://cardstack.com/base/string')
      >(`${baseRealm.url}string`);

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
        @field species = contains(StringField);
        @field title = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.name;
          },
        });

        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div data-test-pet>
              <h1><@fields.name /></h1>
              <p>Species: <@fields.species /></p>
            </div>
          </template>
        };
      }

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        loader,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          'pet.gts': { Pet },
          'Pet/1.json': new Pet({
            name: 'Fluffy',
            species: 'Cat',
          }),
          'Pet/2.json': new Pet({
            name: 'Buddy',
            species: 'Dog',
          }),
          'Pet/3.json': new Pet({
            name: 'Charlie',
            species: 'Bird',
          }),
          '.realm.json': {
            name: 'Test Realm',
            backgroundURL: null,
            iconURL: null,
          },
        },
      });
      return {};
    },
  });

  hooks.beforeEach(function () {
    snapshot.get();
  });

  async function selectCard(cardPath: string) {
    let cardSelector = `[data-test-cards-grid-item="${testRealmURL}${cardPath}"] .field-component-card`;
    await triggerEvent(cardSelector, 'mouseenter');
    await waitFor(
      `[data-test-overlay-card="${testRealmURL}${cardPath}"] button.actions-item__button`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}${cardPath}"] button.actions-item__button`,
    );
    await triggerEvent(cardSelector, 'mouseleave');
  }

  test('can select multiple cards and delete them via bulk delete', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // Select All Cards filter and wait for cards to load
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor('[data-test-cards-grid-item]');

    let cards = findAll('[data-test-cards-grid-item]');
    let initialCardCount = cards.length;
    assert.ok(initialCardCount >= 3, 'Multiple cards are available');

    // Enter selection mode by clicking the first card's checkbox
    await selectCard('Pet/1');

    // Verify selection state is active
    assert
      .dom('.utility-menu-trigger')
      .containsText('1 Selected', 'Selection menu appears');

    // Select additional cards
    await selectCard('Pet/2');

    // Verify selection count
    assert.dom('.utility-menu-trigger').containsText('2 Selected');

    // Open utility menu
    await click('.utility-menu-trigger');

    // Click bulk delete option
    await click('[data-test-boxel-menu-item-text="Delete 2 items"]');

    // Verify confirmation dialog appears
    assert
      .dom('[data-test-delete-modal="bulk-delete"]')
      .exists('Delete confirmation modal appears');
    assert
      .dom('[data-test-delete-modal="bulk-delete"]')
      .containsText('2 cards');

    await click('[data-test-confirm-delete-button]');

    // Wait for deletion to complete
    await waitFor('[data-test-cards-grid-item]', {
      count: initialCardCount - 2,
    });

    // Verify cards were deleted
    let remainingCards = findAll('[data-test-cards-grid-item]');
    assert.strictEqual(
      remainingCards.length,
      initialCardCount - 2,
      'Two cards were deleted',
    );

    // Verify selection mode is cleared
    assert
      .dom('.utility-menu-trigger')
      .doesNotExist('Selection summary is cleared');
  });

  test('can deselect selected cards from menu', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // Select All Cards filter and wait for cards to load
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor('[data-test-cards-grid-item]');

    let cards = findAll('[data-test-cards-grid-item]');
    assert.ok(cards.length >= 3, 'Multiple cards are available');

    // Enter selection mode by selecting multiple cards
    await selectCard('Pet/1');
    await selectCard('Pet/2');
    await selectCard('Pet/3');

    // Verify selection count
    assert.dom('.utility-menu-trigger').containsText('3 Selected');

    // Open utility menu
    await click('.utility-menu-trigger');

    // Click "Deselect All" option
    await click('[data-test-boxel-menu-item-text="Deselect All"]');

    // Verify selection is cleared
    assert
      .dom('.utility-menu-trigger')
      .doesNotExist('Selection summary is cleared after deselect');

    // Verify overlay checkboxes are not checked
    assert.dom('[data-test-overlay-card]').doesNotExist();
  });

  test('can select all cards', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // Select All Cards filter and wait for cards to load
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor('[data-test-cards-grid-item]');

    let cards = findAll('[data-test-cards-grid-item]');
    assert.ok(cards.length >= 3, 'Multiple cards are available');
    let totalCardCount = cards.length;

    // Enter selection mode by selecting one card first
    await selectCard('Pet/1');

    // Verify selection state is active
    assert
      .dom('.utility-menu-trigger')
      .containsText('1 Selected', 'Selection menu appears');

    // Open utility menu
    await click('.utility-menu-trigger');

    // Click "Select All" option
    await click('[data-test-boxel-menu-item-text="Select All"]');

    // Verify all cards are selected
    assert
      .dom('.utility-menu-trigger')
      .containsText(`${totalCardCount} Selected`, 'All cards are now selected');

    // Open utility menu again to verify "Select All" is no longer available
    await click('.utility-menu-trigger');

    // "Select All" should not be available when all cards are selected
    assert
      .dom('[data-test-boxel-menu-item-text="Select All"]')
      .doesNotExist(
        'Select All option is not available when all cards are selected',
      );

    // But "Deselect All" should be available
    assert
      .dom('[data-test-boxel-menu-item-text="Deselect All"]')
      .exists('Deselect All option is available');
  });

  test('can cancel bulk delete operation', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}index`,
            format: 'isolated',
          },
        ],
      ],
    });

    // Select All Cards filter and wait for cards to load
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor('[data-test-cards-grid-item]');

    let cards = findAll('[data-test-cards-grid-item]');
    assert.ok(cards.length >= 3, 'Multiple cards are available');
    let initialCardCount = cards.length;

    // Enter selection mode by selecting multiple cards
    await selectCard('Pet/1');
    await selectCard('Pet/2');

    // Verify selection count
    assert.dom('.utility-menu-trigger').containsText('2 Selected');

    // Open utility menu
    await click('.utility-menu-trigger');

    // Click bulk delete option
    await click('[data-test-boxel-menu-item-text="Delete 2 items"]');

    // Verify confirmation dialog appears
    assert
      .dom('[data-test-delete-modal="bulk-delete"]')
      .exists('Delete confirmation modal appears');
    assert
      .dom('[data-test-delete-modal="bulk-delete"]')
      .containsText('2 cards');

    // Cancel the delete operation
    await click('[data-test-confirm-cancel-button]');

    // Verify modal is closed
    assert
      .dom('[data-test-delete-modal="bulk-delete"]')
      .doesNotExist('Delete confirmation modal is closed');

    // Verify no cards were deleted
    let remainingCards = findAll('[data-test-cards-grid-item]');
    assert.strictEqual(
      remainingCards.length,
      initialCardCount,
      'No cards were deleted after canceling',
    );

    // Verify selection is still active
    assert
      .dom('.utility-menu-trigger')
      .containsText('2 Selected', 'Selection remains active after cancel');
  });
});
