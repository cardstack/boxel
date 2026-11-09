import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  parseSearchEntryQueryFromPayload,
  searchEntryRealms,
  type SearchEntryQuery,
} from '@cardstack/runtime-common/search-entry';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type EntryResource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  SearchBoundError,
  realmDeadlineWithin,
  runWithSearchTimeBudget,
} from '@cardstack/runtime-common/search-bounds';
import type { PgAdapter } from '@cardstack/postgres';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
} from './helpers/index.ts';

// The federated merge across realms on one server, before the one-query
// path: how a search over several realms answers, per realm or merged.
//
// Each stand-in realm holds rows with a price and a score and answers a
// search the way a realm's engine does: sorted, paged, and, when the
// coordinator asks, with each row's sort values so a merge can order rows
// from different realms by the query's own sort.

type Row = { id: string; price: number; score: number };

function realm(url: string, rows: Row[], calls: SearchEntryQuery[] = []) {
  return {
    url,
    calls,
    searchEntries: async (q: SearchEntryQuery) => {
      calls.push(q);
      let sort = q.itemQuery.sort?.[0] as any;
      let byPrice = sort?.by === 'price';
      let dir = sort?.direction === 'desc' ? -1 : 1;
      let ordered = [...rows].sort((a, b) =>
        byPrice ? (a.price - b.price) * dir : b.score - a.score,
      );
      let page = q.itemQuery.page ?? { number: 0, size: 50 };
      let start = (page.number ?? 0) * page.size;
      let slice = ordered.slice(start, start + page.size);
      return {
        data: slice.map((r) => ({
          type: 'entry' as const,
          id: `${url}${r.id}`,
          relationships: {},
          meta: {
            ...(byPrice ? {} : { _blendScore: r.score }),
            ...(q.exposeSortValues
              ? { _sortValues: byPrice ? [r.price] : [r.score] }
              : {}),
          },
        })),
        meta: { page: { total: rows.length } },
      };
    },
  };
}

function failing(url: string, error: Error) {
  return {
    url,
    searchEntries: async () => {
      throw error;
    },
  };
}

const A = 'http://a/';
const B = 'http://b/';
const C = 'http://c/';
const ids = (doc: { data: { id: string }[] }) =>
  doc.data.map((e) => e.id.replace('http://', '').replace('/', ':'));

function query(payload: Record<string, unknown>) {
  return parseSearchEntryQueryFromPayload({ realms: [A, B], ...payload });
}

const blend = [
  {
    blend: [{ by: 'item.price', 'item.on': { module: 'm', name: 'P' } }],
    k: 60,
  },
];

// Realms on the real engine: each realm's rows are indexed in Postgres under
// its own realm URL, and a realm answers a federated search the way a realm's
// engine does, carrying the scores and sort values the engine puts on each row.
const noteRef: ResolvedCodeRef = {
  module: 'http://a/note' as ResolvedCodeRef['module'],
  name: 'Note',
};
const noteDef = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { title: 'f0', score: 'f1' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: '@cardstack/base/string', name: 'default' },
      search: { role: 'title' },
    },
    f1: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: { module: '@cardstack/base/number', name: 'default' },
      serializerName: 'number',
    },
  },
} as unknown as Definition;

function noteLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === noteRef.module && codeRef.name === noteRef.name) {
        return noteDef;
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

type Note = { id: string; text: string; score: number };

function engineRealms(hooks: NestedHooks, corpus: Record<string, Note[]>) {
  let ctx = {} as {
    adapter: PgAdapter;
    engine: IndexQueryEngine;
    realm: (url: string) => {
      url: string;
      searchEntries: (q: SearchEntryQuery) => Promise<any>;
    };
  };
  hooks.beforeEach(async function () {
    prepareTestDB();
    ctx.adapter = await createTestPgAdapter();
    let network = new VirtualNetwork();
    ctx.engine = new IndexQueryEngine(ctx.adapter, noteLookup(), network);
    let noteKey = internalKeyFor(noteRef, undefined, network);
    for (let [realmURL, notes] of Object.entries(corpus)) {
      let batch = await new IndexWriter(ctx.adapter).createBatch(
        new URL(realmURL),
        network,
        undefined,
        { splitPrerenderHtml: false },
      );
      for (let note of notes) {
        let cardURL = new URL(`${realmURL}${note.id}.json`);
        await batch.updateEntry(cardURL, {
          type: 'instance',
          resource: {
            id: rri(cardURL.href),
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: rri(noteRef.module), name: 'Note' } },
          },
          lastModified: Date.now(),
          resourceCreatedAt: Date.now(),
          searchData: {
            title: note.text,
            score: note.score,
            _searchText: { A: note.text },
          },
          markdown: note.text,
          deps: new Set(),
          displayNames: ['Note'],
          types: [noteKey],
          isolatedHtml: `<div>${note.id}</div>`,
        });
      }
      await batch.done();
    }
    ctx.realm = (url: string) => ({
      url,
      searchEntries: async (q: SearchEntryQuery) => {
        let { results, meta } = await ctx.engine.search(
          new URL(url),
          q.itemQuery,
          q.exposeSortValues ? { exposeSortValues: true } : {},
          { kind: 'dataOnly' },
        );
        let scores = [
          '_matchRelevance',
          '_nearSimilarity',
          '_blendScore',
          '_collapseSize',
          '_explain',
          '_rerank',
          '_expression',
          '_sortValues',
        ];
        return {
          data: results.map((row: any) => ({
            type: 'entry' as const,
            id: row.url,
            relationships: {},
            meta: Object.fromEntries(
              scores
                .filter((k) => row[k] !== undefined)
                .map((k) => [
                  k,
                  k === '_sortValues' || k === '_explain' || row[k] == null
                    ? row[k]
                    : Number(row[k]),
                ]),
            ) as EntryResource['meta'],
          })),
          meta,
        };
      },
    });
  });
  hooks.afterEach(async function () {
    await closeTestPgAdapter(ctx.adapter);
  });
  return ctx;
}

