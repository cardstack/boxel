import {
  type RenderingTestContext,
  render,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  htmlResourceId,
  isCardInstance,
  CardContextName,
  CssResourceType,
  GetCardContextName,
  HtmlResourceType,
  IconResourceType,
  SearchEntryResourceType,
  type CardResource,
  type Loader,
  type Saved,
  type SearchEntryIncludedResource,
  type SearchEntryResults,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import SearchResults from '@cardstack/host/components/card-search/search-results';
import { getCard } from '@cardstack/host/resources/card-resource';
import type StoreService from '@cardstack/host/services/store';

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

type SearchEntryWireResource = SearchEntryResults['data'][number];

// Provides the context `<SearchResults>`'s rendered `HydratableCard`s consume:
// `getCard` (always, the way the route does). No operator-mode overlay is
// provided — host mode / published views render without one.
class TestContext extends GlimmerComponent<{ Blocks: { default: [] } }> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }
  @provide(CardContextName)
  get cardContext() {
    return undefined;
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

class QueryState {
  @tracked query: SearchEntryWireQuery | undefined = undefined;
}

const bookRef = { module: testRRI('book'), name: 'Book' };
const BOOK_1 = `${testRealmURL}books/1`;
const BOOK_2 = `${testRealmURL}books/2`;
const CSS_HREF = `${testRealmURL}book.gts.abc123.glimmer-scoped.css`;
// The deduped `icon` resource's id — the type's internal key (`<module>/<name>`).
const BOOK_ICON_ID = `${bookRef.module}/Book`;
const BOOK_ICON_HTML = '<svg data-test-book-type-icon></svg>';

function renderingIdFor(url: string): string {
  return htmlResourceId({ url, format: 'fitted', renderType: bookRef });
}

// The `search-entry` resource pointing at a prerendered rendering.
function htmlEntryResource(url: string): SearchEntryWireResource {
  return {
    type: SearchEntryResourceType,
    id: url,
    relationships: {
      html: { data: [{ type: HtmlResourceType, id: renderingIdFor(url) }] },
    },
  };
}

// The `html` rendering (plus its scoped stylesheet) for an html-backed entry.
function htmlIncluded(
  url: string,
  html: string,
  isError = false,
): SearchEntryIncludedResource[] {
  return [
    {
      type: HtmlResourceType,
      id: renderingIdFor(url),
      attributes: {
        html,
        cardType: 'Book',
        isError,
        format: 'fitted',
        renderType: bookRef,
      },
      relationships: {
        styles: { data: [{ type: CssResourceType, id: 'deadbeef' }] },
      },
    },
    {
      type: CssResourceType,
      id: 'deadbeef',
      attributes: { href: CSS_HREF },
    },
  ];
}

// The `search-entry` resource pointing at an `item` serialization.
function itemEntryResource(url: string): SearchEntryWireResource {
  return {
    type: SearchEntryResourceType,
    id: url,
    relationships: { item: { data: { type: 'card', id: url } } },
  };
}

// A full live serialization for one of the seeded books, optionally marked
// sparse. Built to be valid enough for the store to instantiate.
function bookItem(
  url: string,
  title: string,
  opts?: { sparseFields?: string[] },
): CardResource<Saved> {
  return {
    type: 'card',
    id: url,
    attributes: { title, status: 'ready' },
    relationships: {},
    meta: {
      adoptsFrom: { module: testRRI('book'), name: 'Book' },
      ...(opts?.sparseFields ? { sparseFields: opts.sparseFields } : {}),
    },
    links: { self: url },
  } as unknown as CardResource<Saved>;
}

// An `item` serialization standing in for a card that failed to render: it
// carries the error doc in `meta.error` and no usable attributes. Drives the
// terminal rung — the host error component.
function errorItem(url: string, message: string): CardResource<Saved> {
  return {
    type: 'card',
    id: url,
    meta: {
      adoptsFrom: { module: testRRI('book'), name: 'Book' },
      error: {
        type: 'instance-error',
        error: {
          title: 'Card Error',
          status: 500,
          message,
          additionalErrors: null,
        },
      },
    },
    links: { self: url },
  } as unknown as CardResource<Saved>;
}

// An error rendering carrying no last-known-good HTML: `isError` with the
// `html` string absent. With no item alongside it, the row has nothing to
// render but its error state — the host error component, with a generic
// message (no error doc rode along).
function htmlIncludedNoLastKnownGood(
  url: string,
): SearchEntryIncludedResource[] {
  return [
    {
      type: HtmlResourceType,
      id: renderingIdFor(url),
      attributes: {
        cardType: 'Book',
        isError: true,
        format: 'fitted',
        renderType: bookRef,
      },
      relationships: { styles: { data: [] } },
    },
  ];
}

module('Integration | Component | search-results', function (hooks) {
  let loader: Loader;
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
    loader = getService('loader-service').loader;
    storeService = getService('store');

    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
      @field status = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div class='live-book' data-test-live-book>
            Live:
            <@fields.title />
          </div>
        </template>
      };
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div class='embedded-book' data-test-embedded-book>
            Embedded:
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
        'books/1.json': new Book({ title: 'Mango', status: 'ready' }),
        'books/2.json': new Book({ title: 'Van Gogh', status: 'ready' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  // Stub the v2 fetch with a manufactured document and short-circuit the
  // stylesheet import for its fake css href. Returns the restore thunk.
  function stubSearchEntries(doc: SearchEntryResults): () => void {
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async () => doc;
    let originalImport = loader.import.bind(loader);
    loader.import = (async (url: string) =>
      url === CSS_HREF ? {} : originalImport(url)) as Loader['import'];
    return () => {
      storeService.searchEntries = originalSearchEntries;
      loader.import = originalImport;
    };
  }

  test('renders prerendered HTML inert and hydrates it lazily on hover', async function (assert) {
    let query: SearchEntryWireQuery = {
      filter: { 'item.on': bookRef },
      realms: [testRealmURL],
    };
    await render(
      <template>
        <TestContext>
          <SearchResults @query={{query}} @mode='hover' />
        </TestContext>
      </template>,
    );
    await waitUntil(() =>
      Boolean(document.querySelector('[data-test-search-result]')),
    );

    assert
      .dom(`[data-test-search-result="${BOOK_1}"]`)
      .exists('the first book result rendered');
    assert
      .dom(`[data-test-search-result="${BOOK_2}"]`)
      .exists('the second book result rendered');
    assert
      .dom(`[data-test-hydratable-card="${BOOK_1}"][data-hydration="hover"]`)
      .exists(
        'an html-backed result starts inert with the hover gesture wired',
      );
    assert.notOk(
      isCardInstance(storeService.peek(BOOK_1)),
      'an html-only result is not deposited into the store',
    );

    await triggerEvent(`[data-test-hydratable-card="${BOOK_1}"]`, 'mouseenter');

    assert
      .dom(`[data-test-hydratable-card="${BOOK_1}"][data-hydration="hydrated"]`)
      .exists('hovering hydrates the result into a live card');
    assert.ok(
      isCardInstance(storeService.peek(BOOK_1)),
      'the hydration GET deposited the card into the store',
    );
  });

  test('renders a heterogeneous stream: an html row inert, an item-only row live', async function (assert) {
    let restore = stubSearchEntries({
      data: [htmlEntryResource(BOOK_1), itemEntryResource(BOOK_2)],
      included: [
        ...htmlIncluded(BOOK_1, `<div data-test-inert-book>Mango</div>`),
        bookItem(BOOK_2, 'Van Gogh'),
      ],
      meta: {
        page: { total: 2 },
        htmlQuery: { eq: { format: 'fitted', renderType: bookRef } },
      },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} @mode='hover' />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-live-book]')),
      );

      // The html-backed row stays inert (its prerendered markup) with the
      // gesture wired.
      assert
        .dom(`[data-test-hydratable-card="${BOOK_1}"][data-hydration="hover"]`)
        .exists('the html row is inert');
      assert
        .dom('[data-test-inert-book]')
        .exists('it shows its prerendered markup');

      // The item-only row resolves live immediately (no gesture), as a full
      // live card, and is deposited by the selective inflate.
      assert
        .dom(
          `[data-test-hydratable-card="${BOOK_2}"][data-hydration="hydrated"]`,
        )
        .exists('the item-only row renders live without a gesture');
      assert.dom('[data-test-live-book]').hasText('Live: Van Gogh');
      assert.ok(
        isCardInstance(storeService.peek(BOOK_2)),
        'the full item was inflated into the store',
      );
    } finally {
      restore();
    }
  });

  test('stamps the type icon from the deduped icon resource, shared across rows', async function (assert) {
    // Two same-type rows reference one `icon` resource via the entry's `icon`
    // relationship (deduped). The host resolves it to `entry.iconHtml` and
    // stamps `data-card-type-icon-html` on each inert row — the attribute the
    // operator-mode overlay / adorn tab reads, sourced without loading the
    // instance.
    let withIcon = (url: string): SearchEntryWireResource => ({
      type: SearchEntryResourceType,
      id: url,
      relationships: {
        html: { data: [{ type: HtmlResourceType, id: renderingIdFor(url) }] },
        icon: { data: { type: IconResourceType, id: BOOK_ICON_ID } },
      },
    });
    let restore = stubSearchEntries({
      data: [withIcon(BOOK_1), withIcon(BOOK_2)],
      included: [
        ...htmlIncluded(BOOK_1, `<div data-test-inert-book>Mango</div>`),
        ...htmlIncluded(BOOK_2, `<div data-test-inert-book>Van Gogh</div>`),
        {
          type: IconResourceType,
          id: BOOK_ICON_ID,
          attributes: {
            iconHtml: BOOK_ICON_HTML,
            displayName: 'Book',
            codeRef: bookRef,
          },
        },
      ],
      meta: {
        page: { total: 2 },
        htmlQuery: { eq: { format: 'fitted', renderType: bookRef } },
      },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} @mode='none' />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-search-result]')),
      );

      for (let url of [BOOK_1, BOOK_2]) {
        assert
          .dom(`[data-test-hydratable-card="${url}"]`)
          .hasAttribute(
            'data-card-type-icon-html',
            BOOK_ICON_HTML,
            `${url} carries the deduped type icon as a data attribute`,
          );
      }
    } finally {
      restore();
    }
  });

  test('a live fallback renders at the format the query selected', async function (assert) {
    // An item-only row for an `embedded` search renders the live card at
    // `embedded`, not the hardcoded `fitted`, so it matches the HTML rows the
    // query would have produced.
    let restore = stubSearchEntries({
      data: [itemEntryResource(BOOK_1)],
      included: [bookItem(BOOK_1, 'Mango')],
      meta: {
        page: { total: 1 },
        htmlQuery: { eq: { format: 'embedded', renderType: bookRef } },
      },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-embedded-book]')),
      );

      assert
        .dom('[data-test-embedded-book]')
        .hasText('Embedded: Mango', 'the live fallback rendered at embedded');
      assert
        .dom('[data-test-live-book]')
        .doesNotExist('it did not fall back to the fitted format');
    } finally {
      restore();
    }
  });

  test('selective Store inflate: a full item is deposited, a sparse item never is', async function (assert) {
    // The store-level rule, independent of rendering: a full serialization
    // deposits; a sparse one (carrying meta.sparseFields) is a no-op.
    await storeService.inflateSearchEntryItem(bookItem(BOOK_1, 'Mango'));
    assert.ok(
      isCardInstance(storeService.peek(BOOK_1)),
      'a full item is deposited into the store',
    );

    await storeService.inflateSearchEntryItem(
      bookItem(BOOK_2, 'Van Gogh', { sparseFields: ['title'] }),
    );
    assert.notOk(
      isCardInstance(storeService.peek(BOOK_2)),
      'a sparse item is never deposited',
    );
  });

  test('the component inflates a full item row into the store', async function (assert) {
    let restore = stubSearchEntries({
      data: [itemEntryResource(BOOK_1)],
      included: [bookItem(BOOK_1, 'Mango')],
      meta: { page: { total: 1 } },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        fields: { 'search-entry': ['item'] },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} />
          </TestContext>
        </template>,
      );
      await waitUntil(() => isCardInstance(storeService.peek(BOOK_1)));

      assert.ok(
        isCardInstance(storeService.peek(BOOK_1)),
        'the full item row was deposited by the selective inflate',
      );
    } finally {
      restore();
    }
  });

  test('an error rendering never hydrates', async function (assert) {
    let errorHtml = `<div data-test-inert-book data-is-error='true'>Last known good</div>`;
    let restore = stubSearchEntries({
      data: [htmlEntryResource(BOOK_1)],
      included: htmlIncluded(BOOK_1, errorHtml, true),
      meta: {
        page: { total: 1 },
        htmlQuery: { eq: { format: 'fitted', renderType: bookRef } },
      },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} @mode='hover' />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-inert-book]')),
      );

      assert
        .dom(`[data-test-hydratable-card="${BOOK_1}"][data-hydration="none"]`)
        .exists('an error row is forced to none regardless of @mode');

      await triggerEvent(
        `[data-test-hydratable-card="${BOOK_1}"]`,
        'mouseenter',
      );

      assert
        .dom('[data-test-inert-book]')
        .exists('the error rendering stays inert after hover');
      assert.notOk(
        isCardInstance(storeService.peek(BOOK_1)),
        'no hydration GET fired for an error row',
      );
    } finally {
      restore();
    }
  });

  test('an error item with no html falls through to the host error component', async function (assert) {
    // No good html, no last-known-good html, and the live item carries an
    // error doc — the terminal rung. The host error component surfaces the
    // doc's message and the row never enters the store or fires a GET.
    let restore = stubSearchEntries({
      data: [itemEntryResource(BOOK_1)],
      included: [errorItem(BOOK_1, 'Boom: failed to render')],
      meta: { page: { total: 1 } },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} @mode='hover' />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-search-result-error]')),
      );

      assert
        .dom(`[data-test-search-result-error="${BOOK_1}"]`)
        .exists('the host error component renders for an error item')
        .containsText(
          'Boom: failed to render',
          'it surfaces the error doc message',
        );
      assert
        .dom(`[data-test-hydratable-card="${BOOK_1}"]`)
        .doesNotExist('an error item is not a hydratable card');
      assert.notOk(
        isCardInstance(storeService.peek(BOOK_1)),
        'an error item is never deposited into the store',
      );

      await triggerEvent(
        `[data-test-search-result-error="${BOOK_1}"]`,
        'mouseenter',
      );
      assert.notOk(
        isCardInstance(storeService.peek(BOOK_1)),
        'hovering the host error component fires no hydration GET',
      );
    } finally {
      restore();
    }
  });

  test('an error rendering with no last-known-good html falls through to the host error component', async function (assert) {
    // The html rendering is an error rendering carrying no html string, and no
    // item rode along — nothing renders but the error state, so the host error
    // component shows its generic message.
    let restore = stubSearchEntries({
      data: [htmlEntryResource(BOOK_1)],
      included: htmlIncludedNoLastKnownGood(BOOK_1),
      meta: {
        page: { total: 1 },
        htmlQuery: { eq: { format: 'fitted', renderType: bookRef } },
      },
    });
    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await render(
        <template>
          <TestContext>
            <SearchResults @query={{query}} @mode='hover' />
          </TestContext>
        </template>,
      );
      await waitUntil(() =>
        Boolean(document.querySelector('[data-test-search-result-error]')),
      );

      assert
        .dom(`[data-test-search-result-error="${BOOK_1}"]`)
        .exists(
          'the host error component renders when there is nothing to show',
        )
        .containsText(
          'could not be rendered',
          'it shows the generic message when no error doc rode along',
        );
      assert.notOk(
        isCardInstance(storeService.peek(BOOK_1)),
        'a bare error rendering never enters the store',
      );
    } finally {
      restore();
    }
  });

  test('yields a results object to a block consumer', async function (assert) {
    let query: SearchEntryWireQuery = {
      filter: { 'item.on': bookRef },
      realms: [testRealmURL],
    };
    await render(
      <template>
        <TestContext>
          <SearchResults @query={{query}} as |results|>
            <div data-test-total>{{results.meta.page.total}}</div>
            <div data-test-count>{{results.entries.length}}</div>
            {{#each results.entries key='id' as |entry|}}
              <div class='custom' data-test-custom={{entry.id}}>
                <entry.component />
              </div>
            {{/each}}
          </SearchResults>
        </TestContext>
      </template>,
    );
    await waitUntil(() =>
      Boolean(document.querySelector('[data-test-custom]')),
    );

    assert.dom('[data-test-total]').hasText('2', 'the page total is yielded');
    assert.dom('[data-test-count]').hasText('2', 'both entries are yielded');
    assert
      .dom(`[data-test-custom="${BOOK_1}"] [data-test-hydratable-card]`)
      .exists('the consumer renders each entry.component');
  });

  test('an undefined query renders nothing, then activates when set', async function (assert) {
    let state = new QueryState();
    await render(
      <template>
        <TestContext>
          <SearchResults @query={{state.query}} />
        </TestContext>
      </template>,
    );

    assert
      .dom('[data-test-search-result]')
      .doesNotExist('an idle query renders no results');

    state.query = { filter: { 'item.on': bookRef }, realms: [testRealmURL] };
    await waitUntil(() =>
      Boolean(document.querySelector('[data-test-search-result]')),
    );
    assert
      .dom('[data-test-search-result]')
      .exists({ count: 2 }, 'setting the query activates the search');
  });

  hooks.afterEach(function () {
    getService('network').virtualNetwork.removeRealmMapping('@test-prefix/');
  });
});
