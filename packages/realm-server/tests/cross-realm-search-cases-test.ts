import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  parseSearchEntryQueryFromPayload,
  searchEntryRealms,
  type SearchEntryQuery,
} from '@cardstack/runtime-common/search-entry';
import {
  hasWarning,
  IndexQueryEngine,
  IndexWriter,
  VectorSerializer,
  VirtualNetwork,
  hasVectorIndex,
  internalKeyFor,
  parseRealmsFromPayload,
  rri,
  searchEntryWireQueryFromQuery,
  type Definition,
  type DefinitionLookup,
  type EntryCollectionDocument,
  type EntryResource,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  assertRealmsBound,
  resetSearchBoundsForTests,
  setSearchBoundsForTests,
} from '@cardstack/runtime-common/search-bounds';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';
import { withFacetFields } from './helpers/facet-fields.ts';

// One search over several realms, end to end on real rows.
//
// Each realm's rows are written to one test database through the real index
// writer, under that realm's URL. A realm answers the way a realm's engine
// does (`IndexQueryEngine.search` for its own URL), and `searchEntryRealms`
// (what the `_federated-search` route calls) fans the query out and merges.
// Every expectation is computed here, in plain JavaScript, over ALL rows of
// all realms: a comparator, a count, or the rank-fusion formula from
// `docs/search.md`.
//
// Not reached from here (they live in the HTTP route and its middleware, and
// have their own endpoint tests): which realms a caller may read, a realm the
// registry does not know, and the request's time budget.

const A = 'http://realm-a/';
const B = 'http://realm-b/';
const C = 'http://realm-c/';

const itemRef: ResolvedCodeRef = {
  module: 'http://realm-a/item' as ResolvedCodeRef['module'],
  name: 'Item',
};

const text = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: { module: '@cardstack/base/string', name: 'default' },
};
const number = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: { module: '@cardstack/base/number', name: 'default' },
  serializerName: 'number',
};

const itemDef = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: {
    title: 'title',
    brand: 'brand',
    group: 'text',
    code: 'text',
    price: 'number',
    stock: 'number',
    views: 'number',
    embedding: 'vector',
  },
  fieldDefs: {
    title: { ...text, search: { role: 'title' } },
    // The one field the facets count: declared, as a facet must be.
    brand: { ...text, search: { facet: true } },
    text,
    number,
    vector: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: '@cardstack/base/vector', name: 'default' },
      serializerName: 'vector',
    },
  },
} as unknown as Definition;

function itemLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === itemRef.module && codeRef.name === itemRef.name) {
        return itemDef;
      }
      throw new Error(`unexpected definition lookup: ${codeRef.module}`);
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// A fixture row. A member left out is a card with no value there.
type Row = {
  id: string;
  title?: string;
  brand?: string;
  group?: string;
  code?: string;
  price?: number;
  stock?: number;
  views?: number;
  embedding?: number[];
};
type Placed = Row & { realm: string; url: string };
type Corpus = Record<string, Row[]>;

const urlOf = (realm: string, id: string) => `${realm}${id}.json`;

function placed(corpus: Corpus, realms: string[]): Placed[] {
  return realms.flatMap((realm) =>
    corpus[realm].map((row) => ({ ...row, realm, url: urlOf(realm, row.id) })),
  );
}

// 'http://realm-a/a1.json' reads as 'a/a1'.
const label = (url: string) =>
  url.replace('http://realm-', '').replace(/\.json$/, '');
const labels = (doc: { data: { id?: string }[] }) =>
  doc.data.map((entry) => label(entry.id!));
const labelsOf = (rows: Placed[]) => rows.map((row) => label(row.url));

// Text compared one code unit at a time. For the ASCII in these fixtures
// this is the order the engine's url tiebreak uses (`COLLATE "POSIX"`).
const byCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Key = {
  by: 'price' | 'stock' | 'views' | 'code' | 'brand';
  direction?: 'asc' | 'desc';
  missing?: 'first' | 'last';
};

// The global order: every row of every realm sorted once by the query's
// keys. A row with no value goes last whichever way the key runs, unless the
// key says `missing: 'first'` (docs: "they go last by default"). Rows equal on
// every key come in order of their url.
function globalOrder(rows: Placed[], keys: Key[]): Placed[] {
  return [...rows].sort((a, b) => {
    for (let key of keys) {
      let x = a[key.by];
      let y = b[key.by];
      if (x === y) continue;
      if (x === undefined || y === undefined) {
        let missingFirst = key.missing === 'first' ? -1 : 1;
        return x === undefined ? missingFirst : -missingFirst;
      }
      let cmp =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : byCodeUnits(String(x), String(y));
      return key.direction === 'desc' ? -cmp : cmp;
    }
    return byCodeUnits(a.url, b.url);
  });
}

const sortBy = (keys: Key[]) =>
  keys.map((key) => ({ ...key, on: itemRef })) as Query['sort'];

// The request a caller sends: an ordinary query in its wire form, the realms,
// and how the answer is shaped.
function federatedQuery(
  realms: string[],
  results: 'merged' | 'byRealm' | undefined,
  query: Query,
): SearchEntryQuery {
  return parseSearchEntryQueryFromPayload({
    ...searchEntryWireQueryFromQuery(query),
    realms,
    ...(results ? { federation: { results } } : {}),
  });
}

type RealmStandIn = {
  url: string;
  searchEntries: (q: SearchEntryQuery) => Promise<EntryCollectionDocument>;
};

