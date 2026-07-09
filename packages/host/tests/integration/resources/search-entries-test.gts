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

  test('re-runs the search on a prerender_html event; other realm events leave it alone', async function (assert) {
    let fetchCount = 0;
    let originalSearchEntries = storeService.searchEntries.bind(storeService);
    storeService.searchEntries = async (...args) => {
      fetchCount++;
      return originalSearchEntries(...args);
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
      let baseline = fetchCount;

      // The realm-server broadcasts prerender_html when fresh HTML lands on
      // its own channel after the index pass; the in-browser test realm
      // renders fused and never emits one, so inject it synthetically.
      getService('message-service').relayRealmEvent({
        eventName: 'prerender_html',
        realmURL: testRealmURL,
        generation: 2,
        invalidations: [`${testRealmURL}books/1.json`],
      });
      await waitUntil(() => fetchCount > baseline, { timeout: 10_000 });
      await settled();
      assert.ok(
        fetchCount > baseline,
        'a prerender_html event re-runs the search',
      );

      let afterPrerender = fetchCount;
      getService('message-service').relayRealmEvent({
        eventName: 'index',
        indexType: 'full',
        realmURL: testRealmURL,
      });
      await settled();
      assert.strictEqual(
        fetchCount,
        afterPrerender,
        'a non-incremental index event does not re-run the search',
      );
    } finally {
      storeService.searchEntries = originalSearchEntries;
    }
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
