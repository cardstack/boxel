import { destroy } from '@ember/destroyable';
import { setOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { render, settled, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  htmlResourceId,
  CssResourceType,
  HtmlResourceType,
  EntryResourceType,
  type EntrySingleDocument,
  type Loader,
  type Realm,
  type SearchEntryResults,
  type SearchEntryWireQuery,
} from '@cardstack/runtime-common';

import {
  knownFileMetaUrls,
  clearKnownFileMetaUrls,
} from '@cardstack/host/lib/known-file-meta-urls';
import {
  getSearchEntriesResource,
  SearchEntriesResource,
} from '@cardstack/host/resources/search-entries';

import type LoaderService from '@cardstack/host/services/loader-service';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  StringField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const testRealm2URL = 'http://test-realm/test2/';

function getResourceForTest(
  parent: object,
  args: () => { named: { query: SearchEntryWireQuery | undefined } },
) {
  return SearchEntriesResource.from(parent, args) as unknown as Omit<
    SearchEntriesResource,
    'loaded'
  > & {
    // we expose the private loaded promise just for our tests
    loaded: Promise<void>;
    modify: (
      positional: never[],
      named: { query: SearchEntryWireQuery | undefined },
    ) => void;
  };
}

module('Integration | search-entries resource', function (hooks) {
  let loader: Loader;
  let loaderService: LoaderService;
  let storeService: StoreService;
  let realm: Realm;
  let realm2: Realm;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
    autostart: true,
  });

  let bookRef = { module: testRRI('book'), name: 'Book' };

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loaderService = getService('loader-service');
    loader = loaderService.loader;
    storeService = getService('store');

    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
      @field status = contains(StringField);
    }

    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'books/1.json': new Book({ title: 'Mango', status: 'ready' }),
        'books/2.json': new Book({ title: 'Van Gogh', status: 'draft' }),
      },
    }));
    ({ realm: realm2 } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        'books/other.json': {
          data: {
            type: 'card',
            attributes: { title: 'Paper', status: 'ready' },
            meta: {
              adoptsFrom: {
                module: testRRI('book'),
                name: 'Book',
              },
            },
          },
        },
      },
    }));
  });

  function bookDoc(title: string) {
    return JSON.stringify({
      data: {
        type: 'card',
        attributes: { title, status: 'ready' },
        meta: {
          adoptsFrom: {
            module: testRRI('book'),
            name: 'Book',
          },
        },
      },
    });
  }

  // A book result carrying the generations the selective refresh reads. `htmlGen`
  // omitted → an empty-html (item-fallback) row. `cssHref` links a scoped
  // stylesheet, so `loadStylesheets` has something to import.
  interface BookEntrySpec {
    id: string;
    indexGen: number;
    htmlGen?: number;
    html?: string;
    cssHref?: string;
  }

  function fittedHtmlId(id: string) {
    return htmlResourceId({ url: id, format: 'fitted', renderType: bookRef });
  }

  function entryResourceFor(
    spec: BookEntrySpec,
  ): SearchEntryResults['data'][number] {
    return {
      type: EntryResourceType,
      id: spec.id,
      relationships: {
        html: {
          data:
            spec.htmlGen !== undefined
              ? [{ type: HtmlResourceType, id: fittedHtmlId(spec.id) }]
              : [],
        },
      },
      meta: { generation: spec.indexGen },
    };
  }

  function htmlResourceFor(
    spec: BookEntrySpec,
  ): NonNullable<SearchEntryResults['included']>[number] {
    return {
      type: HtmlResourceType,
      id: fittedHtmlId(spec.id),
      attributes: {
        html: spec.html ?? '<div>book</div>',
        cardType: 'Book',
        format: 'fitted',
        renderType: bookRef,
      },
      relationships: {
        styles: {
          data: spec.cssHref
            ? [{ type: CssResourceType, id: `css-${spec.id}` }]
            : [],
        },
      },
      meta: { generation: spec.htmlGen! },
    };
  }

  function cssResourcesFor(
    specs: BookEntrySpec[],
  ): NonNullable<SearchEntryResults['included']> {
    return specs
      .filter((spec) => spec.cssHref !== undefined)
      .map((spec) => ({
        type: CssResourceType,
        id: `css-${spec.id}`,
        attributes: { href: spec.cssHref! },
      }));
  }

  // A `_federated-search` collection document echoing the default htmlQuery
  // (`{ eq: { format: 'fitted' } }` — no renderType), as the server returns
  // for `{ 'item.on': Book }` with no htmlQuery bound.
  function entryCollectionDoc(specs: BookEntrySpec[]): SearchEntryResults {
    return {
      data: specs.map(entryResourceFor),
      included: specs
        .filter((spec) => spec.htmlGen !== undefined)
        .map(htmlResourceFor),
      meta: {
        page: { total: specs.length },
        htmlQuery: { eq: { format: 'fitted' } },
      },
    };
  }

  // The single-instance card+html GET's response for one book.
  function entrySingleDoc(spec: BookEntrySpec): EntrySingleDocument {
    return {
      data: entryResourceFor(spec),
      included:
        spec.htmlGen !== undefined
          ? [htmlResourceFor(spec), ...cssResourcesFor([spec])]
          : [],
    };
  }

  test('exposes entries joined from the wire document (default fieldset: html renderings)', async function (assert) {
    let search = getResourceForTest(storeService, () => ({
      named: {
        query: {
          filter: { 'item.on': bookRef },
          realms: [testRealmURL],
        },
      },
    }));
    await search.loaded;

    assert.strictEqual(search.entries.length, 2, 'both books are returned');
    assert.strictEqual(search.meta.page.total, 2);
    assert.strictEqual(search.errors, undefined);
    for (let entry of search.entries) {
      assert.strictEqual(entry.realmUrl, testRealmURL);
      assert.strictEqual(
        entry.html.length,
        1,
        'the default htmlQuery selects the fitted rendering',
      );
      let [rendering] = entry.html;
      assert.strictEqual(rendering.format, 'fitted');
      assert.strictEqual(rendering.cardType, 'Book');
      assert.false(rendering.isError);
      assert.ok(rendering.html, 'the rendering carries markup');
      assert.strictEqual(
        entry.item,
        undefined,
        'an html-bearing entry has no item fallback',
      );
    }
  });

  test('registers file result URLs so clicks/overlay classify them as files', async function (assert) {
    // A file row's `file-meta` serialization is HTML-only / never stored, so
    // the operator-mode click + overlay path consults `knownFileMetaUrls` to
    // classify a clicked URL as a file. The resource must register both an
    // item-only file row and an html-backed file row (whose rendering carries
    // no render type — files render natively).
    let itemFileUrl = `${testRealmURL}notes.txt`;
    let htmlFileUrl = `${testRealmURL}readme.md`;
    let renderingId = htmlResourceId({ url: htmlFileUrl, format: 'fitted' });
    let doc: SearchEntryResults = {
      data: [
        {
          type: EntryResourceType,
          id: itemFileUrl,
          relationships: {
            item: { data: { type: 'file-meta', id: itemFileUrl } },
          },
        },
        {
          type: EntryResourceType,
          id: htmlFileUrl,
          relationships: {
            html: { data: [{ type: HtmlResourceType, id: renderingId }] },
          },
        },
      ],
      // The item-only file row registers off its `item` relationship's
      // `file-meta` type — the resolved serialization need not ride in
      // `included`. The html-backed file row needs its rendering (no render
      // type → a file rendering).
      included: [
        {
          type: HtmlResourceType,
          id: renderingId,
          attributes: {
            html: '<div>readme</div>',
            cardType: '',
            format: 'fitted',
          },
          relationships: { styles: { data: [] } },
        },
      ],
      meta: { page: { total: 2 } },
    };
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async () => doc;
    clearKnownFileMetaUrls();
    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL],
          },
        },
      }));
      await search.loaded;

      assert.true(
        knownFileMetaUrls.has(itemFileUrl),
        'the item-only file row is registered',
      );
      assert.true(
        knownFileMetaUrls.has(htmlFileUrl),
        'the html-backed file row (no render type) is registered',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
      clearKnownFileMetaUrls();
    }
  });

  test('exposes raw item serializations per the fieldset, without touching the store', async function (assert) {
    let search = getResourceForTest(storeService, () => ({
      named: {
        query: {
          filter: { 'item.on': bookRef },
          fields: { entry: ['item'] },
          realms: [testRealmURL],
        },
      },
    }));
    await search.loaded;

    assert.strictEqual(search.entries.length, 2);
    for (let entry of search.entries) {
      assert.deepEqual(
        entry.html,
        [],
        'an item-only fieldset pins an empty html branch',
      );
      assert.ok(entry.item, 'the raw serialization rides on the entry');
      assert.strictEqual(entry.item!.type, 'card');
      assert.strictEqual(
        storeService.peek(entry.id),
        undefined,
        'nothing is hydrated into the store',
      );
    }
    assert.deepEqual(
      search.entries.map((entry) => entry.item!.attributes?.title).sort(),
      ['Mango', 'Van Gogh'],
    );
  });

  // Orthogonal to the /render route (which host tests don't exercise — that's
  // the server prerendering suite): this drives the resource directly with the
  // prerender signal set by hand and asserts it registers its search with the
  // render store's readiness mechanism. The end-to-end "/render waits for the
  // search before HTML capture" behavior is covered server-side.
  test('registers the in-flight search with the render store readiness signal during a prerender', async function (assert) {
    let renderStore = getService('render-store');
    let trackedLoads: Promise<unknown>[] = [];
    let originalTrackLoad = renderStore.trackLoad.bind(renderStore);
    renderStore.trackLoad = (load: Promise<unknown>) => {
      trackedLoads.push(load);
      originalTrackLoad(load);
    };
    let generationBefore = renderStore.loadGeneration;
    (globalThis as any).__boxelRenderContext = true;
    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL],
          },
        },
      }));
      // Reading a resource property runs modify(), which performs the search
      // and registers it — synchronously, before the fetch resolves.
      let load = search.loaded;
      assert.strictEqual(
        trackedLoads.length,
        1,
        'the search registers exactly one load with the render store',
      );
      assert.strictEqual(
        trackedLoads[0],
        load,
        'the registered load is the in-flight search',
      );
      assert.true(
        renderStore.loadGeneration > generationBefore,
        'registering the search advances the render store load generation, so the settle loop waits for it',
      );

      await load;
      assert.strictEqual(
        search.entries.length,
        2,
        'the tracked load is the real search and it produced results',
      );
    } finally {
      // `trackLoad` is a StoreService prototype method, so the spy is an own
      // property; deleting it restores the inherited method.
      delete (renderStore as any).trackLoad;
      delete (globalThis as any).__boxelRenderContext;
    }
  });

  test('re-runs the search on an incremental index event', async function (assert) {
    let search = getResourceForTest(storeService, () => ({
      named: {
        query: {
          filter: { 'item.on': bookRef },
          realms: [testRealmURL],
        },
      },
    }));
    await search.loaded;
    assert.strictEqual(search.entries.length, 2);

    await realm.write('books/3.json', bookDoc('Paper'));
    await waitUntil(() => search.entries.length === 3, { timeout: 10_000 });

    assert.ok(
      search.entries.find((entry) => entry.id === `${testRealmURL}books/3`),
      'the new book appears after the incremental index event',
    );
  });

  // A prerender_html event can't change a structured query's membership, so a
  // live search refreshes only the invalidated members' HTML through a
  // conditional card+html GET — it never re-queries the whole search.
  module('prerender_html selective per-member refresh', function () {
    function relayPrerenderHtml(invalidations: string[], generation: number) {
      getService('message-service').relayRealmEvent({
        eventName: 'prerender_html',
        realmURL: testRealmURL,
        generation,
        invalidations,
      });
    }

    test('refreshes only the invalidated member via a card+html GET; no full re-query', async function (assert) {
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango v1</div>',
          },
          {
            id: `${testRealmURL}books/2`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Van Gogh v1</div>',
          },
        ]);
      };

      let getCalls: { url: string; ifNoneMatch?: string; format?: string }[] =
        [];
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async (url: string, opts: any) => {
        getCalls.push({
          url,
          ifNoneMatch: opts.ifNoneMatch,
          format: opts.format,
        });
        return {
          notModified: false,
          doc: entrySingleDoc({
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 2,
            html: '<div>Mango v2</div>',
          }),
        };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        assert.strictEqual(search.entries.length, 2);
        let book2Before = search.entries.find(
          (entry) => entry.id === `${testRealmURL}books/2`,
        );
        let baseline = searchCount;

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => getCalls.length > 0, { timeout: 10_000 });
        await settled();

        assert.strictEqual(
          searchCount,
          baseline,
          'no whole-search re-query is issued',
        );
        assert.strictEqual(getCalls.length, 1, 'exactly one card+html GET');
        assert.strictEqual(getCalls[0].url, `${testRealmURL}books/1`);
        assert.strictEqual(
          getCalls[0].ifNoneMatch,
          '"1:1"',
          'the held composite validator (index:html) is sent as If-None-Match',
        );
        assert.strictEqual(getCalls[0].format, 'fitted');

        assert.strictEqual(
          search.entries[0].html[0].html,
          '<div>Mango v2</div>',
          'the invalidated member swaps in the fresh HTML',
        );
        assert.strictEqual(
          search.entries.find((entry) => entry.id === `${testRealmURL}books/2`),
          book2Before,
          'the uninvalidated member keeps its identity',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a 304 keeps the current rendering and the member identity', async function (assert) {
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango v1</div>',
          },
        ]);

      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return { notModified: true };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let before = search.entries[0];

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => getCount > 0, { timeout: 10_000 });
        await settled();

        assert.strictEqual(getCount, 1, 'the conditional GET was issued');
        assert.strictEqual(
          search.entries[0],
          before,
          'a 304 leaves the member object untouched (a hydrated row stays live)',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a member already at or above the event generation is not fetched', async function (assert) {
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 5,
            htmlGen: 5,
            html: '<div>Mango</div>',
          },
        ]);

      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return { notModified: true };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let before = search.entries[0];

        // The event's generation (5) is not newer than the member's held HTML
        // generation (5), so there is nothing to refresh.
        relayPrerenderHtml([`${testRealmURL}books/1.json`], 5);
        await settled();

        assert.strictEqual(getCount, 0, 'no GET is issued for a fresh member');
        assert.strictEqual(
          search.entries[0],
          before,
          'the member is untouched',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('an event whose URLs are not in the visible set does no work', async function (assert) {
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
        ]);

      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return { notModified: true };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let before = search.entries[0];

        relayPrerenderHtml([`${testRealmURL}books/999.json`], 9);
        await settled();

        assert.strictEqual(getCount, 0, 'no GET for an unrelated invalidation');
        assert.strictEqual(search.entries[0], before);
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('an empty-html member upgrades when its rendering lands', async function (assert) {
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        // No rendering yet (empty html array), so no held html generation.
        entryCollectionDoc([{ id: `${testRealmURL}books/1`, indexGen: 2 }]);

      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      let capturedIfNoneMatch: string | undefined;
      storeService.fetchCardEntry = (async (_url: string, opts: any) => {
        capturedIfNoneMatch = opts.ifNoneMatch;
        return {
          notModified: false,
          doc: entrySingleDoc({
            id: `${testRealmURL}books/1`,
            indexGen: 2,
            htmlGen: 2,
            html: '<div>Mango</div>',
          }),
        };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        assert.deepEqual(search.entries[0].html, [], 'no rendering initially');

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => search.entries[0]?.html.length === 1, {
          timeout: 10_000,
        });

        assert.strictEqual(search.entries[0].html[0].html, '<div>Mango</div>');
        assert.strictEqual(
          capturedIfNoneMatch,
          '"2:none"',
          'a member with no rendering sends the none-html validator',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a full-text (matches) query re-runs in full instead of refreshing members', async function (assert) {
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
        ]);
      };

      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return { notModified: true };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: {
              filter: { 'item.on': bookRef, matches: 'mango' },
              realms: [testRealmURL],
            },
          },
        }));
        await search.loaded;
        let baseline = searchCount;

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => searchCount > baseline, { timeout: 10_000 });
        await settled();

        assert.ok(
          searchCount > baseline,
          'a matches query re-runs the whole search (membership can change)',
        );
        assert.strictEqual(
          getCount,
          0,
          'no per-member GET for a matches query',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a failed member GET falls back to a full re-run', async function (assert) {
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
        ]);
      };

      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        throw new Error('boom');
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let baseline = searchCount;

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => searchCount > baseline, { timeout: 10_000 });
        await settled();

        assert.ok(
          searchCount > baseline,
          'a member the GET could not refresh triggers a coarse re-run',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('an item-only fieldset takes the coarse re-run — render errors can flip its membership', async function (assert) {
      // Without the html branch the search runs the live-search projection,
      // which excludes rows with an effective error — and a render error
      // lands on the prerendered_html channel. So a prerender_html event can
      // change this query's membership and a per-member refresh would miss
      // that. The doc content is irrelevant to the routing decision under
      // test.
      let itemOnlyDoc: SearchEntryResults = {
        data: [
          {
            type: EntryResourceType,
            id: `${testRealmURL}books/1`,
            relationships: {},
            meta: { generation: 1 },
          },
        ],
        meta: { page: { total: 1 } },
      };
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return itemOnlyDoc;
      };
      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return { notModified: true };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: {
              filter: { 'item.on': bookRef },
              fields: { entry: ['item'] },
              realms: [testRealmURL],
            },
          },
        }));
        await search.loaded;
        let baseline = searchCount;

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => searchCount > baseline, { timeout: 10_000 });
        await settled();

        assert.ok(
          searchCount > baseline,
          'an item-only query re-runs the whole search on a prerender_html event',
        );
        assert.strictEqual(getCount, 0, 'no per-member GET is attempted');
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('coalesced events refresh the union of their members, each judged at its own generation', async function (assert) {
      let book1 = `${testRealmURL}books/1`;
      let book2 = `${testRealmURL}books/2`;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        entryCollectionDoc([
          { id: book1, indexGen: 1, htmlGen: 1, html: '<div>Mango v1</div>' },
          {
            id: book2,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Van Gogh v1</div>',
          },
        ]);

      // The first GET (event 1's member) never resolves, holding the run
      // mid-GET so event 2 restarts it; the replacement run must cover both
      // events' members.
      let getUrls: string[] = [];
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async (url: string) => {
        getUrls.push(url);
        if (getUrls.length === 1) {
          return new Promise(() => {});
        }
        return {
          notModified: false,
          doc: entrySingleDoc({
            id: url,
            indexGen: 1,
            htmlGen: url === book2 ? 3 : 2,
            html: `<div>${url === book2 ? 'Van Gogh' : 'Mango'} v2</div>`,
          }),
        };
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => getUrls.length === 1, { timeout: 10_000 });
        relayPrerenderHtml([`${testRealmURL}books/2.json`], 3);
        await waitUntil(
          () =>
            search.entries.find((e) => e.id === book1)?.htmlGeneration === 2 &&
            search.entries.find((e) => e.id === book2)?.htmlGeneration === 3,
          { timeout: 10_000 },
        );
        await settled();

        assert.deepEqual(
          getUrls.slice(1).sort(),
          [book1, book2],
          "the replacement run refreshes both events' members",
        );
        assert.strictEqual(
          search.entries.find((e) => e.id === book1)?.html[0]?.html,
          '<div>Mango v2</div>',
        );
        assert.strictEqual(
          search.entries.find((e) => e.id === book2)?.html[0]?.html,
          '<div>Van Gogh v2</div>',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('an index event on another realm mid-refresh does not drop the HTML update', async function (assert) {
      let bookAId = `${testRealmURL}books/1`;
      let bookBId = `${testRealm2URL}books/other`;
      let staleDoc = entryCollectionDoc([
        { id: bookAId, indexGen: 1, htmlGen: 1, html: '<div>Mango v1</div>' },
        { id: bookBId, indexGen: 1, htmlGen: 1, html: '<div>Paper</div>' },
      ]);
      let freshDoc = entryCollectionDoc([
        { id: bookAId, indexGen: 1, htmlGen: 2, html: '<div>Mango v2</div>' },
        { id: bookBId, indexGen: 1, htmlGen: 1, html: '<div>Paper</div>' },
      ]);
      let fetchedRealms: string[][] = [];
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async (_query, realms) => {
        fetchedRealms.push([...(realms ?? [])].sort());
        return fetchedRealms.length === 1 ? staleDoc : freshDoc;
      };

      // The member GET never resolves, holding the selective refresh mid-GET
      // so the index event's restart lands while it is in flight.
      let getCount = 0;
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return new Promise(() => {});
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: {
              filter: { 'item.on': bookRef },
              realms: [testRealmURL, testRealm2URL],
            },
          },
        }));
        await search.loaded;
        assert.strictEqual(search.entries.length, 2);

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => getCount > 0, { timeout: 10_000 });

        // An incremental index event on the OTHER realm restarts the task
        // while the member GET is in flight. The queued HTML invalidation
        // must fold into the coarse re-run — not die with the cancelled run.
        getService('message-service').relayRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [],
          realmURL: testRealm2URL,
        });
        await waitUntil(
          () =>
            search.entries.find((e) => e.id === bookAId)?.htmlGeneration === 2,
          { timeout: 10_000 },
        );
        await settled();

        assert.deepEqual(
          fetchedRealms[fetchedRealms.length - 1],
          [testRealmURL, testRealm2URL].sort(),
          "the coarse re-run covers the prerender event's realm too",
        );
        assert.strictEqual(
          search.entries.find((e) => e.id === bookAId)?.html[0]?.html,
          '<div>Mango v2</div>',
          'the invalidated member picked up the fresh HTML through the fold',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a stylesheet-import failure during a member refresh falls back to a full re-run', async function (assert) {
      let cssHref = `${testRealmURL}book.gts.deadbeef.glimmer-scoped.css`;
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango v1</div>',
          },
        ]);
      };
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => ({
        notModified: false,
        doc: entrySingleDoc({
          id: `${testRealmURL}books/1`,
          indexGen: 1,
          htmlGen: 2,
          html: '<div>Mango v2</div>',
          cssHref,
        }),
      })) as typeof storeService.fetchCardEntry;
      // Stubbed on the loader current at event time: `loaderService.loader`
      // is a field the service REPLACES on reset/clone, so an instance
      // captured earlier (e.g. in beforeEach) can be stale by now.
      let importCalls: string[] = [];
      let stubbedLoader: Loader | undefined;
      let originalImport: Loader['import'] | undefined;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let baseline = searchCount;

        stubbedLoader = loaderService.loader;
        originalImport = stubbedLoader.import.bind(stubbedLoader);
        stubbedLoader.import = (async (url: string) => {
          importCalls.push(url);
          if (url === cssHref) {
            throw new Error('stylesheet fetch failed');
          }
          return originalImport!(url);
        }) as Loader['import'];

        relayPrerenderHtml([`${testRealmURL}books/1.json`], 2);
        await waitUntil(() => searchCount > baseline, { timeout: 10_000 });
        await settled();

        assert.true(
          importCalls.includes(cssHref),
          'the member refresh actually attempted the stylesheet import',
        );
        assert.ok(
          searchCount > baseline,
          'the failed stylesheet import falls back to the coarse re-run',
        );
        assert.strictEqual(
          search.entries[0]?.htmlGeneration,
          1,
          "the failed member's refresh was not applied",
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
        if (stubbedLoader && originalImport) {
          stubbedLoader.import = originalImport;
        }
      }
    });

    test('a row whose only change is its generation stamps keeps identity and adopts the stamps', async function (assert) {
      // The invalidation fan-out re-indexes dependents whose content is often
      // byte-identical — only the stamps move. Those rows must not remount
      // (identity preserved) but must carry the fresh stamps, or later events
      // would judge staleness against outdated generations.
      let docs = [
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
        ]),
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 2,
            htmlGen: 2,
            html: '<div>Mango</div>',
          },
        ]),
      ];
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => docs.shift() ?? docs[0];

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let before = search.entries[0];
        assert.strictEqual(before.htmlGeneration, 1);

        getService('message-service').relayRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${testRealmURL}books/1.json`],
          realmURL: testRealmURL,
        });
        await waitUntil(() => search.entries[0]?.htmlGeneration === 2, {
          timeout: 10_000,
        });
        await settled();

        assert.strictEqual(
          search.entries[0],
          before,
          'the content-unchanged row keeps its object identity',
        );
        assert.strictEqual(before.indexGeneration, 2, 'the stamps are adopted');
      } finally {
        storeService.searchEntries = originalSearchEntries;
      }
    });

    test('clearing the query mid-refresh stops the remaining member GETs', async function (assert) {
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () =>
        entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
          {
            id: `${testRealmURL}books/2`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Van Gogh</div>',
          },
        ]);

      // The first GET is held open; once the query is cleared and the GET
      // resolves, the (uncancellable) helper must not proceed to the second
      // member.
      let getCount = 0;
      let releaseFirstGet: (value: {
        notModified: false;
        doc: EntrySingleDocument;
      }) => void;
      let firstGet = new Promise<{
        notModified: false;
        doc: EntrySingleDocument;
      }>((resolve) => (releaseFirstGet = resolve));
      let originalFetchCardEntry =
        storeService.fetchCardEntry.bind(storeService);
      storeService.fetchCardEntry = (async () => {
        getCount++;
        return firstGet;
      }) as typeof storeService.fetchCardEntry;

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;

        relayPrerenderHtml(
          [`${testRealmURL}books/1.json`, `${testRealmURL}books/2.json`],
          2,
        );
        await waitUntil(() => getCount === 1, { timeout: 10_000 });

        search.modify([], { query: undefined });
        releaseFirstGet!({
          notModified: false,
          doc: entrySingleDoc({
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 2,
            html: '<div>Mango v2</div>',
          }),
        });
        await settled();

        assert.strictEqual(
          getCount,
          1,
          'no further member GET fires after the query is cleared',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
        storeService.fetchCardEntry = originalFetchCardEntry;
      }
    });

    test('a non-incremental index event does not re-run the search', async function (assert) {
      let searchCount = 0;
      let originalSearchEntries = storeService.searchEntries.bind(storeService);
      storeService.searchEntries = async () => {
        searchCount++;
        return entryCollectionDoc([
          {
            id: `${testRealmURL}books/1`,
            indexGen: 1,
            htmlGen: 1,
            html: '<div>Mango</div>',
          },
        ]);
      };

      try {
        let search = getResourceForTest(storeService, () => ({
          named: {
            query: { filter: { 'item.on': bookRef }, realms: [testRealmURL] },
          },
        }));
        await search.loaded;
        let baseline = searchCount;

        getService('message-service').relayRealmEvent({
          eventName: 'index',
          indexType: 'full',
          realmURL: testRealmURL,
        });
        await settled();

        assert.strictEqual(
          searchCount,
          baseline,
          'a full (non-incremental) index event leaves the search alone',
        );
      } finally {
        storeService.searchEntries = originalSearchEntries;
      }
    });

    // Exercises the real card+html GET (not stubbed) against the in-browser
    // realm: the validator the client reconstructs from a member's held
    // generations must match the server's composite ETag, or the 304 that keeps
    // a rendering live would never fire.
    test('the real card+html GET round-trips and its ETag matches the reconstructed validator', async function (assert) {
      let url = `${testRealmURL}books/1`;
      let first = await storeService.fetchCardEntry(url, {
        kind: 'card',
        format: 'fitted',
      });
      assert.false(first.notModified, 'the first GET returns the entry');
      if (!first.notModified) {
        let entry = first.doc.data;
        assert.strictEqual(entry.id, url);
        let htmlRef = entry.relationships.html?.data?.[0];
        assert.ok(htmlRef, 'the entry carries a rendering');
        let htmlResource = first.doc.included?.find(
          (resource) => resource.id === htmlRef!.id,
        );
        assert.ok(htmlResource, 'the rendering rides in included');

        // Reconstruct the composite validator the selective refresh sends,
        // from the generations the response carries — the same shape
        // `memberValidator` builds.
        let indexGeneration = (
          entry.meta as { generation?: number } | undefined
        )?.generation;
        let htmlGeneration = (
          htmlResource as { meta?: { generation?: number } } | undefined
        )?.meta?.generation;
        let validator = `"${indexGeneration ?? 0}:${htmlGeneration ?? 'none'}"`;

        let second = await storeService.fetchCardEntry(url, {
          kind: 'card',
          format: 'fitted',
          ifNoneMatch: validator,
        });
        assert.true(
          second.notModified,
          'the reconstructed validator matches the server ETag, so the GET 304s',
        );
      }
    });
  });

  test('an entry with an empty html array upgrades when its rendering lands on a later event', async function (assert) {
    let entryURL = `${testRealmURL}books/1`;
    let renderingId = htmlResourceId({
      url: entryURL,
      format: 'fitted',
      renderType: bookRef,
    });
    let cssHref = `${testRealmURL}book.gts.abc123.glimmer-scoped.css`;

    // The matched-but-not-yet-rendered shape: the html branch is pinned but
    // no rendering satisfies the htmlQuery yet.
    let unrenderedDoc: SearchEntryResults = {
      data: [
        {
          type: EntryResourceType,
          id: entryURL,
          relationships: { html: { data: [] } },
        },
      ],
      meta: { page: { total: 1 } },
    };
    let renderedDoc: SearchEntryResults = {
      data: [
        {
          type: EntryResourceType,
          id: entryURL,
          relationships: {
            html: { data: [{ type: HtmlResourceType, id: renderingId }] },
          },
        },
      ],
      included: [
        {
          type: HtmlResourceType,
          id: renderingId,
          attributes: {
            html: '<div>Mango</div>',
            cardType: 'Book',
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
          attributes: { href: cssHref },
        },
      ],
      meta: { page: { total: 1 } },
    };

    let docs = [unrenderedDoc, renderedDoc, renderedDoc];
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async () => docs.shift() ?? renderedDoc;
    let originalImport = loader.import.bind(loader);
    loader.import = (async (url: string) =>
      url === cssHref ? {} : originalImport(url)) as Loader['import'];

    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL],
          },
        },
      }));
      await search.loaded;

      assert.strictEqual(search.entries.length, 1);
      assert.deepEqual(
        search.entries[0].html,
        [],
        'the entry matched but carries no rendering yet',
      );

      // Any incremental event in the realm triggers the re-run that picks up
      // the landed rendering.
      await realm.write('books/9.json', bookDoc('Trigger'));
      await waitUntil(() => search.entries[0]?.html.length === 1, {
        timeout: 10_000,
      });

      let [rendering] = search.entries[0].html;
      assert.strictEqual(rendering.id, renderingId);
      assert.strictEqual(rendering.html, '<div>Mango</div>');
      assert.deepEqual(
        rendering.cssUrls,
        [cssHref],
        'the styles references resolve to the stylesheet hrefs',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
      loader.import = originalImport;
    }
  });

  test('an incremental event refreshes only its own realm, leaving other realms untouched', async function (assert) {
    let fetchedRealms: string[][] = [];
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (query, realms) => {
      fetchedRealms.push(realms ?? []);
      return await originalSearchEntries(query, realms);
    };

    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL, testRealm2URL],
          },
        },
      }));
      await search.loaded;

      assert.strictEqual(
        search.entries.length,
        3,
        'both realms contribute entries',
      );
      let entriesBefore = [...search.entries];
      let orderBefore = entriesBefore.map((entry) => entry.id);
      let realm2EntryBefore = entriesBefore.find(
        (entry) => entry.realmUrl === testRealm2URL,
      );
      assert.ok(realm2EntryBefore, 'realm 2 contributed an entry');

      await realm.write('books/3.json', bookDoc('Paper'));
      await waitUntil(() => search.entries.length === 4, { timeout: 10_000 });

      assert.deepEqual(
        fetchedRealms[fetchedRealms.length - 1],
        [testRealmURL],
        'the refresh fetch is scoped to the realm whose index moved',
      );
      assert.deepEqual(
        search.entries.map((entry) => entry.id),
        [...orderBefore, `${testRealmURL}books/3`],
        'surviving rows keep their positions; the new row appends',
      );
      let realm2EntryAfter = search.entries.find(
        (entry) => entry.realmUrl === testRealm2URL,
      );
      assert.strictEqual(
        realm2EntryAfter,
        realm2EntryBefore,
        "realm 2's entry keeps its identity through realm 1's refresh",
      );
      for (let entryBefore of entriesBefore.filter(
        (entry) => entry.realmUrl === testRealmURL,
      )) {
        assert.strictEqual(
          search.entries.find((entry) => entry.id === entryBefore.id),
          entryBefore,
          `unchanged refreshed row ${entryBefore.id} keeps its identity`,
        );
      }
      assert.strictEqual(search.meta.page.total, 4);
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
  });

  test('a paginated query takes a full re-run on an incremental event, keeping the server total', async function (assert) {
    let fetchedRealms: string[][] = [];
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (query, realms) => {
      fetchedRealms.push(realms ?? []);
      return await originalSearchEntries(query, realms);
    };

    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            page: { size: 2 },
            realms: [testRealmURL, testRealm2URL],
          },
        },
      }));
      await search.loaded;

      // federated pagination applies per realm: realm 1 contributes a full
      // page (2 of its 2 books), realm 2 its single book
      assert.strictEqual(search.entries.length, 3);
      assert.strictEqual(
        search.meta.page.total,
        3,
        'the server total spans all pages',
      );

      await realm.write('books/3.json', bookDoc('Paper'));
      await waitUntil(() => search.meta.page.total === 4, { timeout: 10_000 });

      assert.deepEqual(
        fetchedRealms[fetchedRealms.length - 1],
        [testRealmURL, testRealm2URL],
        'a paginated query re-fetches all realms — no realm-scoped splice',
      );
      assert.strictEqual(
        search.entries.length,
        3,
        "realm 1's contribution stays page-limited",
      );
      assert.strictEqual(
        search.meta.page.total,
        4,
        'the total stays server-accurate after the live update',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
  });

  test("an event in realm 2 refreshes realm 2's rows", async function (assert) {
    let search = getResourceForTest(storeService, () => ({
      named: {
        query: {
          filter: { 'item.on': bookRef },
          realms: [testRealmURL, testRealm2URL],
        },
      },
    }));
    await search.loaded;
    assert.strictEqual(search.entries.length, 3);

    await realm2.write(
      'books/another.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'Hassan', status: 'ready' },
          meta: {
            adoptsFrom: {
              module: testRRI('book'),
              name: 'Book',
            },
          },
        },
      }),
    );
    await waitUntil(() => search.entries.length === 4, { timeout: 10_000 });

    assert.ok(
      search.entries.find(
        (entry) => entry.id === `${testRealm2URL}books/another`,
      ),
      "realm 2's new book appears",
    );
  });

  test('does not re-fetch when the query is structurally unchanged', async function (assert) {
    let fetchCount = 0;
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (query, realms) => {
      fetchCount++;
      return await originalSearchEntries(query, realms);
    };

    try {
      let query: SearchEntryWireQuery = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      let search = getResourceForTest(storeService, () => ({
        named: { query },
      }));
      await search.loaded;
      assert.strictEqual(fetchCount, 1, 'initial search performed once');

      // a structurally-equal but referentially-new query must not re-run
      search.modify([], { query: JSON.parse(JSON.stringify(query)) });
      await settled();

      assert.strictEqual(fetchCount, 1, 'no re-fetch for a deep-equal query');

      search.modify([], {
        query: {
          filter: { 'item.on': bookRef, eq: { 'item.status': 'ready' } },
          realms: [testRealmURL],
        },
      });
      await settled();

      assert.strictEqual(fetchCount, 2, 'a changed query re-runs the search');
      assert.strictEqual(
        search.entries.length,
        1,
        'the new query narrows the result set',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
  });

  test('destroying the resource tears down its realm subscriptions', async function (this: RenderingTestContext, assert) {
    let fetchCount = 0;
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (query, realms) => {
      fetchCount++;
      return await originalSearchEntries(query, realms);
    };

    try {
      // The resource's lifetime is linked to its parent; destroying the
      // parent is what tears the resource down (`Resource.from` hands back a
      // lazy proxy, not the destroyable instance itself).
      let parent = {};
      setOwner(parent, this.owner);
      let search = getResourceForTest(parent, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL],
          },
        },
      }));
      await search.loaded;
      assert.strictEqual(fetchCount, 1);

      destroy(parent);
      await settled();

      await realm.write('books/3.json', bookDoc('Paper'));
      await settled();

      assert.strictEqual(
        fetchCount,
        1,
        'no fetch fires for a realm event after the resource is destroyed',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
  });

  test('a failed fetch surfaces errors; a later successful run clears them', async function (assert) {
    let failNext = true;
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (query, realms) => {
      if (failNext) {
        failNext = false;
        let err = new Error('search exploded') as Error & { status: number };
        err.status = 500;
        throw err;
      }
      return await originalSearchEntries(query, realms);
    };

    try {
      let search = getResourceForTest(storeService, () => ({
        named: {
          query: {
            filter: { 'item.on': bookRef },
            realms: [testRealmURL],
          },
        },
      }));
      await search.loaded;

      assert.strictEqual(search.entries.length, 0);
      assert.strictEqual(search.errors?.length, 1);
      assert.strictEqual(search.errors?.[0].type, 'instance-error');

      await realm.write('books/3.json', bookDoc('Paper'));
      await waitUntil(() => search.entries.length === 3, { timeout: 10_000 });

      assert.strictEqual(
        search.errors,
        undefined,
        'a successful re-run clears the errors',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
  });

  // modify() runs inside a tracked computation (property access on the
  // resource proxy during render), so these tests exercise the resource the
  // way a real component consumes it — any tracked read-then-write inside
  // modify() throws Glimmer's mutation-after-consumption assertion here,
  // which plain-JS consumption can never surface.
  module('rendered consumption', function () {
    class QueryState {
      @tracked query: SearchEntryWireQuery | undefined;
    }

    class Harness extends GlimmerComponent<{
      Args: { state: QueryState };
    }> {
      search = getSearchEntriesResource(this, () => this.args.state.query);
      <template>
        <div data-test-entry-count>{{this.search.entries.length}}</div>
      </template>
    }

    test('a rendered consumer activates from an idle query and clears back to idle', async function (assert) {
      let state = new QueryState();

      await render(<template><Harness @state={{state}} /></template>);
      assert
        .dom('[data-test-entry-count]')
        .hasText('0', 'an idle (undefined) query renders empty');

      state.query = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };
      await settled();
      assert
        .dom('[data-test-entry-count]')
        .hasText('2', 'setting the query activates the search');

      state.query = undefined;
      await settled();
      assert
        .dom('[data-test-entry-count]')
        .hasText('0', 'returning to idle clears the standing entries');

      state.query = {
        filter: { 'item.on': bookRef, eq: { 'item.status': 'ready' } },
        realms: [testRealmURL],
      };
      await settled();
      assert
        .dom('[data-test-entry-count]')
        .hasText('1', 'a fresh query after idle re-activates');
    });

    test('changing realms while entries are standing re-runs cleanly', async function (assert) {
      let state = new QueryState();
      state.query = {
        filter: { 'item.on': bookRef },
        realms: [testRealmURL],
      };

      await render(<template><Harness @state={{state}} /></template>);

      assert.dom('[data-test-entry-count]').hasText('2');

      state.query = {
        filter: { 'item.on': bookRef },
        realms: [testRealm2URL],
      };
      await settled();
      assert
        .dom('[data-test-entry-count]')
        .hasText('1', "only the new realm's entries remain after the re-run");
    });
  });
});
