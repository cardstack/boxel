import {
  click,
  findAll,
  triggerEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { CardsGrid } from '@cardstack/base/cards-grid';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | workspace-delete-multiple', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loaderService = getService('loader-service');
    let loader = loaderService.loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field species = contains(StringField);
      @field cardTitle = contains(StringField, {
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

    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
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
          'realm.json': realmConfigCardJSON({ name: 'Test Realm' }),
        },
      });
    });
  });

  async function selectCard(cardPath: string) {
    let cardSelector = `[data-test-cards-grid-item="${testRealmURL}${cardPath}"] .field-component-card`;
    await triggerEvent(cardSelector, 'mouseenter');
    await waitFor(
      `[data-test-overlay-card="${testRealmURL}${cardPath}"] [data-test-overlay-select="${testRealmURL}${cardPath}"]`,
    );
    await click(
      `[data-test-overlay-card="${testRealmURL}${cardPath}"] [data-test-overlay-select="${testRealmURL}${cardPath}"]`,
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
      .dom('[data-test-selection-dropdown-trigger]')
      .containsText('1', 'Selection chip shows count');

    // Select additional cards
    await selectCard('Pet/2');

    // Verify selection count
    assert.dom('[data-test-selection-dropdown-trigger]').containsText('2');

    // Open utility menu
    await click('[data-test-selection-dropdown-trigger]');

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
      .dom('[data-test-selection-dropdown-trigger]')
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
    assert.dom('[data-test-selection-dropdown-trigger]').containsText('3');

    // Open utility menu
    await click('[data-test-selection-dropdown-trigger]');

    // Click "Deselect All" option
    await click('[data-test-boxel-menu-item-text="Deselect All"]');

    // Verify selection is cleared
    assert
      .dom('[data-test-selection-dropdown-trigger]')
      .doesNotExist('Selection summary is cleared after deselect');

    // Verify overlay chrome is gone. The overlay clears on hover-out via a
    // 100ms hover-bridge timer (native setTimeout, not tracked by settled),
    // so poll rather than asserting synchronously.
    await waitUntil(() => findAll('[data-test-overlay-card]').length === 0);
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
      .dom('[data-test-selection-dropdown-trigger]')
      .containsText('1', 'Selection chip shows count');

    // Open utility menu
    await click('[data-test-selection-dropdown-trigger]');

    // Click "Select All" option
    await click('[data-test-boxel-menu-item-text="Select All"]');

    // Verify all cards are selected
    assert
      .dom('[data-test-selection-dropdown-trigger]')
      .containsText(`${totalCardCount}`, 'All cards are now selected');

    // Open utility menu again to verify "Select All" is no longer available
    await click('[data-test-selection-dropdown-trigger]');

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

  test('Select All does not load a card instance for every selected card', async function (assert) {
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

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor('[data-test-cards-grid-item]');

    let cards = findAll('[data-test-cards-grid-item]');
    let totalCardCount = cards.length;
    assert.ok(totalCardCount >= 3, 'Multiple cards are available');

    // Enter selection mode with a single card, then count store.get calls
    // made specifically by the Select All action. Selecting cards must not
    // materialize an instance per card — that eager loading is what froze the
    // UI for seconds on large grids.
    await selectCard('Pet/1');

    let store = getService('store');
    let originalGet = store.get;
    let getCallCount = 0;
    (store as any).get = function (...args: unknown[]) {
      getCallCount += 1;
      return (originalGet as any).apply(store, args);
    };

    try {
      await click('[data-test-selection-dropdown-trigger]');
      let countBeforeSelectAll = getCallCount;
      await click('[data-test-boxel-menu-item-text="Select All"]');
      await waitUntil(() =>
        document
          .querySelector('[data-test-selection-dropdown-trigger]')
          ?.textContent?.includes(`${totalCardCount}`),
      );
      let getsDuringSelectAll = getCallCount - countBeforeSelectAll;

      assert
        .dom('[data-test-selection-dropdown-trigger]')
        .containsText(`${totalCardCount}`, 'All cards are now selected');
      assert.strictEqual(
        getsDuringSelectAll,
        0,
        `Select All should not load any instance (selections are tracked by id); store.get was called ${getsDuringSelectAll}x while selecting ${totalCardCount} cards`,
      );
    } finally {
      (store as any).get = originalGet;
    }
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
    assert.dom('[data-test-selection-dropdown-trigger]').containsText('2');

    // Open utility menu
    await click('[data-test-selection-dropdown-trigger]');

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
      .dom('[data-test-selection-dropdown-trigger]')
      .containsText('2', 'Selection remains active after cancel');
  });
});

const readOnlyRealmURL = 'http://test-realm/test2/';