function engineRealms(hooks: NestedHooks, corpus: Corpus) {
  let ctx = {} as {
    adapter: PgAdapter;
    engine: IndexQueryEngine;
    vectors: boolean;
    realm: (url: string) => RealmStandIn;
    search: (
      realms: string[],
      results: 'merged' | 'byRealm' | undefined,
      query: Query,
    ) => Promise<EntryCollectionDocument>;
    own: (realm: string, query: Query) => Promise<EntryCollectionDocument>;
  };
  hooks.beforeEach(async function () {
    prepareTestDB();
    ctx.adapter = await createTestPgAdapter();
    ctx.vectors = await hasVectorIndex(ctx.adapter);
    let network = new VirtualNetwork();
    ctx.engine = new IndexQueryEngine(ctx.adapter, itemLookup(), network);
    let itemKey = internalKeyFor(itemRef, undefined, network);
    for (let [realmURL, rows] of Object.entries(corpus)) {
      let batch = await new IndexWriter(ctx.adapter).createBatch(
        new URL(realmURL),
        network,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let { id, embedding, ...fields } of rows) {
        let cardURL = new URL(urlOf(realmURL, id));
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(itemRef.module), name: 'Item' } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: await withFacetFields(
            {
              ...fields,
              ...(embedding && ctx.vectors
                ? {
                    embedding: VectorSerializer.queryableValue(
                      VectorSerializer.encodeVector(embedding),
                    ),
                  }
                : {}),
              ...(fields.title ? { _searchText: { A: fields.title } } : {}),
            },
            itemDef,
            itemLookup(),
          ),
          ...(fields.title ? { markdown: fields.title } : {}),
          deps: new Set(),
          displayNames: ['Item'],
          types: [itemKey],
          isolatedHtml: `<div>${id}</div>`,
        });
      }
      await batch.done();
    }
    // A realm, answering a search of its own rows with the real engine and
    // carrying on each entry what a realm's entries carry: its scores and,
    // when the merge asks, the values it was sorted by.
    ctx.realm = (url: string) => ({
      url,
      searchEntries: async (q: SearchEntryQuery) => {
        let { results, meta } = await ctx.engine.search(
          new URL(url),
          q.itemQuery,
          q.exposeSortValues ? { exposeSortValues: true } : {},
          { kind: 'dataOnly' },
        );
        let carried = [
          '_matchRelevance',
          '_nearSimilarity',
          '_blendScore',
          '_collapseSize',
          '_sortValues',
        ];
        return {
          data: results.map((row: any) => ({
            type: 'entry' as const,
            id: row.url,
            relationships: {},
            meta: Object.fromEntries(
              carried
                .filter((k) => row[k] !== undefined)
                .map((k) => [
                  k,
                  k === '_sortValues' || row[k] == null
                    ? row[k]
                    : Number(row[k]),
                ]),
            ) as EntryResource['meta'],
          })),
          meta,
        } as EntryCollectionDocument;
      },
    });
    ctx.search = (realms, results, query) =>
      searchEntryRealms(
        realms.map((url) => ctx.realm(url)),
        federatedQuery(realms, results, query),
      );
    // One realm's own search of the same query, with no federation.
    ctx.own = (realm, query) =>
      ctx
        .realm(realm)
        .searchEntries(
          parseSearchEntryQueryFromPayload(
            searchEntryWireQueryFromQuery(query),
          ),
        );
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(ctx.adapter);
  });
  return ctx;
}

// Three realms of items. Prices tie inside a realm and across realms
// (20 is held by a2, a3, b1 and c1; a3, b1 and c1 tie on stock too), and some
// rows have no price, no stock or no group. 'core' and 'dash' are brands only
// one realm holds.
const shop: Corpus = {
  [A]: [
    { id: 'a1', brand: 'acme', group: 'g1', price: 10, stock: 3 },
    { id: 'a2', brand: 'acme', group: 'g1', price: 20, stock: 1 },
    { id: 'a3', brand: 'bolt', group: 'g2', price: 20, stock: 2 },
    { id: 'a4', brand: 'bolt', price: 40 },
    { id: 'a5', brand: 'acme', stock: 5 },
  ],
  [B]: [
    { id: 'b1', brand: 'acme', group: 'g1', price: 20, stock: 2 },
    { id: 'b2', brand: 'core', group: 'g3', price: 5, stock: 1 },
    { id: 'b3', brand: 'bolt', group: 'g2', price: 30 },
    { id: 'b4', brand: 'core', stock: 4 },
  ],
  [C]: [
    { id: 'c1', brand: 'dash', price: 20, stock: 2 },
    { id: 'c2', brand: 'acme', price: 15, stock: 9 },
  ],
};
const everyItem: Query['filter'] = { type: itemRef };

