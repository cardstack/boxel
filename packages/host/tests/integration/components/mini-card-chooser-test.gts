import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  baseRealm,
  type getCard as GetCardType,
  CardContextName,
  GetCardContextName,
  GetCardCollectionContextName,
  GetCardsContextName,
} from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/mini-card-chooser';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type RecentCardsService from '@cardstack/host/services/recent-cards-service';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';

import { setupRenderingTest } from '../../helpers/setup';

// Provides the contexts SearchContent reads via @consume so the
// chooser can render in isolation, without OperatorMode.
class HostContextProvider extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard as unknown as GetCardType;
  }

  @provide(GetCardsContextName)
  get getCardsFn() {
    let store = getService('store') as StoreService;
    return store.getSearchResource.bind(store);
  }

  @provide(GetCardCollectionContextName)
  get getCardCollectionFn() {
    return getCardCollection;
  }

  @provide(CardContextName)
  get cardContext() {
    return {};
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

module('Integration | mini-card-chooser', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const noop = () => {};

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'books/mango.json': new Book({ title: 'Mango' }),
        'books/vincent.json': new Book({ title: 'Vincent' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('mounts in isolation with a search input and no filter chips', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MiniCardChooser @onSelect={{noop}} />
        </HostContextProvider>
      </template>,
    );

    await waitFor('[data-test-mini-card-chooser] [data-test-search-field]');

    assert
      .dom('[data-test-mini-card-chooser]')
      .exists('the mini chooser mounts in isolation');
    assert
      .dom('[data-test-mini-card-chooser] [data-test-search-field]')
      .exists('the search input is rendered');
    // The realm/type chips are deliberately suppressed in the mini variant.
    assert
      .dom('[data-test-mini-card-chooser] .search-sheet__search-bar-picker')
      .doesNotExist('realm/type filter chips are hidden in the mini variant');
  });

  test('shows recents in the empty state, and selecting one fires onSelect with the canonical URL', async function (assert) {
    let recent = getService('recent-cards-service') as RecentCardsService;
    recent.add(`${testRealmURL}books/mango`);

    const selections: string[] = [];
    const onSelect = (url: string) => selections.push(url);

    await render(
      <template>
        <HostContextProvider>
          <MiniCardChooser @onSelect={{onSelect}} />
        </HostContextProvider>
      </template>,
    );

    const cardUrl = `${testRealmURL}books/mango`;
    await waitFor(
      `[data-test-mini-card-chooser] [data-section-sid="recents"] [data-test-item-button="${cardUrl}"]`,
      { timeout: 5000 },
    );

    await click(
      `[data-test-mini-card-chooser] [data-test-item-button="${cardUrl}"]`,
    );

    await waitUntil(() => selections.length > 0);
    assert.deepEqual(
      selections,
      [cardUrl],
      'onSelect receives the canonical URL exactly once (no .json suffix)',
    );
  });

  test('typing in the search input renders matching results from the realm', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MiniCardChooser @onSelect={{noop}} />
        </HostContextProvider>
      </template>,
    );

    await waitFor('[data-test-mini-card-chooser] [data-test-search-field]');

    const vincent = `${testRealmURL}books/vincent`;
    const mango = `${testRealmURL}books/mango`;

    await fillIn(
      '[data-test-mini-card-chooser] [data-test-search-field]',
      'Vincent',
    );
    await waitFor(
      `[data-test-mini-card-chooser] [data-test-item-button="${vincent}"]`,
      { timeout: 5000 },
    );

    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${vincent}"]`)
      .exists('the matching card surfaces');
    assert
      .dom(`[data-test-mini-card-chooser] [data-test-item-button="${mango}"]`)
      .doesNotExist('non-matching cards are filtered out');
  });
});