module(
  'Acceptance | workspace-delete-multiple | cards the user cannot write',
  function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupRealmCacheTeardown(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL, readOnlyRealmURL],
    });

    hooks.beforeEach(async function () {
      mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();

      let loader = getService('loader-service').loader;
      let { field, contains, CardDef, Component } = await loader.import<
        typeof import('@cardstack/base/card-api')
      >('@cardstack/base/card-api');
      let { default: StringField } = await loader.import<
        typeof import('@cardstack/base/string')
      >('@cardstack/base/string');
      let { default: CardList } = await loader.import<
        typeof import('@cardstack/base/components/card-list')
      >('@cardstack/base/components/card-list');

      class Pet extends CardDef {
        static displayName = 'Pet';
        @field name = contains(StringField);
        @field cardTitle = contains(StringField, {
          computeVia: function (this: Pet) {
            return this.name;
          },
        });
      }

      // Lists the pets of both realms, as search results the user can select,
      // so one stack item can hold a selection that spans a writable and a
      // read-only realm.
      let petQuery = {
        filter: { type: { module: rri(`${testRealmURL}pet`), name: 'Pet' } },
      };
      let petRealms = [testRealmURL, readOnlyRealmURL];
      class PetBoard extends CardDef {
        static displayName = 'Pet Board';
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <CardList
              @context={{@context}}
              @query={{petQuery}}
              @realms={{petRealms}}
              @format='fitted'
            />
          </template>
        };
      }

      await withCachedRealmSetup(async () => {
        // The writable realm, which holds the definitions, is set up first,
        // so the read-only realm's pet can adopt from it.
        await setupAcceptanceTestRealm({
          mockMatrixUtils,
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            'index.json': new CardsGrid(),
            'pet.gts': { Pet },
            'pet-board.gts': { PetBoard },
            'Pet/fluffy.json': new Pet({ name: 'Fluffy' }),
            'PetBoard/1.json': new PetBoard(),
            'realm.json': realmConfigCardJSON({ name: 'Writable Realm' }),
          },
        });
        await setupAcceptanceTestRealm({
          mockMatrixUtils,
          realmURL: readOnlyRealmURL,
          permissions: { '@testuser:localhost': ['read'] },
          contents: {
            ...SYSTEM_CARD_FIXTURE_CONTENTS,
            'index.json': new CardsGrid(),
            'Pet/mango.json': new Pet({ name: 'Mango' }),
            'realm.json': realmConfigCardJSON({ name: 'Read-only Realm' }),
          },
        });
      });

      mockMatrixUtils.setRealmPermissions({
        [testRealmURL]: ['read', 'write'],
        [readOnlyRealmURL]: ['read'],
      });
    });

    async function selectCard(cardId: string) {
      let hoverTarget = `[data-test-cards-grid-item="${cardId}"] .field-component-card`;
      await triggerEvent(hoverTarget, 'mouseenter');
      let selectButton = `[data-test-overlay-card="${cardId}"] [data-test-overlay-select="${cardId}"]`;
      await waitFor(selectButton);
      await click(selectButton);
      await triggerEvent(hoverTarget, 'mouseleave');
    }

    test('a read-only workspace does not offer bulk delete', async function (assert) {
      let mangoId = `${readOnlyRealmURL}Pet/mango`;
      await visitOperatorMode({
        stacks: [[{ id: `${readOnlyRealmURL}index`, format: 'isolated' }]],
      });
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await waitFor(`[data-test-cards-grid-item="${mangoId}"]`);

      await selectCard(mangoId);
      assert.dom('[data-test-selection-dropdown-trigger]').containsText('1');

      await click('[data-test-selection-dropdown-trigger]');
      assert
        .dom('[data-test-boxel-menu-item-text="Deselect All"]')
        .exists('the selection menu is open');
      assert
        .dom('[data-test-boxel-menu-item-text^="Delete"]')
        .doesNotExist('delete is not offered for a card the user cannot write');
    });

    test('bulk delete is offered only while every selected card is writable', async function (assert) {
      let fluffyId = `${testRealmURL}Pet/fluffy`;
      let mangoId = `${readOnlyRealmURL}Pet/mango`;
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}PetBoard/1`, format: 'isolated' }]],
      });
      await waitFor(`[data-test-cards-grid-item="${fluffyId}"]`);
      await waitFor(`[data-test-cards-grid-item="${mangoId}"]`);

      await selectCard(fluffyId);
      await click('[data-test-selection-dropdown-trigger]');
      assert
        .dom('[data-test-boxel-menu-item-text="Delete 1 item"]')
        .exists('delete is offered when the only selected card is writable');

      await selectCard(mangoId);
      assert.dom('[data-test-selection-dropdown-trigger]').containsText('2');
      await click('[data-test-selection-dropdown-trigger]');
      assert
        .dom('[data-test-boxel-menu-item-text="Deselect All"]')
        .exists('the selection menu is open');
      assert
        .dom('[data-test-boxel-menu-item-text^="Delete"]')
        .doesNotExist(
          'delete is not offered once a read-only card joins the selection',
        );
    });
  },
);
