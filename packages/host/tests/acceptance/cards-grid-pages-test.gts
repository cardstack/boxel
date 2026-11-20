import { click, findAll, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  setupLocalIndexing,
  setupAcceptanceTestRealm,
  testRealmURL,
  setupAuthEndpoints,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const GRID_ITEM = '[data-test-cards-grid-cards] [data-test-cards-grid-item]';
const PAGINATION = '[data-test-card-list-pagination]';

module('Acceptance | cards grid | pages', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  // The grid pages this realm's pets in steps of PAGE_SIZE, so a second,
  // shorter page holds the pets past the first.
  const PAGE_SIZE = 2;
  const PET_COUNT = 3;

  hooks.beforeEach(async function () {
    createAndJoinRoom({ sender: '@testuser:localhost', name: 'room-test' });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let { field, contains, CardDef } = await loader.import<
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let { default: StringField } = await loader.import<
      typeof import('@cardstack/base/string')
    >('@cardstack/base/string');
    let { CardsGrid } = await loader.import<
      typeof import('@cardstack/base/cards-grid')
    >('@cardstack/base/cards-grid');

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field cardTitle = contains(StringField);
    }
    class PagedCardsGrid extends CardsGrid {
      static gridPageSize = PAGE_SIZE;
    }

    let pets: Record<string, InstanceType<typeof Pet>> = {};
    for (let i = 1; i <= PET_COUNT; i++) {
      pets[`Pet/${i}.json`] = new Pet({ cardTitle: `Pet ${i}` });
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'realm.json': realmConfigCardJSON({ name: 'Test Realm' }),
        'pet.gts': { Pet, PagedCardsGrid },
        'index.json': new PagedCardsGrid(),
        ...pets,
      },
    });
  });

  function gridItemIds(): string[] {
    return findAll(GRID_ITEM).map(
      (el) => el.getAttribute('data-test-cards-grid-item') ?? '',
    );
  }

  test('a filter with more cards than a page steps through them page by page', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-boxel-filter-list-button="Pet"]');
    await waitUntil(() => gridItemIds().length === PAGE_SIZE);

    assert.dom(PAGINATION).exists('the grid offers page controls');
    assert.dom(`${PAGINATION} [aria-current="page"]`).hasText('1');
    let firstPage = gridItemIds();

    await click(`${PAGINATION} [aria-label="Next"]`);
    await waitUntil(() => gridItemIds().length === PET_COUNT - PAGE_SIZE);
    assert.dom(`${PAGINATION} [aria-current="page"]`).hasText('2');

    let seen = [...firstPage, ...gridItemIds()].sort();
    assert.deepEqual(
      seen,
      Array.from(
        { length: PET_COUNT },
        (_, i) => `${testRealmURL}Pet/${i + 1}`,
      ).sort(),
      'the two pages together hold every pet, each once',
    );
  });

  test('changing the filter starts again at page 1', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-boxel-filter-list-button="Pet"]');
    await waitUntil(() => gridItemIds().length === PAGE_SIZE);
    await click(`${PAGINATION} [aria-label="Next"]`);
    await waitUntil(() => gridItemIds().length === PET_COUNT - PAGE_SIZE);

    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`${PAGINATION} [aria-current="page"]`);
    assert
      .dom(`${PAGINATION} [aria-current="page"]`)
      .hasText('1', 'a new filter opens on its first page');

    await click('[data-test-boxel-filter-list-button="Pet"]');
    await waitUntil(() => gridItemIds().length === PAGE_SIZE);
    assert
      .dom(`${PAGINATION} [aria-current="page"]`)
      .hasText('1', 'returning to the filter starts at page 1 too');
  });

  test('returning to a filter through Highlights starts again at page 1', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
    });
    await click('[data-test-boxel-filter-list-button="Pet"]');
    await waitUntil(() => gridItemIds().length === PAGE_SIZE);
    await click(`${PAGINATION} [aria-label="Next"]`);
    await waitUntil(() => gridItemIds().length === PET_COUNT - PAGE_SIZE);

    // Highlights shows no paged list, so the grid never reads a page under it.
    await click('[data-test-boxel-filter-list-button="Highlights"]');
    await click('[data-test-boxel-filter-list-button="Pet"]');
    await waitUntil(() => gridItemIds().length === PAGE_SIZE);
    assert
      .dom(`${PAGINATION} [aria-current="page"]`)
      .hasText('1', 'the filter opens on its first page');
  });
});