module(basename(import.meta.filename), function () {
  module('per realm, the default', function () {
    test('sections come in order of their best card, and a realm matching nothing comes last', async function (assert) {
      let doc = await searchEntryRealms(
        [
          realm(A, [{ id: 'a1', price: 5, score: 0.2 }]),
          realm(B, [
            { id: 'b1', price: 9, score: 0.9 },
            { id: 'b2', price: 3, score: 0.5 },
          ]),
          realm(C, []),
        ],
        query({ realms: [A, B, C], sort: blend }),
      );
      assert.deepEqual(doc.meta.federation, { results: 'byRealm' });
      assert.deepEqual(
        ids(doc),
        ['b:b1', 'b:b2', 'a:a1'],
        "B's best card outranks A's, so B's section comes first",
      );
      assert.deepEqual(
        doc.meta.sections?.map((s) => [s.realm, s.count]),
        [
          [B, 2],
          [A, 1],
          [C, 0],
        ],
        'one section per realm, the empty one last',
      );
      assert.deepEqual(doc.meta.page.total, 3);
    });

    test('each realm pages on its own, as the search sheet expects', async function (assert) {
      let a = [] as SearchEntryQuery[];
      await searchEntryRealms(
        [
          realm(A, [{ id: 'a1', price: 5, score: 0.2 }], a),
          realm(B, [{ id: 'b1', price: 9, score: 0.9 }]),
        ],
        query({ page: { number: 1, size: 10 } }),
      );
      assert.deepEqual(a[0].itemQuery.page, { number: 1, size: 10 });
    });
  });

  module('merged', function () {
    let rowsA: Row[] = [
      { id: 'a1', price: 1, score: 0 },
      { id: 'a2', price: 4, score: 0 },
      { id: 'a3', price: 7, score: 0 },
      { id: 'a4', price: 9, score: 0 },
    ];
    let rowsB: Row[] = [
      { id: 'b1', price: 2, score: 0 },
      { id: 'b2', price: 3, score: 0 },
      { id: 'b3', price: 8, score: 0 },
    ];
    let byPrice = (direction: 'asc' | 'desc', page: object) =>
      query({
        federation: { results: 'merged' },
        sort: [
          {
            by: 'item.price',
            'item.on': { module: 'm', name: 'P' },
            direction,
          },
        ],
        page,
      });

    test('a field sort orders the merged page across realms', async function (assert) {
      let doc = await searchEntryRealms(
        [realm(A, rowsA), realm(B, rowsB)],
        byPrice('asc', { number: 0, size: 4 }),
      );
      assert.deepEqual(ids(doc), ['a:a1', 'b:b1', 'b:b2', 'a:a2']);
      assert.deepEqual(doc.meta.federation, { results: 'merged' });
      assert.strictEqual(doc.meta.page.total, 7);
      let desc = await searchEntryRealms(
        [realm(A, rowsA), realm(B, rowsB)],
        byPrice('desc', { number: 0, size: 3 }),
      );
      assert.deepEqual(ids(desc), ['a:a4', 'b:b3', 'a:a3']);
    });

    test('pages are one global sequence: no repeats, no gaps', async function (assert) {
      let seen: string[] = [];
      for (let number of [0, 1, 2]) {
        let calls: SearchEntryQuery[] = [];
        let doc = await searchEntryRealms(
          [realm(A, rowsA, calls), realm(B, rowsB)],
          byPrice('asc', { number, size: 3 }),
        );
        seen.push(...ids(doc));
        assert.deepEqual(
          calls[0].itemQuery.page,
          { number: 0, size: (number + 1) * 3 },
          `page ${number} asks each realm for its top ${(number + 1) * 3}`,
        );
      }
      assert.deepEqual(seen, [
        'a:a1',
        'b:b1',
        'b:b2',
        'a:a2',
        'a:a3',
        'b:b3',
        'a:a4',
      ]);
    });
  });

  module('merged, on the real engine', function (hooks) {
    // How often "loop" appears sets each note's text relevance.
    let ctx = engineRealms(hooks, {
      [A]: [
        { id: 'a1', text: 'loop loop loop loop loop', score: 1 },
        { id: 'a2', text: 'loop', score: 4 },
      ],
      [B]: [
        { id: 'b1', text: 'loop loop loop loop', score: 2 },
        { id: 'b2', text: 'loop loop', score: 3 },
      ],
    });
    let short = (doc: { data: { id: string }[] }) =>
      doc.data.map((e) => e.id.replace(/^http:\/\/(\w)\/(\w+)\.json$/, '$2'));

    test('a merged textRelevance sort puts the best match first, as each realm does', async function (assert) {
      let doc = await searchEntryRealms(
        [ctx.realm(A), ctx.realm(B)],
        query({
          federation: { results: 'merged' },
          filter: { matches: 'loop' },
          sort: [{ by: 'item.textRelevance' }],
          page: { number: 0, size: 4 },
        }),
      );
      assert.deepEqual(short(doc), ['a1', 'b1', 'b2', 'a2']);
      let scores = doc.data.map((e) => e.meta?._matchRelevance as number);
      assert.deepEqual(
        [...scores].sort((x, y) => y - x),
        scores,
        'highest relevance first, with no direction given',
      );
    });
  });

  module('merged reranks, on the real engine', function (hooks) {
    let ctx = engineRealms(hooks, {
      [A]: [
        { id: 'a1', text: 'loop loop loop loop loop', score: 1 },
        { id: 'a2', text: 'loop', score: 4 },
      ],
      [B]: [
        { id: 'b1', text: 'loop loop loop loop', score: 2 },
        { id: 'b2', text: 'loop loop', score: 3 },
      ],
    });
    let short = (doc: { data: { id: string }[] }) =>
      doc.data.map((e) => e.id.replace(/^http:\/\/(\w)\/(\w+)\.json$/, '$2'));

    test('a merged rerank orders the realms together by its value', async function (assert) {
      let doc = await searchEntryRealms(
        [ctx.realm(A), ctx.realm(B)],
        query({
          federation: { results: 'merged' },
          filter: { matches: 'loop' },
          sort: [{ by: 'item.textRelevance' }],
          rerank: { expression: 'score' },
          page: { number: 0, size: 4 },
        }),
      );
      assert.deepEqual(short(doc), ['a2', 'b2', 'b1', 'a1']);
      assert.deepEqual(
        doc.data.map((e) => (e.meta as Record<string, unknown>)?._rerank),
        [4, 3, 2, 1],
      );
      assert.true(
        doc.data.every((e) => typeof e.meta?._matchRelevance === 'number'),
        'each row keeps its text relevance',
      );
    });
  });

  module('each realm reports how it answered', function () {
    test('a refusal with a code, an outage and a timeout read differently', async function (assert) {
      let doc = await searchEntryRealms(
        [
          realm(A, [{ id: 'a1', price: 1, score: 1 }]),
          failing(
            B,
            new InvalidQueryError('no Postgres here', 'needs-postgres'),
          ),
          failing(C, new Error('connection reset')),
          failing('http://d/', new SearchBoundError(408, 'over budget')),
        ],
        query({ realms: [A, B, C, 'http://d/'] }),
      );
      let realms = doc.meta.realms!;
      assert.strictEqual(realms[A].status, 'ok');
      assert.strictEqual(realms[A].total, 1);
      assert.strictEqual(typeof realms[A].ms, 'number');
      assert.deepEqual(
        [realms[B].status, realms[B].code],
        ['refused', 'needs-postgres'],
      );
      assert.strictEqual(realms[C].status, 'unavailable');
      assert.strictEqual(realms['http://d/'].status, 'timeout');
      assert.true(doc.meta.incomplete, 'kept for the clients that read it');
    });

    test('a slow realm times out on its own, and the others still answer', async function (assert) {
      let aborted = false;
      let slow = {
        url: B,
        searchEntries: (
          _q: SearchEntryQuery,
          opts?: { signal?: AbortSignal },
        ) =>
          new Promise<never>(() => {
            opts?.signal?.addEventListener('abort', () => (aborted = true));
          }),
      };
      // The request's budget, as the search handler runs it: each realm's
      // deadline falls inside it, so the search answers rather than a 408.
      let budget = 1_000;
      let started = Date.now();
      let doc = await runWithSearchTimeBudget(
        (signal) =>
          searchEntryRealms(
            [realm(A, [{ id: 'a1', price: 1, score: 1 }]), slow],
            query({ federation: { results: 'merged' } }),
            { signal, realmDeadline: realmDeadlineWithin(budget) },
          ),
        budget,
      );
      assert.ok(Date.now() - started < budget, 'answered inside the budget');
      assert.deepEqual(ids(doc), ['a:a1'], "the fast realm's rows");
      assert.strictEqual(doc.meta.realms![A].status, 'ok');
      assert.strictEqual(doc.meta.realms![B].status, 'timeout');
      assert.true(doc.meta.incomplete);
      assert.true(aborted, "the slow realm's search is told to stop");
    });

    test('a realm that never resolved is unavailable', async function (assert) {
      let doc = await searchEntryRealms(
        [realm(A, [{ id: 'a1', price: 1, score: 1 }]), null],
        query({}),
      );
      assert.strictEqual(doc.meta.realms![B].status, 'unavailable');
    });
  });

  module('facets across realms', function () {
    // A realm whose facet answers its top `size` colours by count.
    function colours(
      url: string,
      counts: Record<string, number>,
      calls: SearchEntryQuery[] = [],
    ) {
      return {
        url,
        searchEntries: async (q: SearchEntryQuery) => {
          calls.push(q);
          let size = (q.itemQuery.facets?.[0] as any)?.size ?? 50;
          let top = Object.entries(counts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, size)
            .map(([value, count]) => ({ value, count }));
          return {
            data: [],
            meta: {
              page: { total: Object.values(counts).reduce((a, b) => a + b, 0) },
              facets: { color: top },
            },
          };
        },
      };
    }
    let facetQuery = (size: number) =>
      query({ facets: [{ by: 'item.color', size }] });

    test('a value second in every realm but first overall comes first', async function (assert) {
      let calls: SearchEntryQuery[] = [];
      let doc = await searchEntryRealms(
        [
          colours(A, { red: 10, blue: 9, green: 1 }, calls),
          colours(B, { green: 10, blue: 9, red: 1 }),
        ],
        facetQuery(1),
      );
      assert.strictEqual(
        (calls[0].itemQuery.facets?.[0] as any).size,
        12,
        'each realm is asked for 1.5 × 1 + 10 values',
      );
      assert.deepEqual(doc.meta.facets?.color, [{ value: 'blue', count: 18 }]);
      assert.strictEqual(
        doc.meta.facetErrors?.color,
        0,
        'every realm answered all its values, so the counts are exact',
      );
    });

    test('a realm that may have cut values off bounds the error', async function (assert) {
      let many = Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [
          `c${String(i).padStart(2, '0')}`,
          30 - i,
        ]),
      );
      let doc = await searchEntryRealms(
        [colours(A, many), colours(B, { c00: 1 })],
        facetQuery(2),
      );
      assert.deepEqual(
        doc.meta.facets?.color?.map((c) => c.value),
        ['c00', 'c01'],
      );
      // A returned 13 of its 20 values, the smallest with 18: a value
      // missing from its answer has at most 18 there.
      assert.strictEqual(doc.meta.facetErrors?.color, 18);
    });

    test('per realm, the default, keeps the asked size too', async function (assert) {
      let doc = await searchEntryRealms(
        [colours(A, { red: 3, blue: 2 }), colours(B, { blue: 4 })],
        facetQuery(1),
      );
      assert.deepEqual(doc.meta.facets?.color, [{ value: 'blue', count: 6 }]);
    });
  });

  test('federation.results takes byRealm or merged', function (assert) {
    assert.throws(
      () => query({ federation: { results: 'interleaved' } }),
      /federation\.results/,
    );
  });
});
