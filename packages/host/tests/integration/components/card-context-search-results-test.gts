import {
  type RenderingTestContext,
  render,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  isCardInstance,
  GetCardContextName,
  type getCard as GetCardType,
  type SearchEntryWireQuery,
  type SearchResultsComponentSignature,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/card-search/search-results';
import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type StoreService from '@cardstack/host/services/store';

import type { CardContext } from 'https://cardstack.com/base/card-api';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  StringField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The v2 search surface is the card-facing `@context.searchResultsComponent`,
// codified at the type level: the member exists, carries the v2 component
// contract, and the deprecated `prerenderedCardSearchComponent` rendering
// surface stays alongside it through the migration window. These fail the
// type-check (and so the suite) if that converged shape ever erodes.
type Assert<T extends true> = T;

type CardContextExposesSearchResults = Assert<
  CardContext['searchResultsComponent'] extends typeof GlimmerComponent<SearchResultsComponentSignature>
    ? true
    : false
>;

type CardContextKeepsDeprecatedPrerendered = Assert<
  'prerenderedCardSearchComponent' extends keyof CardContext ? true : false
>;

type CardContextKeepsInstancesSurface = Assert<
  'getCard' extends keyof CardContext
    ? 'getCards' extends keyof CardContext
      ? 'getCardCollection' extends keyof CardContext
        ? true
        : false
      : false
    : false
>;

const bookRef = { module: testRRI('book'), name: 'Book' };
const BOOK_1 = `${testRealmURL}books/1`;
const BOOK_2 = `${testRealmURL}books/2`;

// Provides the full converged card `@context` the host hands a card —
// instances (`getCard` / `getCards` / `getCardCollection` / `store`) plus both
// rendering surfaces (the v2 `searchResultsComponent` and the deprecated
// `prerenderedCardSearchComponent`) — and yields it so a consumer template can
// render `<context.searchResultsComponent />` exactly as a card author would.
// `GetCardContextName` is provided too so the nested hydratable rows resolve
// their live instances, the way the route wires it.
class CardSearchContext extends GlimmerComponent<{
  Blocks: { default: [CardContext] };
}> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }

  get context(): CardContext {
    let store = getService('store');
    return {
      getCard: getCard as unknown as GetCardType,
      getCards: store.getSearchResource.bind(store),
      getCardCollection,
      store,
      prerenderedCardSearchComponent: PrerenderedCardSearch,
      searchResultsComponent: SearchResults,
    };
  }

  <template>{{yield this.context}}</template>
}

module(
  'Integration | Component | card @context searchResultsComponent',
  function (hooks) {
    let storeService: StoreService;

    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });

    hooks.beforeEach(async function (this: RenderingTestContext) {
      storeService = getService('store');

      class Book extends CardDef {
        static displayName = 'Book';
        @field title = contains(StringField);
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <div class='live-book' data-test-live-book>
              Live:
              <@fields.title />
            </div>
          </template>
        };
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'book.gts': { Book },
          'books/1.json': new Book({ title: 'Mango' }),
          'books/2.json': new Book({ title: 'Van Gogh' }),
        },
      });
      await getService('realm').login(testRealmURL);
    });

    test('a card renders the v2 search-entry stream via @context.searchResultsComponent', async function (assert) {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <CardSearchContext as |context|>
            <context.searchResultsComponent @query={{query}} @mode='hover' />
          </CardSearchContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-search-result]')),
      );

      assert
        .dom(`[data-test-search-result="${BOOK_1}"]`)
        .exists('the first book renders through the @context surface');
      assert
        .dom(`[data-test-search-result="${BOOK_2}"]`)
        .exists('the second book renders through the @context surface');
      assert
        .dom(`[data-test-hydratable-card="${BOOK_1}"][data-hydration="hover"]`)
        .exists('an html-backed result starts inert with the hover gesture');
      assert.notOk(
        isCardInstance(storeService.peek(BOOK_1)),
        'an html-only result is not deposited into the store',
      );

      await triggerEvent(
        `[data-test-hydratable-card="${BOOK_1}"]`,
        'mouseenter',
      );

      assert
        .dom(
          `[data-test-hydratable-card="${BOOK_1}"][data-hydration="hydrated"]`,
        )
        .exists('hovering hydrates the result into a live card');
      assert.ok(
        isCardInstance(storeService.peek(BOOK_1)),
        'the hydration GET deposited the card into the store',
      );
    });

    test('the converged @context exposes the v2 + deprecated rendering surfaces and the instances surface', async function (assert) {
      // The yielded `@context` carries both rendering surfaces and the
      // instances surface at once — a card author reads them straight off
      // `@context`. The compile-time witnesses below pin the same shape at the
      // type level.
      await render(
        <template>
          <CardSearchContext as |context|>
            {{#if context.searchResultsComponent}}
              <span data-test-has-search-results>yes</span>
            {{/if}}
            {{#if context.prerenderedCardSearchComponent}}
              <span data-test-has-prerendered>yes</span>
            {{/if}}
          </CardSearchContext>
        </template>,
      );

      assert
        .dom('[data-test-has-search-results]')
        .exists('the v2 searchResultsComponent is exposed on @context');
      assert
        .dom('[data-test-has-prerendered]')
        .exists(
          'the deprecated prerenderedCardSearchComponent stays exposed alongside it',
        );

      // The instances surface (getCard / getCards / getCardCollection /
      // store.search) coexisting on the same `@context` is pinned by the
      // compile-time witnesses below — those members are functions, so a
      // template `{{#if}}` truthiness check can't assert their presence.
      let witnesses: [
        CardContextExposesSearchResults,
        CardContextKeepsDeprecatedPrerendered,
        CardContextKeepsInstancesSurface,
      ] = [true, true, true];
      assert.deepEqual(witnesses, [true, true, true]);
    });

    hooks.afterEach(function () {
      getService('network').virtualNetwork.removeRealmMapping('@test-prefix/');
    });
  },
);