module(basename(import.meta.filename), function () {
  module('merged: one list in the order of the sort', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let all = placed(shop, [A, B, C]);

    test('an ascending field sort over three realms is the global sort of all their rows', async function (assert) {
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy([{ by: 'price', direction: 'asc' }]),
        page: { size: 50 },
      });
      assert.deepEqual(
        labels(doc),
        labelsOf(globalOrder(all, [{ by: 'price', direction: 'asc' }])),
      );
    });

    test('a descending field sort over three realms is the global sort of all their rows', async function (assert) {
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy([{ by: 'price', direction: 'desc' }]),
        page: { size: 50 },
      });
      assert.deepEqual(
        labels(doc),
        labelsOf(globalOrder(all, [{ by: 'price', direction: 'desc' }])),
      );
    });

    // The engine's last sort key is the card's url, ascending, whichever way
    // the sort runs (a code comment says so; docs/search.md does not), so
    // that is the tie-break a merged list must keep.
    test('rows that tie across realms come in order of their url, whichever way the sort runs', async function (assert) {
      for (let direction of ['asc', 'desc'] as const) {
        let doc = await ctx.search([C, B, A], 'merged', {
          filter: { on: itemRef, eq: { price: 20 } },
          sort: sortBy([{ by: 'price', direction }]),
          page: { size: 50 },
        });
        assert.deepEqual(
          labels(doc),
          ['a/a2', 'a/a3', 'b/b1', 'c/c1'],
          `${direction}: by url, not by the order the realms were named in`,
        );
      }
    });

    test('rows with no value for the sort key come last, ascending and descending', async function (assert) {
      for (let direction of ['asc', 'desc'] as const) {
        let doc = await ctx.search([A, B, C], 'merged', {
          filter: everyItem,
          sort: sortBy([{ by: 'price', direction }]),
          page: { size: 50 },
        });
        assert.deepEqual(
          labels(doc).slice(-2),
          ['a/a5', 'b/b4'],
          `${direction}: the two rows with no price are last, by url`,
        );
      }
    });

    test("in one realm, missing: 'first' puts the rows with no value first", async function (assert) {
      let keys: Key[] = [{ by: 'price', direction: 'asc', missing: 'first' }];
      let own = await ctx.own(A, {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(
        labels(own),
        labelsOf(globalOrder(placed(shop, [A]), keys)),
      );
    });

    test("missing: 'first' puts the rows with no value first in the merged list too", async function (assert) {
      let keys: Key[] = [{ by: 'price', direction: 'asc', missing: 'first' }];
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(labels(doc), labelsOf(globalOrder(all, keys)));
    });

    test('a two-key sort orders by the second key inside a tie on the first, across realms', async function (assert) {
      let keys: Key[] = [
        { by: 'price', direction: 'asc' },
        { by: 'stock', direction: 'desc' },
      ];
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(labels(doc), labelsOf(globalOrder(all, keys)));
    });

    test('a two-key sort places rows with no value for either key', async function (assert) {
      let keys: Key[] = [
        { by: 'stock', direction: 'asc' },
        { by: 'price', direction: 'desc' },
      ];
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(labels(doc), labelsOf(globalOrder(all, keys)));
    });
  });

  module('merged: text keys', function (hooks) {
    // Codes are text that happens to hold digits.
    let codes: Corpus = {
      [A]: [
        { id: 'a1', code: '10' },
        { id: 'a2', code: '9' },
      ],
      [B]: [
        { id: 'b1', code: '100' },
        { id: 'b2', code: '25' },
      ],
    };
    let ctx = engineRealms(hooks, codes);

    // Text sorts as text: '10' < '100' < '25' < '9' in every collation, since
    // each differs from the next at a digit. One realm orders them so; the
    // merged list must as well.
    test('in one realm, a text key holding digits sorts as text', async function (assert) {
      let own = await ctx.own(A, {
        filter: everyItem,
        sort: sortBy([{ by: 'code', direction: 'asc' }]),
        page: { size: 50 },
      });
      assert.deepEqual(labels(own), ['a/a1', 'a/a2'], "'10' before '9'");
    });

    test('a text key holding digits sorts as text across realms, as it does in one realm', async function (assert) {
      let keys: Key[] = [{ by: 'code', direction: 'asc' }];
      let doc = await ctx.search([A, B], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(
        doc.data.map((entry) => label(entry.id!)),
        labelsOf(globalOrder(placed(codes, [A, B]), keys)),
        "codes in order: '10', '100', '25', '9'",
      );
    });
  });

  module('merged: url tie-break', function (hooks) {
    // Every row has the same price, so the url alone orders them. Upper-case
    // letters come before lower-case ones in the engine's url order.
    let tied: Corpus = {
      [A]: [
        { id: 'Zed', price: 1 },
        { id: 'apple', price: 1 },
      ],
      [B]: [
        { id: 'Yak', price: 1 },
        { id: 'bee', price: 1 },
      ],
    };
    let ctx = engineRealms(hooks, tied);
    let query: Query = {
      filter: everyItem,
      sort: sortBy([{ by: 'price', direction: 'asc' }]),
      page: { size: 50 },
    };

    test('one realm orders tied rows by url, upper case before lower case', async function (assert) {
      assert.deepEqual(labels(await ctx.own(A, query)), ['a/Zed', 'a/apple']);
    });

    test('a merged search of one realm keeps tied rows in the order that realm gives them', async function (assert) {
      assert.deepEqual(labels(await ctx.search([A], 'merged', query)), [
        'a/Zed',
        'a/apple',
      ]);
    });

    test('a merged search of two realms breaks ties by url as one realm does', async function (assert) {
      assert.deepEqual(
        labels(await ctx.search([A, B], 'merged', query)),
        labelsOf(
          globalOrder(placed(tied, [A, B]), [
            { by: 'price', direction: 'asc' },
          ]),
        ),
        'a/Zed, a/apple, b/Yak, b/bee',
      );
    });
  });

  module('byRealm: a section per realm', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let keys: Key[] = [{ by: 'price', direction: 'desc' }];
    let section = (realm: string) =>
      labelsOf(globalOrder(placed(shop, [realm]), keys));

    test("each section is that realm's own answer, sections in the order asked", async function (assert) {
      let doc = await ctx.search([B, C, A], undefined, {
        filter: everyItem,
        sort: sortBy(keys),
        page: { size: 50 },
      });
      assert.deepEqual(labels(doc), [
        ...section(B),
        ...section(C),
        ...section(A),
      ]);
      assert.deepEqual(doc.meta.sections, [
        { realm: B, count: 4 },
        { realm: C, count: 2 },
        { realm: A, count: 5 },
      ]);
      assert.deepEqual(doc.meta.federation, { results: 'byRealm' });
    });

    test('each realm pages on its own, and the total counts every match of every realm', async function (assert) {
      let page = (number: number) =>
        ctx.search([A, B, C], 'byRealm', {
          filter: everyItem,
          sort: sortBy(keys),
          page: { number, size: 2, total: 'exact' },
        });
      let first = await page(0);
      assert.deepEqual(labels(first), [
        ...section(A).slice(0, 2),
        ...section(B).slice(0, 2),
        ...section(C).slice(0, 2),
      ]);
      assert.strictEqual(first.meta.page.total, 11);
      assert.true(first.meta.page.hasMore, 'A and B hold more');
      let third = await page(2);
      assert.deepEqual(
        labels(third),
        section(A).slice(4, 6),
        'only A reaches a third page',
      );
      assert.deepEqual(third.meta.sections, [
        { realm: A, count: 1 },
        { realm: B, count: 0 },
        { realm: C, count: 0 },
      ]);
      assert.false(third.meta.page.hasMore);
    });
  });

  module('merged: paging', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let keys: Key[] = [
      { by: 'price', direction: 'asc' },
      { by: 'stock', direction: 'desc' },
    ];
    let whole = labelsOf(globalOrder(placed(shop, [A, B, C]), keys));
    let page = (number: number, size: number, total?: 'exact' | 'none') =>
      ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        page: { number, size, ...(total ? { total } : {}) },
      });

    test('pages laid end to end are the whole merged list, with no row twice and none left out', async function (assert) {
      for (let size of [1, 3, 4]) {
        let seen: string[] = [];
        for (let number = 0; number * size < whole.length; number++) {
          seen.push(...labels(await page(number, size)));
        }
        assert.deepEqual(seen, whole, `page size ${size}`);
      }
    });

    test('hasMore says whether a row follows the page', async function (assert) {
      // 11 rows in pages of 4: rows follow pages 0 and 1, none follows page 2.
      assert.deepEqual(
        [
          (await page(0, 4)).meta.page.hasMore,
          (await page(1, 4)).meta.page.hasMore,
          (await page(2, 4)).meta.page.hasMore,
        ],
        [true, true, false],
      );
      assert.false(
        (await page(0, 11)).meta.page.hasMore,
        'a page that ends on the last row has no next page',
      );
    });

    test('a page past the end is empty, has no next page and still reports the total', async function (assert) {
      let doc = await page(5, 4, 'exact');
      assert.deepEqual(labels(doc), []);
      assert.false(doc.meta.page.hasMore);
      assert.strictEqual(doc.meta.page.total, 11);
    });

    test("total: 'exact' is the number of matches in all realms, on every page", async function (assert) {
      for (let number of [0, 1, 2]) {
        let doc = await page(number, 4, 'exact');
        assert.strictEqual(doc.meta.page.total, 11, `page ${number}`);
        assert.notOk(
          hasWarning(doc.meta, 'total-estimated'),
          'and is no estimate',
        );
      }
    });

    test('the default total (capped) is exact while every realm is under the cap', async function (assert) {
      // The cap is 1,000 matches a realm; the largest realm here holds 5.
      for (let number of [0, 1, 2]) {
        let doc = await page(number, 4);
        assert.strictEqual(doc.meta.page.total, 11, `page ${number}`);
        assert.notOk(hasWarning(doc.meta, 'total-estimated'));
      }
    });

    test('meta.realms reports each realm as ok with its own total', async function (assert) {
      let doc = await page(0, 4, 'exact');
      let realms = doc.meta.realms!;
      assert.deepEqual(
        [A, B, C].map((realm) => [realm, realms[realm].status]),
        [
          [A, 'ok'],
          [B, 'ok'],
          [C, 'ok'],
        ],
      );
      assert.deepEqual(
        [A, B, C].map((realm) => realms[realm].total),
        [5, 4, 2],
      );
      assert.notOk(doc.meta.incomplete);
    });

    // pins current behavior; rule not yet decided. docs/search.md says of
    // `none` that "the total is the rows seen so far". Merged, each realm is
    // asked for the first `offset + size` rows and reads one more to answer
    // hasMore, and the total is the sum of what each realm read: here 3 of
    // A's 5, 3 of B's 4 and both of C's, 8, while the caller has seen 2.
    test("total: 'none' reports the rows the realms read between them, flagged as an estimate", async function (assert) {
      let doc = await page(0, 2, 'none');
      assert.deepEqual(labels(doc), whole.slice(0, 2));
      assert.true(doc.meta.page.hasMore);
      // decided: under 'none' each realm reports the rows up to and on its
      // page (offset + rows returned, no look-ahead row), and the merge sums
      // them
      assert.strictEqual(doc.meta.page.total, 2 + 2 + 2);
      assert.true(hasWarning(doc.meta, 'total-estimated'));
    });

    test("total: 'none' is exact on a page with no next page", async function (assert) {
      // docs/search.md: "A page with no next page is always counted exactly,
      // whatever the mode."
      let last = await page(2, 4, 'none');
      assert.false(last.meta.page.hasMore);
      assert.strictEqual(last.meta.page.total, 11);
      assert.notOk(hasWarning(last.meta, 'total-estimated'));
    });
  });

  module('facets across realms', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let all = placed(shop, [A, B, C]);
    let countBy = (rows: Placed[]) => {
      let counts: Record<string, number> = {};
      for (let row of rows) {
        if (row.brand !== undefined) {
          counts[row.brand] = (counts[row.brand] ?? 0) + 1;
        }
      }
      return counts;
    };
    let asCounts = (facet: { value: string; count: number }[] | undefined) =>
      Object.fromEntries((facet ?? []).map((c) => [c.value, c.count]));

    test('a facet counts every match of every realm, values held by one realm included', async function (assert) {
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: { on: itemRef, range: { price: { gte: 10 } } },
        sort: sortBy([{ by: 'price', direction: 'asc' }]),
        facets: [{ by: 'brand' }],
        page: { size: 2 },
      });
      let expected = countBy(
        all.filter((r) => r.price !== undefined && r.price >= 10),
      );
      // acme 4 (a1, a2, b1, c2), bolt 3 (a3, a4, b3), dash 1 (c1 alone);
      // core has no row at 10 or more.
      assert.deepEqual(expected, { acme: 4, bolt: 3, dash: 1 });
      assert.deepEqual(asCounts(doc.meta.facets?.brand), expected);
      assert.deepEqual(
        doc.meta.facets?.brand.map((c) => c.value),
        ['acme', 'bolt', 'dash'],
        'most common first',
      );
      assert.strictEqual(doc.data.length, 2, 'the page does not limit it');
    });

    test('byRealm sections carry the same facet counts as the merged list', async function (assert) {
      let doc = await ctx.search([A, B, C], 'byRealm', {
        filter: everyItem,
        facets: [{ by: 'brand' }],
        page: { size: 1 },
      });
      assert.deepEqual(asCounts(doc.meta.facets?.brand), countBy(all));
    });

    test("own: 'ignore' counts each brand of every realm without the brand selection, keeping the other filters", async function (assert) {
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: {
          every: [
            { type: itemRef },
            { on: itemRef, in: { brand: ['bolt'] } },
            { on: itemRef, range: { price: { lte: 20 } } },
          ],
        },
        sort: sortBy([{ by: 'price', direction: 'asc' }]),
        facets: [{ by: 'brand', own: 'ignore' }],
        page: { size: 50 },
      });
      assert.deepEqual(labels(doc), ['a/a3'], 'the rows keep the selection');
      // At 20 or less: acme a1, a2, b1, c2; bolt a3; core b2; dash c1.
      let expected = countBy(
        all.filter((r) => r.price !== undefined && r.price <= 20),
      );
      assert.deepEqual(expected, { acme: 4, bolt: 1, core: 1, dash: 1 });
      assert.deepEqual(asCounts(doc.meta.facets?.brand), expected);
    });

    test('size keeps the values most common over all realms, and reports no possible shortfall when every realm answered all its values', async function (assert) {
      let doc = await ctx.search([A, B, C], 'merged', {
        filter: everyItem,
        facets: [{ by: 'brand', size: 2 }],
        page: { size: 1 },
      });
      // Over all rows: acme 5 (a1, a2, a5, b1, c2), bolt 3 (a3, a4, b3),
      // core 2, dash 1.
      assert.deepEqual(doc.meta.facets?.brand, [
        { value: 'acme', count: 5 },
        { value: 'bolt', count: 3 },
      ]);
      // No realm holds as many brands as it was asked for, so no count can
      // be short.
      assert.deepEqual(doc.meta.facetErrors, { brand: 0 });
    });
  });

  module('blend (rank fusion) across realms', function (hooks) {
    let lots: Corpus = {
      [A]: [
        { id: 'a1', views: 100, price: 50 },
        { id: 'a2', views: 90, price: 40 },
        { id: 'a3', views: 80, price: 30 },
      ],
      [B]: [
        { id: 'b1', views: 10, price: 20 },
        { id: 'b2', views: 5, price: 10 },
      ],
    };
    let ctx = engineRealms(hooks, lots);

    type Signal = {
      by: 'views' | 'price';
      direction?: 'asc' | 'desc';
      weight?: number;
    };
    // Reciprocal rank fusion as docs/search.md states it: each card scores
    // sum(weight / (k + rank)) over the signals, each signal ranked best
    // first (highest first unless it says asc) over the given rows, k = 60.
    // No two rows here share a value, so ranks are 1, 2, 3...
    function fuse(rows: Placed[], signals: Signal[], k = 60) {
      let score = new Map(rows.map((row) => [row.url, 0]));
      for (let signal of signals) {
        let ranked = [...rows].sort((a, b) =>
          signal.direction === 'asc'
            ? a[signal.by]! - b[signal.by]!
            : b[signal.by]! - a[signal.by]!,
        );
        ranked.forEach((row, index) => {
          score.set(
            row.url,
            score.get(row.url)! + (signal.weight ?? 1) / (k + index + 1),
          );
        });
      }
      return score;
    }
    let byScore = (rows: Placed[], score: Map<string, number>) =>
      [...rows].sort(
        (a, b) =>
          score.get(b.url)! - score.get(a.url)! || byCodeUnits(a.url, b.url),
      );
    let blendOf = (signals: Signal[]): Query => ({
      filter: everyItem,
      sort: [
        {
          by: '_blend',
          of: signals.map((signal) => ({ ...signal, on: itemRef })),
        },
      ] as unknown as Query['sort'],
      page: { size: 50 },
    });
    let two: Signal[] = [
      { by: 'views' },
      { by: 'price', direction: 'asc', weight: 2 },
    ];

    test('within one realm the order and the scores are the rank fusion of its rows', async function (assert) {
      let rows = placed(lots, [A]);
      let score = fuse(rows, two);
      let doc = await ctx.search([A], 'merged', blendOf(two));
      assert.deepEqual(labels(doc), labelsOf(byScore(rows, score)));
      // By hand: a3 = 1/63 + 2/61, a2 = 1/62 + 2/62, a1 = 1/61 + 2/63.
      assert.deepEqual(labels(doc), ['a/a3', 'a/a2', 'a/a1']);
      for (let entry of doc.data) {
        assert.true(
          Math.abs(
            (entry.meta?._blendScore as number) - score.get(entry.id!)!,
          ) < 1e-9,
          `${label(entry.id!)} scores ${score.get(entry.id!)}`,
        );
      }
    });

    // The merge's exact rule: each realm fuses ranks over its OWN matches,
    // each row carries that score, and the merged list is those scores
    // highest first, url ascending on a tie. No rank is computed across
    // realms.
    test("the merged order is each row's own-realm fused score, highest first, ties by url", async function (assert) {
      let rows = placed(lots, [A, B]);
      let ownRealm = new Map([
        ...fuse(placed(lots, [A]), two),
        ...fuse(placed(lots, [B]), two),
      ]);
      let doc = await ctx.search([A, B], 'merged', blendOf(two));
      assert.deepEqual(labels(doc), labelsOf(byScore(rows, ownRealm)));
      for (let entry of doc.data) {
        assert.true(
          Math.abs(
            (entry.meta?._blendScore as number) - ownRealm.get(entry.id!)!,
          ) < 1e-9,
          `${label(entry.id!)} carries its own realm's score`,
        );
      }
    });

    // The size of "approximately" (docs: "each realm ranks its own matches,
    // so a merged federated blend orders only approximately"). One signal,
    // most viewed first. A single rank fusion over all five rows is
    // a1 (100), a2 (90), a3 (80), b1 (10), b2 (5). Merged, every realm's
    // best row scores 1/61 and every realm's second 1/62, so the realms
    // interleave by position: b1 with 10 views comes ahead of a2 with 90.
    test('a merged blend interleaves realms by own-realm rank, which is not the rank fusion of all rows', async function (assert) {
      let views: Signal[] = [{ by: 'views' }];
      let rows = placed(lots, [A, B]);
      let global = labelsOf(byScore(rows, fuse(rows, views)));
      assert.deepEqual(global, ['a/a1', 'a/a2', 'a/a3', 'b/b1', 'b/b2']);
      let doc = await ctx.search([A, B], 'merged', blendOf(views));
      assert.deepEqual(
        labels(doc),
        ['a/a1', 'b/b1', 'a/a2', 'b/b2', 'a/a3'],
        'own-realm ranks 1, 1, 2, 2, 3; ties by url',
      );
      assert.notDeepEqual(labels(doc), global);
    });

    test("byRealm keeps each realm's fused order and puts the section with the best score first", async function (assert) {
      let doc = await ctx.search([B, A], 'byRealm', blendOf(two));
      let a = placed(lots, [A]);
      let b = placed(lots, [B]);
      // B's best (b2 = 1/62 + 2/61) beats A's best (a3 = 1/63 + 2/61).
      assert.deepEqual(labels(doc), [
        ...labelsOf(byScore(b, fuse(b, two))),
        ...labelsOf(byScore(a, fuse(a, two))),
      ]);
      assert.deepEqual(
        doc.meta.sections?.map((s) => s.realm),
        [B, A],
      );
    });
  });

  module('near (vector similarity) across realms', function (hooks) {
    let target = [1, 0, 0];
    let shapes: Corpus = {
      [A]: [
        { id: 'a1', embedding: [1, 0, 0] },
        { id: 'a2', embedding: [0, 1, 0] },
        { id: 'a3' },
      ],
      [B]: [
        { id: 'b1', embedding: [1, 1, 0] },
        { id: 'b2', embedding: [-1, 0, 0] },
        { id: 'b3', embedding: [2, 1, 0] },
      ],
    };
    let ctx = engineRealms(hooks, shapes);
    // These need pgvector; on a database without it each passes with a note.
    function pgvectorTest(name: string, fn: (assert: Assert) => Promise<void>) {
      test(name, async (assert) => {
        if (!ctx.vectors) {
          assert.ok(true, 'skipped: this Postgres has no pgvector');
          return;
        }
        await fn(assert);
      });
    }
    let cosine = (v: number[]) =>
      (v[0] * target[0] + v[1] * target[1] + v[2] * target[2]) /
      Math.hypot(...v);

    // Cosine similarity to one target means the same in every realm, so the
    // merged order is the global one: 1 (a1), 0.894 (b3), 0.707 (b1), 0 (a2),
    // -1 (b2), then the row with no vector.
    pgvectorTest(
      'a merged near sort is the global order by cosine similarity, rows with no vector last',
      async function (assert) {
        let rows = placed(shapes, [A, B]);
        let expected = [...rows].sort((x, y) => {
          if (!x.embedding || !y.embedding) {
            return x.embedding ? -1 : y.embedding ? 1 : 0;
          }
          return cosine(y.embedding) - cosine(x.embedding);
        });
        let doc = await ctx.search([A, B], 'merged', {
          filter: everyItem,
          sort: [
            { on: itemRef, by: 'embedding', near: target },
          ] as unknown as Query['sort'],
          page: { size: 50 },
        });
        assert.deepEqual(labels(doc), labelsOf(expected));
        assert.deepEqual(labels(doc), [
          'a/a1',
          'b/b3',
          'b/b1',
          'a/a2',
          'b/b2',
          'a/a3',
        ]);
        for (let entry of doc.data.slice(0, 5)) {
          let row = rows.find((r) => r.url === entry.id)!;
          assert.true(
            Math.abs(
              (entry.meta?._nearSimilarity as number) - cosine(row.embedding!),
            ) < 0.02,
            `${label(entry.id!)} carries its cosine similarity`,
          );
        }
      },
    );

    pgvectorTest(
      'a merged near sort pages over the global order',
      async function (assert) {
        let seen: string[] = [];
        for (let number of [0, 1, 2]) {
          let doc = await ctx.search([A, B], 'merged', {
            filter: everyItem,
            sort: [
              { on: itemRef, by: 'embedding', near: target },
            ] as unknown as Query['sort'],
            page: { number, size: 2 },
          });
          seen.push(...labels(doc));
        }
        assert.deepEqual(seen, [
          'a/a1',
          'b/b3',
          'b/b1',
          'a/a2',
          'b/b2',
          'a/a3',
        ]);
      },
    );
  });

  module('text relevance across realms', function (hooks) {
    // x and y hold the same words. In realm A every card holds "loop"; in
    // realm B only y does. A score weighted by how rare a word is in its
    // realm would rate y above x.
    let words: Corpus = {
      [A]: [
        { id: 'x', title: 'loop loop gear' },
        { id: 'p1', title: 'loop tide' },
        { id: 'p2', title: 'loop wind' },
        { id: 'p3', title: 'loop sand' },
        { id: 'p4', title: 'loop moss' },
      ],
      [B]: [
        { id: 'y', title: 'loop loop gear' },
        { id: 'q1', title: 'gear tide' },
        { id: 'q2', title: 'gear wind' },
        { id: 'q3', title: 'gear sand' },
        { id: 'q4', title: 'gear moss' },
      ],
    };
    let ctx = engineRealms(hooks, words);
    let query: Query = {
      filter: { on: itemRef, matches: 'loop' },
      sort: [{ by: '_matchRelevance' }] as unknown as Query['sort'],
      page: { size: 50 },
    };

    // pins current behavior; rule not yet decided. docs/search.md says text
    // relevance compares "only approximately" across realms. For a type that
    // has not opted in to word statistics the score reads only the card's own
    // text, so the same text earns the same score in both realms and the
    // merged order is exact. (A type that opts in weighs each word by how
    // rare it is in its realm; that is not reached here.)
    test('the same text earns the same text relevance in both realms, whatever else each realm holds', async function (assert) {
      let doc = await ctx.search([A, B], 'merged', query);
      let score = Object.fromEntries(
        doc.data.map((e) => [label(e.id!), e.meta?._matchRelevance as number]),
      );
      assert.strictEqual(score['a/x'], score['b/y']);
      assert.true(score['a/x'] > 0);
    });

    test('a merged text relevance sort puts the rows with more occurrences first, in either realm', async function (assert) {
      let doc = await ctx.search([A, B], 'merged', query);
      // x and y hold "loop" twice, p1..p4 once; q1..q4 do not match. Equal
      // scores come in order of url.
      assert.deepEqual(labels(doc), [
        'a/x',
        'b/y',
        'a/p1',
        'a/p2',
        'a/p3',
        'a/p4',
      ]);
    });
  });

  module('collapse across realms', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let keys: Key[] = [{ by: 'price', direction: 'asc' }];
    // One realm's collapse: of the rows sharing a group, the first by the
    // sort; a row with no group is a group of its own.
    let collapseOwn = (realm: string) => {
      let kept: (Placed & { size: number })[] = [];
      let rows = globalOrder(placed(shop, [realm]), keys);
      for (let row of rows) {
        if (row.group === undefined) {
          kept.push({ ...row, size: 1 });
        } else if (!kept.some((k) => k.group === row.group)) {
          kept.push({
            ...row,
            size: rows.filter((r) => r.group === row.group).length,
          });
        }
      }
      return kept;
    };

    // docs/search.md: "Across realms each realm collapses its own results,
    // so two realms may each return a card of the same group."
    test('each realm collapses its own rows before the merge, so a group two realms hold comes back once per realm', async function (assert) {
      let expected = globalOrder([...collapseOwn(A), ...collapseOwn(B)], keys);
      let doc = await ctx.search([A, B], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        collapse: { by: 'group', on: itemRef },
        page: { size: 50, total: 'exact' },
      });
      assert.deepEqual(labels(doc), labelsOf(expected));
      // By hand: A keeps a1 (g1), a3 (g2), a4, a5; B keeps b1 (g1), b2 (g3),
      // b3 (g2), b4. g1 and g2 each come back twice.
      assert.deepEqual(labels(doc), [
        'b/b2',
        'a/a1',
        'a/a3',
        'b/b1',
        'b/b3',
        'a/a4',
        'a/a5',
        'b/b4',
      ]);
      assert.strictEqual(
        doc.meta.page.total,
        8,
        'the total is the sum of what each realm kept',
      );
    });

    test("_collapseSize counts the group's matches in the row's own realm only", async function (assert) {
      let doc = await ctx.search([A, B], 'merged', {
        filter: everyItem,
        sort: sortBy(keys),
        collapse: { by: 'group', on: itemRef },
        page: { size: 50 },
      });
      let sizes = Object.fromEntries(
        doc.data.map((e) => [label(e.id!), e.meta?._collapseSize]),
      );
      // g1 holds a1, a2 in A and b1 in B: three matches in all, reported as
      // 2 on a1 and 1 on b1.
      assert.deepEqual(sizes, {
        'a/a1': 2,
        'a/a3': 1,
        'a/a4': 1,
        'a/a5': 1,
        'b/b1': 1,
        'b/b2': 1,
        'b/b3': 1,
        'b/b4': 1,
      });
    });
  });

  module('the list of realms', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let query: Query = {
      filter: everyItem,
      sort: sortBy([{ by: 'price', direction: 'asc' }]),
      page: { size: 50, total: 'exact' },
    };

    test('a request naming a realm twice names it once (with or without the trailing slash)', function (assert) {
      // The route reads `realms` with `parseRealmsFromPayload` and a
      // canonicalizer (the registry's spelling of each realm).
      assert.deepEqual(
        parseRealmsFromPayload(
          { realms: [A, B, A, 'http://realm-a'] },
          (realm) => realm,
        ),
        [A, B],
      );
    });

    // pins current behavior; rule not yet decided. The fan-out itself does
    // not look for a repeated realm: the route's de-duplication above is the
    // only guard, so a caller of `searchEntryRealms` that skips it gets each
    // of the realm's rows twice and a doubled total.
    test('the fan-out itself searches a realm as many times as it is given', async function (assert) {
      let doc = await ctx.search([C, C], 'merged', query);
      assert.deepEqual(labels(doc), ['c/c2', 'c/c2', 'c/c1', 'c/c1']);
      assert.strictEqual(doc.meta.page.total, 4);
    });

    test('a request with no realms is refused as missing-realms', function (assert) {
      for (let payload of [{}, { realms: [] }, { realms: ['  '] }]) {
        assert.throws(
          () => parseRealmsFromPayload(payload),
          (e: any) => e.code === 'missing-realms',
          JSON.stringify(payload),
        );
      }
    });

    // pins current behavior; rule not yet decided (the route refuses an
    // empty list before it gets here).
    test('the fan-out over no realms answers no rows and a total of 0', async function (assert) {
      let doc = await searchEntryRealms(
        [],
        federatedQuery([A], 'merged', query),
      );
      assert.deepEqual(doc.data, []);
      assert.strictEqual(doc.meta.page.total, 0);
      assert.notOk(doc.meta.incomplete);
    });

    // docs/search.md: "A realm that fails never fails the search;
    // meta.incomplete is true when any realm did not answer ok."
    test('a realm that could not be resolved is reported unavailable, the answer is marked incomplete, and the others answer', async function (assert) {
      let doc = await searchEntryRealms(
        [ctx.realm(A), undefined, ctx.realm(C)],
        federatedQuery([A, B, C], 'merged', query),
      );
      assert.deepEqual(
        labels(doc),
        labelsOf(
          globalOrder(placed(shop, [A, C]), [
            { by: 'price', direction: 'asc' },
          ]),
        ),
      );
      assert.strictEqual(doc.meta.realms?.[B].status, 'unavailable');
      assert.strictEqual(doc.meta.realms?.[A].status, 'ok');
      assert.true(doc.meta.incomplete);
    });

    // pins current behavior; rule not yet decided. docs/search.md lists no
    // limit on how many realms one search names; the limit that exists
    // (`assertRealmsBound`) is applied by clients on a card's own searches,
    // and the fan-out takes any number.
    test('the fan-out limit refuses a list longer than the limit, and the fan-out itself takes any number', async function (assert) {
      setSearchBoundsForTests({ maxRealmsPerRequest: 2 });
      try {
        assert.throws(
          () => assertRealmsBound([A, B, C]),
          (e: any) => e.status === 400 && /3 realms/.test(e.message),
        );
        assertRealmsBound([A, B]);
        let doc = await ctx.search([A, B, C], 'merged', query);
        assert.strictEqual(doc.data.length, 11);
      } finally {
        resetSearchBoundsForTests();
      }
    });
  });

  module('a realm that fails or runs out of time', function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let keys: Key[] = [{ by: 'price', direction: 'asc' }];
    let query: Query = {
      filter: everyItem,
      sort: sortBy(keys),
      facets: [{ by: 'brand' }],
      page: { size: 50, total: 'exact' },
    };
    // The failure is injected where the fan-out meets a realm: the realm
    // runs its real search, then fails before answering.
    let failingAfterSearch = (url: string): RealmStandIn => ({
      url,
      searchEntries: async (q) => {
        await ctx.realm(url).searchEntries(q);
        throw new Error('connection reset');
      },
    });

    test('a realm failing mid-search leaves the other realms rows in order, and the answer says it is incomplete', async function (assert) {
      let doc = await searchEntryRealms(
        [ctx.realm(A), failingAfterSearch(B), ctx.realm(C)],
        federatedQuery([A, B, C], 'merged', query),
      );
      assert.deepEqual(
        labels(doc),
        labelsOf(globalOrder(placed(shop, [A, C]), keys)),
      );
      assert.true(doc.meta.incomplete);
      assert.strictEqual(doc.meta.realms?.[B].status, 'unavailable');
      assert.strictEqual(doc.meta.realms?.[A].status, 'ok');
      assert.strictEqual(doc.meta.realms?.[C].status, 'ok');
    });

    // pins current behavior; rule not yet decided. The total and the facets
    // count only the realms that answered (A holds 5 rows, C 2); nothing
    // marks them as short except `meta.incomplete`.
    test('with a realm missing, the total and the facet counts cover only the realms that answered', async function (assert) {
      let doc = await searchEntryRealms(
        [ctx.realm(A), failingAfterSearch(B), ctx.realm(C)],
        federatedQuery([A, B, C], 'merged', query),
      );
      assert.strictEqual(doc.meta.page.total, 7);
      assert.notOk(hasWarning(doc.meta, 'total-estimated'));
      assert.deepEqual(doc.meta.facets?.brand, [
        { value: 'acme', count: 4 },
        { value: 'bolt', count: 2 },
        { value: 'dash', count: 1 },
      ]);
    });

    test('a realm that has not answered by its deadline is reported as timeout while the others answer', async function (assert) {
      let stopped = false;
      let hanging = {
        url: B,
        searchEntries: (
          _q: SearchEntryQuery,
          opts?: { signal?: AbortSignal },
        ) =>
          new Promise<never>(() => {
            opts?.signal?.addEventListener('abort', () => (stopped = true));
          }),
      };
      let doc = await searchEntryRealms(
        [ctx.realm(A), hanging, ctx.realm(C)],
        federatedQuery([A, B, C], 'byRealm', query),
        { realmDeadline: Date.now() + 1500 },
      );
      assert.strictEqual(doc.meta.realms?.[B].status, 'timeout');
      assert.true(doc.meta.incomplete);
      assert.true(stopped, "the slow realm's search was told to stop");
      assert.deepEqual(labels(doc), [
        ...labelsOf(globalOrder(placed(shop, [A]), keys)),
        ...labelsOf(globalOrder(placed(shop, [C]), keys)),
      ]);
    });
  });

  module("one realm, federated, is that realm's own search", function (hooks) {
    let ctx = engineRealms(hooks, shop);
    let keys: Key[] = [
      { by: 'price', direction: 'desc' },
      { by: 'stock', direction: 'asc' },
    ];
    let query = (number: number): Query => ({
      filter: { on: itemRef, not: { eq: { brand: 'dash' } } },
      sort: sortBy(keys),
      facets: [{ by: 'brand' }],
      page: { number, size: 2, total: 'exact' },
    });

    for (let results of ['merged', 'byRealm'] as const) {
      test(`${results}: rows, order, total, hasMore and facets equal the realm's own, page by page`, async function (assert) {
        let whole = labelsOf(globalOrder(placed(shop, [A]), keys));
        for (let number of [0, 1, 2, 3]) {
          let own = await ctx.own(A, query(number));
          let doc = await ctx.search([A], results, query(number));
          assert.deepEqual(
            labels(own),
            whole.slice(number * 2, number * 2 + 2),
            `page ${number}: the realm's own page is the oracle's`,
          );
          assert.deepEqual(labels(doc), labels(own), `page ${number}: rows`);
          assert.strictEqual(
            doc.meta.page.total,
            own.meta.page.total,
            `page ${number}: total`,
          );
          assert.strictEqual(doc.meta.page.total, 5);
          assert.strictEqual(
            Boolean(doc.meta.page.hasMore),
            Boolean(own.meta.page.hasMore),
            `page ${number}: hasMore`,
          );
          assert.deepEqual(
            doc.meta.facets,
            own.meta.facets,
            `page ${number}: facets`,
          );
          assert.deepEqual(doc.meta.facets?.brand, [
            { value: 'acme', count: 3 },
            { value: 'bolt', count: 2 },
          ]);
        }
      });
    }
  });
});
