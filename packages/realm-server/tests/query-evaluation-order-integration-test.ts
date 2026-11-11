import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  hasWarning,
  IndexQueryEngine,
  IndexWriter,
  backfillFacetValues,
  facetFieldSpecsOf,
  VectorSerializer,
  VirtualNetwork,
  hasVectorIndex,
  internalKeyFor,
  rri,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import {
  parseSearchEntryQueryFromPayload,
  searchEntryWireQueryFromQuery,
} from '@cardstack/runtime-common/search-entry';

import { setupDB, testRealm } from './helpers/index.ts';

// A query is declarative: where a member is WRITTEN never matters. The engine
// still APPLIES the members in a fixed order, and every saved query that uses
// two of them depends on it:
//
//   1. `let` bindings, each from its own query (its filter, sort, then page)
//   2. the filter (a `near` threshold is part of it)
//   3. ranking values, each over every row the filter admits (a blend's
//      per-signal ranks, a near similarity, an expression)
//   4. facets and their statistics, over every row the filter admits
//   5. `collapse`: each group's best `keep` rows by the query's sort
//   6. the total: what is left after the collapse
//   7. the sort of what is left, ties by URL
//   8. a leading expression sort entry with `top` (the window): the first
//      `top` rows of the order the rest of the sort gives, re-ordered
//   9. the page
//  10. `select` and `explain`, which only read the rows the page holds
//
// Each test below takes two of those steps over a fixture built so that
// applying them the other way round gives a different answer. The expected
// answer is computed here in plain JavaScript by applying the steps in the
// engine's order; the answer the other order would give is computed beside it
// and the test first checks that the two differ. A change to the order
// therefore fails here, by name.

type Q = Record<string, any>;

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const dateRef = ref('@cardstack/base/date', 'default');
const T = ref(`${testRealm}order-item`, 'Item');

// The 1,005 rows that tell a capped total from an exact one live in a realm
// of their own, so no other test counts them.
const bulkRealm = 'http://evaluation-order-bulk/';
const R = ref(`${bulkRealm}order-row`, 'Row');
const BULK_ROWS = 1005;
const BULK_BUCKETS = 1002;
// SEARCH_TOTAL_CAP in docs/search.md ("counts up to 1,000").
const TOTAL_CAP = 1000;

// Every text, number and date field here is a facet: these cases test the
// order facets are counted in, not which fields declare one.
const text = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
  search: { facet: true },
};
const number = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: numberRef,
  serializerName: 'number',
  search: { facet: true },
};

const itemDef = {
  type: 'card-def',
  codeRef: T,
  displayName: 'Item',
  fields: {
    name: 'name',
    group: 'group',
    color: 'color',
    price: 'price',
    score: 'score',
    stock: 'stock',
    day: 'day',
    embedding: 'embedding',
  },
  fieldDefs: {
    name: text,
    group: text,
    color: text,
    price: number,
    score: number,
    stock: number,
    day: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: dateRef,
      serializerName: 'date',
      search: { facet: true },
    },
    embedding: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: vectorRef,
      serializerName: 'vector',
    },
  },
} as unknown as Definition;

const rowDef = {
  type: 'card-def',
  codeRef: R,
  displayName: 'Row',
  fields: { n: 'n', bucket: 'bucket' },
  fieldDefs: { n: number, bucket: text },
} as unknown as Definition;

const baseDef = {
  type: 'card-def',
  codeRef: ref('@cardstack/base/card-api', 'CardDef'),
  displayName: 'Card',
  fields: {},
  fieldDefs: {},
} as unknown as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  let definitions = [itemDef, rowDef, baseDef];
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      let found = definitions.find((d) => {
        let r = d.codeRef as ResolvedCodeRef;
        return r.module === codeRef.module && r.name === codeRef.name;
      });
      if (!found) {
        throw new Error(
          `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
        );
      }
      return found;
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// --- the fixture -------------------------------------------------------------

interface Item {
  name: string;
  // The collapse key. Two rows have none: each is a group of its own.
  group: string | null;
  color: string;
  price: number;
  score: number;
  stock: number;
  // How many whole days before the run its `day` is.
  daysAgo: number;
  // One row has no vector.
  vec: number[] | null;
}

// Every number column holds ten distinct values, so no sort ties. The best
// row of a group differs by sort key, and the two best scores overall (a, j)
// are in different groups while the third (b) shares a's.
// prettier-ignore
const ITEMS: Item[] = [
  { name: 'a', group: 'g1', color: 'red',   price: 10, score: 90, stock: 5, daysAgo: 3,   vec: [1, 0, 0] },
  { name: 'b', group: 'g1', color: 'blue',  price: 20, score: 80, stock: 0, daysAgo: 12,  vec: [0.9, 0.1, 0] },
  { name: 'c', group: 'g1', color: 'red',   price: 30, score: 40, stock: 3, daysAgo: 45,  vec: [0, 1, 0] },
  { name: 'd', group: 'g2', color: 'blue',  price: 40, score: 70, stock: 8, daysAgo: 400, vec: [0.8, 0.6, 0] },
  { name: 'e', group: 'g2', color: 'red',   price: 50, score: 60, stock: 1, daysAgo: 20,  vec: [0.6, 0.8, 0] },
  { name: 'f', group: 'g3', color: 'green', price: 60, score: 50, stock: 2, daysAgo: 100, vec: [0, 0, 1] },
  { name: 'g', group: null, color: 'red',   price: 70, score: 30, stock: 9, daysAgo: 5,   vec: [0.7, 0.7, 0] },
  { name: 'h', group: null, color: 'blue',  price: 80, score: 20, stock: 7, daysAgo: 60,  vec: [-1, 0, 0] },
  { name: 'i', group: 'g3', color: 'red',   price: 15, score: 10, stock: 4, daysAgo: 8,   vec: null },
  { name: 'j', group: 'g2', color: 'green', price: 25, score: 85, stock: 6, daysAgo: 200, vec: [1, 0.2, 0] },
];

const itemUrl = (name: string) => `${testRealm}Item/${name}.json`;
const nameOf = (url: unknown) =>
  String(url)
    .split('/')
    .pop()!
    .replace(/\.json$/, '');

// --- the steps, in plain JavaScript -----------------------------------------

type Cmp = (a: Item, b: Item) => number;
const names = (rows: Item[]) => rows.map((r) => r.name);
// The engine's last sort key is the URL, which here orders as the name does.
const byName: Cmp = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const sorted = (rows: Item[], cmp?: Cmp) =>
  [...rows].sort((a, b) => cmp?.(a, b) || byName(a, b));
const desc =
  (value: (r: Item) => number): Cmp =>
  (a, b) =>
    value(b) - value(a);
const asc =
  (value: (r: Item) => number): Cmp =>
  (a, b) =>
    value(a) - value(b);
const pageOf = <X>(rows: X[], size: number, number = 0) =>
  rows.slice(number * size, number * size + size);

// Of rows already in order, each group's first `keep`, in that order, each
// with the size of its whole group. A row with no group stands alone.
function collapse(rows: Item[], keep = 1): { row: Item; size: number }[] {
  let key = (r: Item) => r.group ?? `alone ${r.name}`;
  let seen = new Map<string, number>();
  let size = new Map<string, number>();
  for (let r of rows) {
    size.set(key(r), (size.get(key(r)) ?? 0) + 1);
  }
  let kept: { row: Item; size: number }[] = [];
  for (let r of rows) {
    let n = seen.get(key(r)) ?? 0;
    seen.set(key(r), n + 1);
    if (n < keep) {
      kept.push({ row: r, size: size.get(key(r))! });
    }
  }
  return kept;
}

// The first `top` rows re-ordered by `value`, highest first, then the rest
// as they were.
function rerank(rows: Item[], top: number, value: (r: Item) => number) {
  return [...sorted(rows.slice(0, top), desc(value)), ...rows.slice(top)];
}

function cosine(a: number[], b: number[]) {
  let dot = a.reduce((t, x, i) => t + x * b[i], 0);
  let norm = (v: number[]) => Math.sqrt(v.reduce((t, x) => t + x * x, 0));
  return dot / (norm(a) * norm(b));
}
const similarity =
  (to: number[]) =>
  (r: Item): number | null =>
    r.vec ? cosine(r.vec, to) : null;
// Most similar first, rows with no vector last.
const nearest = (to: number[]): Cmp =>
  desc((r) => similarity(to)(r) ?? -Infinity);

function countBy(rows: Item[], value: (r: Item) => string | null) {
  let counts: Record<string, number> = {};
  for (let r of rows) {
    let v = value(r);
    if (v != null) {
      counts[v] = (counts[v] ?? 0) + 1;
    }
  }
  return counts;
}

// Reciprocal rank fusion as docs/search.md gives it: each row scores
// sum(|weight| / (k + rank)) over the signals it has a value for, each signal
// ranked over `rows` (ties share a rank). A negative weight ranks the signal
// the other way round; a boost is a signal every matching row ties first in.
type Signal =
  | {
      value: (r: Item) => number | null;
      weight?: number;
      direction?: 'asc' | 'desc';
    }
  | { boost: (r: Item) => boolean; weight?: number };

function ranksOf(rows: Item[], signal: Signal): Map<string, number> {
  let weight = signal.weight ?? 1;
  let value: (r: Item) => number | null;
  let highestFirst = true;
  if ('boost' in signal) {
    let boost = signal.boost;
    value = (r) => (boost(r) === weight > 0 ? 1 : null);
  } else {
    value = signal.value;
    highestFirst = ((signal.direction ?? 'desc') === 'desc') === weight > 0;
  }
  let valued = rows
    .map((r) => ({ r, v: value(r) }))
    .filter((x): x is { r: Item; v: number } => x.v != null);
  return new Map(
    valued.map((x) => [
      x.r.name,
      1 + valued.filter((y) => (highestFirst ? y.v > x.v : y.v < x.v)).length,
    ]),
  );
}

function fuse(rows: Item[], signals: Signal[], k = 60): Map<string, number> {
  let scores = new Map(rows.map((r) => [r.name, 0]));
  for (let signal of signals) {
    for (let [name, rank] of ranksOf(rows, signal)) {
      scores.set(
        name,
        scores.get(name)! + Math.abs(signal.weight ?? 1) / (k + rank),
      );
    }
  }
  return scores;
}
const byFused = (scores: Map<string, number>): Cmp =>
  desc((r) => scores.get(r.name)!);

// The ranking most tests fuse: the score, and three times over the stock.
// The best of a group by this is not its best by score alone.
const SCORE_AND_STOCK: Signal[] = [
  { value: (r) => r.score },
  { value: (r) => r.stock, weight: 3 },
];
const scoreAndStock = {
  blend: [{ by: 'score' }, { by: 'stock', weight: 3 }],
};

const TOWARD_X = [1, 0, 0];
const TOWARD_Y = [0, 1, 0];
// Far from every row's similarity to TOWARD_X (the nearest are 0.71 and 0.8),
// so an int8-encoded vector cannot land on the other side.
const THRESHOLD = 0.75;

const scoreDesc = [{ by: 'score', direction: 'desc' }];
const scoreDescSaved = [{ on: T, by: 'score', direction: 'desc' }];
const totalModes = [undefined, 'capped', 'exact', 'none'] as const;
const paged = (size: number, mode: (typeof totalModes)[number], number = 0) =>
  ({ number, size, ...(mode ? { total: mode } : {}) }) as Q;

module(basename(import.meta.filename), function () {
  module('the order a query is evaluated in (Postgres)', function (hooks) {
    let engine: IndexQueryEngine;
    let vectors = false;

    setupDB(hooks, {
      before: async (dbAdapter) => {
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        vectors = await hasVectorIndex(dbAdapter);

        // The items go through the real index writer, which is what stores
        // their vectors where a `near` reads them.
        let itemKey = internalKeyFor(T, undefined, vn);
        let batch = await new IndexWriter(dbAdapter).createBatch(
          new URL(testRealm),
          vn,
          undefined,
          { splitPrerenderHtml: false },
        );
        let now = Date.now();
        for (let item of ITEMS) {
          let cardURL = new URL(itemUrl(item.name));
          let { vec, daysAgo, group, ...plain } = item;
          await batch.updateEntry(cardURL, {
            type: 'instance',
            resource: {
              id: rri(cardURL.href),
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: { module: rri(T.module), name: T.name } },
            },
            lastModified: now,
            resourceCreatedAt: now,
            searchData: {
              ...plain,
              ...(group ? { group } : {}),
              day: new Date(now - daysAgo * 86_400_000)
                .toISOString()
                .slice(0, 10),
              ...(vec
                ? {
                    embedding: VectorSerializer.queryableValue(
                      VectorSerializer.encodeVector(vec),
                    ),
                  }
                : {}),
            },
            deps: new Set(),
            displayNames: ['Item'],
            types: [itemKey],
            isolatedHtml: `<div>${item.name}</div>`,
          });
        }
        await batch.done();

        // Row n of 1,005: its number, and a bucket shared with at most one
        // other row (1,002 buckets).
        await dbAdapter.execute(
          `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified)
           SELECT u.url, u.url, $1, 1, 'instance',
             jsonb_build_object('id', u.url, 'type', 'card'),
             jsonb_build_object('n', n, 'bucket', 'bucket-' || (n % ${BULK_BUCKETS})::text),
             '[]'::jsonb, $2::jsonb, FALSE, FALSE, $3, 1000
           FROM generate_series(1, ${BULK_ROWS}) AS n,
             LATERAL (SELECT $1 || 'Row/' || lpad(n::text, 5, '0') AS url) AS u`,
          {
            bind: [
              bulkRealm,
              JSON.stringify([internalKeyFor(R, undefined, vn)]),
              now,
            ],
          },
        );
        // The bulk rows went straight into boxel_index: their facet rows are
        // written from their search docs, as a declaration change does.
        let noLookup = async () => undefined;
        await backfillFacetValues(
          dbAdapter,
          bulkRealm,
          internalKeyFor(R, undefined, vn),
          await facetFieldSpecsOf(rowDef, noLookup),
        );
        await backfillFacetValues(
          dbAdapter,
          testRealm,
          itemKey,
          await facetFieldSpecsOf(itemDef, noLookup),
        );
      },
    });

    interface Got {
      names: string[];
      rows: Record<string, any>[];
      meta: Record<string, any>;
    }

    async function run(query: Q, realm = testRealm): Promise<Got> {
      let { results, meta } = await engine.search(
        new URL(realm),
        query as Query,
        {},
        { kind: 'dataOnly' },
      );
      let rows = results as Record<string, any>[];
      return { names: rows.map((r) => nameOf(r.url)), rows, meta: meta as Q };
    }

    // Every form a query has, as the query the engine is handed: the newer
    // spelling lowered, the newer spelling read off the search wire, and,
    // where the members exist in the spelling a realm saved before it (an
    // `on` anchor on every clause), that spelling and its wire form.
    function forms(typed: Q, saved?: Q): [string, Q][] {
      let wire = (q: Q) =>
        parseSearchEntryQueryFromPayload(JSON.parse(JSON.stringify(q)))
          .itemQuery as Q;
      let out: [string, Q][] = [
        ['newer spelling', lowerQuery(typed).query as Q],
        ['newer spelling over the wire', wire(typed)],
      ];
      if (saved) {
        out.push(['as saved', saved]);
        out.push([
          'as saved, over the wire',
          wire(searchEntryWireQueryFromQuery(saved as Query) as Q),
        ]);
      }
      return out;
    }

    async function inEveryForm(
      typed: Q,
      saved: Q | undefined,
      verify: (got: Got, form: string) => void,
    ) {
      for (let [form, query] of forms(typed, saved)) {
        verify(await run(query), form);
      }
    }

    // A `select` exists only on the wire: the table it answers.
    async function table(payload: Q) {
      let parsed = parseSearchEntryQueryFromPayload(
        JSON.parse(JSON.stringify(payload)),
      );
      let plans = await engine.planColumns(
        parsed.typeAnchors![0],
        parsed.columns!,
      );
      let { rows, meta } = await engine.searchColumns(
        new URL(testRealm),
        parsed.itemQuery,
        {},
        plans,
      );
      return {
        columns: ['id', ...parsed.columns!.map((c) => c.name)],
        rows: rows.map(([id, ...rest]) => [nameOf(id), ...rest]),
        cards: await run(parsed.itemQuery as Q),
        meta: meta as Q,
      };
    }

    const countsOf = (got: Got, by: string): Record<string, number> =>
      Object.fromEntries(
        (got.meta.facets?.[by] ?? []).map(
          (f: { value: string; count: number }) => [f.value, f.count],
        ),
      );

    function close(
      assert: Assert,
      actual: unknown,
      expected: number,
      message: string,
      tolerance = 1e-12,
    ) {
      assert.true(
        actual != null && Math.abs(Number(actual) - expected) <= tolerance,
        `${message}: expected ${expected}, got ${actual}`,
      );
    }

    // These need pgvector; on a database without it each passes with a note.
    function vectorTest(name: string, fn: (assert: Assert) => Promise<void>) {
      test(name, async function (assert) {
        if (vectors) {
          await fn(assert);
        } else {
          assert.ok(true, 'skipped: this Postgres has no pgvector');
        }
      });
    }

    // --- filter and let ----------------------------------------------------

    test('a list binding is resolved before the filter that reads it, from its own filter alone: it does not see the query filter', async function (assert) {
      // The groups holding a row scored 80 or more: g1 (a, b) and g2 (j).
      let hot = new Set(ITEMS.filter((r) => r.score >= 80).map((r) => r.group));
      let expected = names(
        ITEMS.filter((r) => r.color === 'red' && hot.has(r.group)),
      );
      // Had the binding run under the query's filter too (red rows scored 80
      // or more: a alone), its list would be g1 only, and e would be lost.
      let narrowed = new Set(
        ITEMS.filter((r) => r.color === 'red' && r.score >= 80).map(
          (r) => r.group,
        ),
      );
      let other = names(
        ITEMS.filter((r) => r.color === 'red' && narrowed.has(r.group)),
      );
      assert.deepEqual(expected, ['a', 'c', 'e']);
      assert.deepEqual(other, ['a', 'c'], 'the other order differs');
      await inEveryForm(
        {
          type: T,
          let: {
            $hot: {
              from: { type: T, filter: { range: { score: { gte: 80 } } } },
              select: 'group',
            },
          },
          filter: {
            every: [{ eq: { color: 'red' } }, { in: { group: '$hot' } }],
          },
        },
        {
          let: {
            $hot: {
              from: { filter: { on: T, range: { score: { gte: 80 } } } },
              select: 'group',
            },
          },
          filter: {
            on: T,
            every: [
              { on: T, eq: { color: 'red' } },
              { on: T, in: { group: '$hot' } },
            ],
          },
        },
        (got, form) => {
          assert.deepEqual(got.names, expected, form);
          assert.deepEqual(
            got.meta.lets,
            { $hot: { strategy: 'list', values: hot.size } },
            `${form}: the binding's list`,
          );
        },
      );
    });

    test('a binding sorts its own rows and then takes its own page', async function (assert) {
      // The groups of the two best-scored rows: a (g1) and j (g2).
      let top = new Set(
        pageOf(
          sorted(
            ITEMS,
            desc((r) => r.score),
          ),
          2,
        ).map((r) => r.group),
      );
      let expected = names(ITEMS.filter((r) => top.has(r.group)));
      // Page first, then sort: the first two rows by URL are a and b, both g1.
      let firstTwo = new Set(pageOf(sorted(ITEMS), 2).map((r) => r.group));
      let other = names(ITEMS.filter((r) => firstTwo.has(r.group)));
      assert.deepEqual(expected, ['a', 'b', 'c', 'd', 'e', 'j']);
      assert.deepEqual(other, ['a', 'b', 'c'], 'the other order differs');
      await inEveryForm(
        {
          type: T,
          let: {
            $top: {
              from: { type: T, sort: scoreDesc, page: { size: 2 } },
              select: 'group',
            },
          },
          filter: { in: { group: '$top' } },
        },
        {
          let: {
            $top: {
              from: {
                filter: { type: T },
                sort: scoreDescSaved,
                page: { size: 2 },
              },
              select: 'group',
            },
          },
          filter: { on: T, in: { group: '$top' } },
        },
        (got, form) => assert.deepEqual(got.names, expected, form),
      );
    });

    test('a one-card binding is the first row of its own filter and sort, read before the filter that uses it', async function (assert) {
      // The cheapest green row is j, at 25.
      let card = sorted(
        ITEMS.filter((r) => r.color === 'green'),
        asc((r) => r.price),
      )[0];
      let expected = names(ITEMS.filter((r) => r.price < card.price));
      // Without its sort the first green row by URL is f, at 60.
      let unsorted = sorted(ITEMS.filter((r) => r.color === 'green'))[0];
      let other = names(ITEMS.filter((r) => r.price < unsorted.price));
      assert.deepEqual(expected, ['a', 'b', 'i']);
      assert.notDeepEqual(other, expected, 'the other order differs');
      await inEveryForm(
        {
          type: T,
          let: {
            $cheapest: {
              from: {
                type: T,
                filter: { eq: { color: 'green' } },
                sort: [{ by: 'price', direction: 'asc' }],
              },
              one: true,
            },
          },
          filter: {
            range: { price: { lt: '$cheapest.price' } },
          },
        },
        undefined,
        (got, form) => {
          assert.deepEqual(got.names, expected, form);
          assert.deepEqual(
            got.meta.lets,
            { $cheapest: { strategy: 'card', found: true } },
            `${form}: the binding found its card`,
          );
        },
      );
    });

    // --- facets ------------------------------------------------------------

    test('a facet counts the rows the filter admits', async function (assert) {
      let matches = ITEMS.filter((r) => r.price <= 50);
      let expected = countBy(matches, (r) => r.color);
      let other = countBy(ITEMS, (r) => r.color);
      assert.deepEqual(expected, { red: 4, blue: 2, green: 1 });
      assert.notDeepEqual(other, expected, 'counting before the filter');
      await inEveryForm(
        {
          type: T,
          filter: { range: { price: { lte: 50 } } },
          facets: [{ by: 'color' }],
        },
        {
          filter: { on: T, range: { price: { lte: 50 } } },
          facets: [{ by: 'color' }],
        },
        (got, form) => {
          assert.deepEqual(countsOf(got, 'color'), expected, form);
          assert.deepEqual(got.names, names(matches), `${form}: rows`);
        },
      );
    });

    test('facets count rows before the collapse, so they disagree with the collapsed total', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let kept = collapse(order).map((k) => k.row);
      let expected = countBy(ITEMS, (r) => r.color);
      // Counted after the collapse (a, j, f, g, h): red 2, green 2, blue 1.
      let other = countBy(kept, (r) => r.color);
      assert.deepEqual(expected, { red: 5, blue: 3, green: 2 });
      assert.deepEqual(other, { red: 2, green: 2, blue: 1 });
      await inEveryForm(
        {
          type: T,
          sort: scoreDesc,
          collapse: 'group',
          facets: [{ by: 'color' }],
        },
        {
          filter: { type: T },
          sort: scoreDescSaved,
          collapse: { by: 'group', on: T },
          facets: [{ by: 'color' }],
        },
        (got, form) => {
          assert.deepEqual(got.names, names(kept), `${form}: collapsed rows`);
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${form}: total`,
          );
          assert.deepEqual(countsOf(got, 'color'), expected, form);
        },
      );
    });

    test('a window changes no facet count: facets count every match, not the window or the page', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let expected = countBy(ITEMS, (r) => r.color);
      // The window is a, j, b (red, green, blue): one of each.
      assert.notDeepEqual(
        countBy(order.slice(0, 3), (r) => r.color),
        expected,
      );
      let page = pageOf(
        rerank(order, 3, (r) => r.price),
        2,
      );
      let w = { expression: 'price', top: 3 };
      let more = { facets: [{ by: 'color' }], page: { size: 2 } };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], ...more },
        { filter: { type: T }, sort: [w, ...scoreDescSaved], ...more },
        (got, form) => {
          assert.deepEqual(got.names, names(page), `${form}: the page`);
          assert.deepEqual(countsOf(got, 'color'), expected, form);
        },
      );
    });

    vectorTest(
      'a near threshold is part of the filter: a facet counts only the rows it admits',
      async function (assert) {
        let admitted = ITEMS.filter(
          (r) => (similarity(TOWARD_X)(r) ?? -1) >= THRESHOLD,
        );
        let expected = countBy(admitted, (r) => r.color);
        assert.deepEqual(names(admitted), ['a', 'b', 'd', 'j']);
        assert.deepEqual(expected, { red: 1, blue: 2, green: 1 });
        // Counted before the threshold: { red: 5, blue: 3, green: 2 }.
        let near = { embedding: { to: TOWARD_X, minSimilarity: THRESHOLD } };
        await inEveryForm(
          { type: T, filter: { near }, facets: [{ by: 'color' }] },
          { filter: { on: T, near }, facets: [{ by: 'color' }] },
          (got, form) => {
            assert.deepEqual(got.names, names(admitted), `${form}: rows`);
            assert.deepEqual(countsOf(got, 'color'), expected, form);
          },
        );
      },
    );

    // --- total and hasMore -------------------------------------------------

    test('under a collapse, total and hasMore count the rows that remain, not the matches', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let kept = collapse(order).map((k) => k.row);
      assert.strictEqual(kept.length, 5, 'three groups and two rows alone');
      assert.strictEqual(collapse(order, 2).length, 8);
      // Counted before the collapse, every total here would be 10.
      for (let mode of totalModes) {
        // pins current behavior; rule not yet decided: under a collapse
        // `total: 'none'` still counts what remains (docs: "counts nothing;
        // the total is the rows seen so far", which would be 2 here).
        await inEveryForm(
          {
            type: T,
            sort: scoreDesc,
            collapse: 'group',
            page: paged(2, mode),
          },
          {
            filter: { type: T },
            sort: scoreDescSaved,
            collapse: { by: 'group', on: T },
            page: paged(2, mode),
          },
          (got, form) => {
            let at = `${form}, total ${mode ?? 'unnamed'}`;
            assert.deepEqual(got.names, names(pageOf(kept, 2)), at);
            assert.strictEqual(got.meta.page.total, kept.length, at);
            assert.true(got.meta.page.hasMore, `${at}: more groups follow`);
            assert.notOk(
              hasWarning(got.meta, 'total-estimated'),
              `${at}: exact`,
            );
          },
        );
      }
      let last = await run(
        lowerQuery({
          type: T,
          sort: scoreDesc,
          collapse: 'group',
          page: { number: 2, size: 2 },
        }).query,
      );
      assert.deepEqual(last.names, names(pageOf(kept, 2, 2)));
      assert.false(
        last.meta.page.hasMore,
        'the fifth kept row is the last, though five matches were hidden',
      );
      let two = await run(
        lowerQuery({
          type: T,
          sort: scoreDesc,
          collapse: { by: 'group', keep: 2 },
          page: { size: 2 },
        }).query,
      );
      assert.strictEqual(two.meta.page.total, 8, 'keep: 2 counts two a group');
    });

    test('under a window, total counts every match, not the window', async function (assert) {
      let w = { expression: 'price', top: 4 };
      let more = { page: { size: 2 } };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], ...more },
        { filter: { type: T }, sort: [w, ...scoreDescSaved], ...more },
        (got, form) => {
          assert.strictEqual(got.meta.page.total, ITEMS.length, form);
          assert.true(got.meta.page.hasMore, `${form}: more pages follow`);
        },
      );
    });

    test('under a window, hasMore says whether a page follows the page asked for', async function (assert) {
      // docs/search.md: "`meta.page.hasMore`: Whether another page follows
      // this one." Ten rows match and the page holds two, so one does. The
      // window (100) is larger than the result.
      let w = { expression: 'price', top: 100 };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], page: { size: 2 } },
        {
          filter: { type: T },
          sort: [w, ...scoreDescSaved],
          page: { size: 2 },
        },
        (got, form) => {
          assert.strictEqual(got.names.length, 2, `${form}: a page of two`);
          assert.strictEqual(got.meta.page.total, ITEMS.length, form);
          assert.true(
            got.meta.page.hasMore,
            `${form}: eight rows follow the page`,
          );
        },
      );
      let last = await run(
        lowerQuery({
          type: T,
          sort: [w, ...scoreDesc],
          page: { number: 4, size: 2 },
        }).query,
      );
      assert.strictEqual(last.names.length, 2);
      assert.false(last.meta.page.hasMore, 'nothing follows the last page');
    });

    vectorTest(
      'a near threshold decides the total and hasMore',
      async function (assert) {
        let admitted = sorted(
          ITEMS.filter((r) => (similarity(TOWARD_X)(r) ?? -1) >= THRESHOLD),
          asc((r) => r.price),
        );
        assert.strictEqual(admitted.length, 4, 'of ten rows');
        let near = { embedding: { to: TOWARD_X, minSimilarity: THRESHOLD } };
        for (let mode of totalModes.filter((m) => m !== 'none')) {
          await inEveryForm(
            {
              type: T,
              filter: { near },
              sort: [{ by: 'price' }],
              page: paged(2, mode),
            },
            {
              filter: { on: T, near },
              sort: [{ on: T, by: 'price' }],
              page: paged(2, mode),
            },
            (got, form) => {
              let at = `${form}, total ${mode ?? 'unnamed'}`;
              assert.deepEqual(got.names, names(pageOf(admitted, 2)), at);
              assert.strictEqual(got.meta.page.total, admitted.length, at);
              assert.true(got.meta.page.hasMore, at);
            },
          );
        }
      },
    );

    test('under a blend, total counts every match in every total mode', async function (assert) {
      let scores = fuse(ITEMS, SCORE_AND_STOCK);
      let order = sorted(ITEMS, byFused(scores));
      for (let mode of totalModes) {
        // pins current behavior; rule not yet decided: a blend ranks every
        // match, so `total: 'none'` still gets the full count (docs: "the
        // rows seen so far").
        await inEveryForm(
          { type: T, sort: [scoreAndStock], page: paged(2, mode) },
          undefined,
          (got, form) => {
            let at = `${form}, total ${mode ?? 'unnamed'}`;
            assert.deepEqual(got.names, names(pageOf(order, 2)), at);
            assert.strictEqual(got.meta.page.total, ITEMS.length, at);
            assert.true(got.meta.page.hasMore, at);
          },
        );
      }
    });

    // --- totals past the cap ------------------------------------------------

    const bulkForms = (more: Q, size = 10, number = 0) =>
      totalModes.map(
        (mode) =>
          [
            mode,
            lowerQuery({ type: R, ...more, page: paged(size, mode, number) })
              .query as Q,
          ] as const,
      );

    test('a plain page counts its total as far as the total mode asks', async function (assert) {
      for (let [mode, query] of bulkForms({ sort: [{ by: 'n' }] })) {
        let got = await run(query, bulkRealm);
        assert.deepEqual(got.names, pageOf(bulkNames(), 10), `${mode}: rows`);
        assert.true(got.meta.page.hasMore, `${mode}: hasMore`);
        if (mode === 'exact') {
          assert.strictEqual(got.meta.page.total, BULK_ROWS, 'exact');
          assert.notOk(
            hasWarning(got.meta, 'total-estimated'),
            'exact: no estimate',
          );
        } else if (mode === 'none') {
          assert.true(
            hasWarning(got.meta, 'total-estimated'),
            'none: a lower bound',
          );
          // decided: under 'none' the total is the rows up to and on this
          // page (offset + rows returned); hasMore says that more follow.
          assert.strictEqual(got.meta.page.total, 10, 'none: offset + rows');
        } else {
          assert.strictEqual(got.meta.page.total, TOTAL_CAP, `${mode}: capped`);
          assert.true(
            hasWarning(got.meta, 'total-estimated'),
            `${mode}: a lower bound`,
          );
        }
      }
    });

    test('a collapsed total counts the groups exactly in every total mode, past the cap too', async function (assert) {
      // pins current behavior; rule not yet decided: docs/search.md says a
      // total "counts up to 1,000 matches unless the query asks for
      // `page.total: 'exact'`"; a collapsed total is never capped.
      for (let [mode, query] of bulkForms({
        sort: [{ by: 'n' }],
        collapse: 'bucket',
      })) {
        let got = await run(query, bulkRealm);
        assert.strictEqual(got.meta.page.total, BULK_BUCKETS, `${mode}`);
        assert.notOk(hasWarning(got.meta, 'total-estimated'), `${mode}: exact`);
        assert.true(got.meta.page.hasMore, `${mode}: hasMore`);
      }
    });

    test('a blended total counts every match exactly in every total mode, past the cap too', async function (assert) {
      // pins current behavior; rule not yet decided: as for a collapse, the
      // count is taken in the pass that ranks over every match, so no mode
      // caps it.
      for (let [mode, query] of bulkForms({
        sort: [{ blend: [{ by: 'n' }] }],
      })) {
        let got = await run(query, bulkRealm);
        let at = `blend ${mode}`;
        assert.strictEqual(got.meta.page.total, BULK_ROWS, at);
        assert.notOk(hasWarning(got.meta, 'total-estimated'), `${at}: exact`);
        assert.true(got.meta.page.hasMore, `${at}: hasMore`);
      }
    });

    test('asking for facets leaves the total as its mode counts it', async function (assert) {
      // docs/search.md (Declarative): asking for facets never changes the
      // rows or their counts. Facets are counted by their own queries over
      // the facet table, so the page and its total are the same query's
      // without them, and every facet still counts every match.
      for (let [mode, query] of bulkForms({ sort: [{ by: 'n' }] })) {
        let plain = await run(query, bulkRealm);
        let faceted = await run(
          { ...query, facets: [{ by: 'bucket', size: 1 }] },
          bulkRealm,
        );
        assert.deepEqual(faceted.meta.page, plain.meta.page, mode);
        assert.strictEqual(
          faceted.meta.facets?.bucket?.[0]?.count,
          2,
          `${mode}: the facet counts every match`,
        );
      }
    });

    test("under a window, total: 'exact' still counts every match", async function (assert) {
      // docs/search.md: "`exact` counts every match."
      let [, query] = bulkForms({
        sort: [{ expression: 'n', top: 20 }, { by: 'n' }],
      }).find(([mode]) => mode === 'exact')!;
      let got = await run(query, bulkRealm);
      assert.strictEqual(got.names.length, 10);
      assert.strictEqual(got.meta.page.total, BULK_ROWS, 'every match');
      assert.notOk(
        hasWarning(got.meta, 'total-estimated'),
        'not a lower bound',
      );
    });

    // --- sort and collapse --------------------------------------------------

    test("a collapse keeps each group's best row by the query's sort, and what remains comes back in that sort", async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.price),
      );
      let expected = names(collapse(order).map((k) => k.row));
      // Collapsed in URL order first (a, d, f, g, h) and sorted afterwards.
      let other = names(
        sorted(
          collapse(sorted(ITEMS)).map((k) => k.row),
          desc((r) => r.price),
        ),
      );
      assert.deepEqual(expected, ['h', 'g', 'f', 'e', 'c']);
      assert.deepEqual(other, ['h', 'g', 'f', 'd', 'a']);
      await inEveryForm(
        {
          type: T,
          sort: [{ by: 'price', direction: 'desc' }],
          collapse: 'group',
        },
        {
          filter: { type: T },
          sort: [{ on: T, by: 'price', direction: 'desc' }],
          collapse: { by: 'group', on: T },
        },
        (got, form) => assert.deepEqual(got.names, expected, form),
      );
    });

    test('the page is cut after the collapse', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let kept = collapse(order).map((k) => k.row);
      for (let number of [0, 1]) {
        let expected = names(pageOf(kept, 3, number));
        // Paged first: the best three are a, j and b, and b shares a's group,
        // so the first page would hold two rows.
        let other = names(collapse(pageOf(order, 3, number)).map((k) => k.row));
        assert.notDeepEqual(other, expected, `page ${number}: orders differ`);
        await inEveryForm(
          {
            type: T,
            sort: scoreDesc,
            collapse: 'group',
            page: { number, size: 3 },
          },
          {
            filter: { type: T },
            sort: scoreDescSaved,
            collapse: { by: 'group', on: T },
            page: { number, size: 3 },
          },
          (got, form) =>
            assert.deepEqual(got.names, expected, `${form}, page ${number}`),
        );
      }
      assert.deepEqual(names(pageOf(kept, 3)), ['a', 'j', 'f']);
    });

    test("keep: N keeps each group's first N by the sort, and every kept row reports how many rows the filter admitted to its group", async function (assert) {
      let matches = ITEMS.filter((r) => r.price <= 50);
      let kept = collapse(
        sorted(
          matches,
          desc((r) => r.score),
        ),
        2,
      );
      let expected = kept.map((k) => [k.row.name, k.size]);
      assert.deepEqual(expected, [
        ['a', 3],
        ['j', 3],
        ['b', 3],
        ['d', 3],
        ['i', 1],
      ]);
      // A size counted before the filter would give i's group 2 (f, at 60,
      // is filtered out); a size counting only the kept rows would give 2
      // to a, j, b and d.
      await inEveryForm(
        {
          type: T,
          filter: { range: { price: { lte: 50 } } },
          sort: scoreDesc,
          collapse: { by: 'group', keep: 2 },
        },
        {
          filter: { on: T, range: { price: { lte: 50 } } },
          sort: scoreDescSaved,
          collapse: { by: 'group', on: T, keep: 2 },
        },
        (got, form) => {
          assert.deepEqual(
            got.rows.map((r) => [nameOf(r.url), Number(r._collapseSize)]),
            expected,
            form,
          );
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${form}: total`,
          );
        },
      );
    });

    test("under a blend, a collapse keeps each group's highest fused score, ranked over every match and not over what remains", async function (assert) {
      let scores = fuse(ITEMS, SCORE_AND_STOCK);
      let kept = collapse(sorted(ITEMS, byFused(scores)));
      let expected = names(kept.map((k) => k.row));
      // Best by the blend's first signal alone (the score): a, j, f.
      let other = names(
        collapse(
          sorted(
            ITEMS,
            desc((r) => r.score),
          ),
        ).map((k) => k.row),
      );
      assert.deepEqual(expected, ['d', 'g', 'a', 'h', 'i']);
      assert.deepEqual(other, ['a', 'j', 'f', 'g', 'h']);
      // Ranked over the five survivors instead, d would score 1/61 + 3/62.
      let after = fuse(
        kept.map((k) => k.row),
        SCORE_AND_STOCK,
      );
      assert.notStrictEqual(after.get('d'), scores.get('d'));
      await inEveryForm(
        { type: T, sort: [scoreAndStock], collapse: 'group' },
        undefined,
        (got, form) => {
          assert.deepEqual(got.names, expected, form);
          for (let row of got.rows) {
            let name = nameOf(row.url);
            close(
              assert,
              row._blendScore,
              scores.get(name)!,
              `${form}: ${name}'s score`,
            );
          }
        },
      );
    });

    vectorTest(
      "under a near sort, a collapse keeps each group's most similar row",
      async function (assert) {
        let kept = collapse(sorted(ITEMS, nearest(TOWARD_Y)));
        let expected = names(kept.map((k) => k.row));
        // g1 keeps c (the y axis itself), g2 keeps e, g3 keeps f (i has no
        // vector); by URL the groups would keep a, d and f.
        assert.deepEqual(expected, ['c', 'e', 'g', 'f', 'h']);
        await inEveryForm(
          {
            type: T,
            sort: [{ by: 'embedding', near: TOWARD_Y }],
            collapse: 'group',
          },
          {
            filter: { type: T },
            sort: [{ on: T, by: 'embedding', near: TOWARD_Y }],
            collapse: { by: 'group', on: T },
          },
          (got, form) => {
            assert.deepEqual(got.names, expected, form);
            for (let row of got.rows) {
              let item = ITEMS.find((r) => r.name === nameOf(row.url))!;
              close(
                assert,
                row._nearSimilarity,
                similarity(TOWARD_Y)(item)!,
                `${form}: ${item.name}'s similarity`,
                0.02,
              );
            }
          },
        );
      },
    );

    // --- a window (an expression sort entry with top) ------------------------

    test('a window is taken from the collapsed rows, and each row keeps its group size', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let kept = collapse(order);
      let size = new Map(kept.map((k) => [k.row.name, k.size]));
      let expected = rerank(
        kept.map((k) => k.row),
        3,
        (r) => r.price,
      );
      // Window taken from the raw rows (a, j, b) and collapsed afterwards.
      let other = collapse(rerank(order, 3, (r) => r.price)).map((k) => k.row);
      assert.deepEqual(names(expected), ['f', 'j', 'a', 'g', 'h']);
      assert.deepEqual(names(other), ['j', 'b', 'f', 'g', 'h']);
      let w = { expression: 'price', top: 3 };
      let more = { page: { size: 5 } };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], collapse: 'group', ...more },
        {
          filter: { type: T },
          sort: [w, ...scoreDescSaved],
          collapse: { by: 'group', on: T },
          ...more,
        },
        (got, form) => {
          assert.deepEqual(got.names, names(expected), form);
          assert.deepEqual(
            got.rows.map((r) => Number(r._collapseSize)),
            expected.map((r) => size.get(r.name)),
            `${form}: group sizes`,
          );
          assert.deepEqual(
            got.rows.map((r) => (r._window == null ? null : Number(r._window))),
            expected.map((r, i) => (i < 3 ? r.price : null)),
            `${form}: only the window carries a rerank value`,
          );
          assert.strictEqual(got.meta.window?.rows, 3, `${form}: window`);
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${form}: total`,
          );
        },
      );
    });

    test('a window is the top N of the whole sorted result, and pages are cut after it', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let expected = rerank(order, 4, (r) => r.price);
      assert.deepEqual(names(expected).slice(0, 4), ['d', 'j', 'b', 'a']);
      for (let number of [0, 1, 2]) {
        let page = pageOf(expected, 2, number);
        // Paged first and re-ranked afterwards: (j, a), then (d, b).
        let other = rerank(pageOf(order, 2, number), 4, (r) => r.price);
        if (number < 2) {
          assert.notDeepEqual(names(other), names(page), `page ${number}`);
        }
        let w = { expression: 'price', top: 4 };
        let more = { page: { number, size: 2 } };
        await inEveryForm(
          { type: T, sort: [w, ...scoreDesc], ...more },
          { filter: { type: T }, sort: [w, ...scoreDescSaved], ...more },
          (got, form) => {
            let at = `${form}, page ${number}`;
            assert.deepEqual(got.names, names(page), at);
            assert.deepEqual(
              got.rows.map((r) =>
                r._window == null ? null : Number(r._window),
              ),
              page.map((r) => (number < 2 ? r.price : null)),
              `${at}: rerank values`,
            );
            assert.strictEqual(got.meta.page.total, ITEMS.length, at);
            if (number === 2) {
              // pins current behavior; rule not yet decided: a page that
              // starts past the window skips the rerank altogether, so the
              // answer carries no `meta.window`.
              assert.strictEqual(got.meta.window, undefined, at);
            } else {
              assert.strictEqual(got.meta.window?.rows, 4, at);
            }
          },
        );
      }
    });

    test('a page that straddles the window ends with rows in the sort order, carrying no rerank value', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let page = pageOf(
        rerank(order, 3, (r) => r.price),
        2,
        1,
      );
      assert.deepEqual(names(page), ['a', 'd']);
      let w = { expression: 'price', top: 3 };
      let more = { page: { number: 1, size: 2 } };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], ...more },
        { filter: { type: T }, sort: [w, ...scoreDescSaved], ...more },
        (got, form) => {
          assert.deepEqual(got.names, names(page), form);
          assert.deepEqual(
            got.rows.map((r) => (r._window == null ? null : Number(r._window))),
            [10, null],
            `${form}: a is the window's last row, d follows it`,
          );
        },
      );
    });

    // --- blend ---------------------------------------------------------------

    test('each blend signal is ranked over every row the filter admits: not over every card, and not over the page', async function (assert) {
      let red = ITEMS.filter((r) => r.color === 'red');
      let scores = fuse(red, SCORE_AND_STOCK);
      let order = sorted(red, byFused(scores));
      assert.deepEqual(names(order), ['g', 'a', 'i', 'c', 'e']);
      // Ranked before the filter, over all ten rows, the same rows score
      // lower (a is fifth by stock there, second among the red).
      let unfiltered = fuse(ITEMS, SCORE_AND_STOCK);
      assert.true(unfiltered.get('a')! < scores.get('a')!);
      for (let number of [0, 1]) {
        let page = pageOf(order, 2, number);
        // Ranked over its own two rows, the second page would score as the
        // first does.
        assert.notStrictEqual(
          fuse(page, SCORE_AND_STOCK).get(page[0].name),
          scores.get(page[0].name),
        );
        await inEveryForm(
          {
            type: T,
            filter: { eq: { color: 'red' } },
            sort: [scoreAndStock],
            page: { number, size: 2 },
          },
          undefined,
          (got, form) => {
            let at = `${form}, page ${number}`;
            assert.deepEqual(got.names, names(page), at);
            for (let row of got.rows) {
              let name = nameOf(row.url);
              close(
                assert,
                row._blendScore,
                scores.get(name)!,
                `${at}: ${name}`,
              );
            }
          },
        );
      }
    });

    test('a boost inside a blend lifts rows before the collapse chooses each group', async function (assert) {
      let signals: Signal[] = [
        { value: (r) => r.score },
        { boost: (r) => r.color === 'red', weight: 3 },
      ];
      let scores = fuse(ITEMS, signals);
      let expected = names(
        collapse(sorted(ITEMS, byFused(scores))).map((k) => k.row),
      );
      // Collapsed by score first (a, j, f, g, h) and boosted afterwards, the
      // red rows e and i would already be gone.
      let survivors = collapse(
        sorted(
          ITEMS,
          desc((r) => r.score),
        ),
      ).map((k) => k.row);
      let other = names(sorted(survivors, byFused(fuse(survivors, signals))));
      assert.deepEqual(expected, ['a', 'e', 'g', 'i', 'h']);
      assert.deepEqual(other, ['a', 'g', 'j', 'f', 'h']);
      await inEveryForm(
        {
          type: T,
          sort: [
            {
              blend: [
                { by: 'score' },
                { boost: { eq: { color: 'red' } }, weight: 3 },
              ],
            },
          ],
          collapse: 'group',
        },
        undefined,
        (got, form) => {
          assert.deepEqual(got.names, expected, form);
          for (let row of got.rows) {
            let name = nameOf(row.url);
            close(
              assert,
              row._blendScore,
              scores.get(name)!,
              `${form}: ${name}`,
            );
          }
        },
      );
    });

    // --- near ----------------------------------------------------------------

    vectorTest(
      'a near threshold is applied before a near sort and the page',
      async function (assert) {
        let admitted = ITEMS.filter(
          (r) => (similarity(TOWARD_X)(r) ?? -1) >= THRESHOLD,
        );
        let order = sorted(admitted, nearest(TOWARD_Y));
        let expected = pageOf(order, 2);
        // Sorted and paged first, the two rows nearest the y axis (c, e) would
        // both fail the threshold on the x axis: an empty page.
        let other = pageOf(sorted(ITEMS, nearest(TOWARD_Y)), 2).filter(
          (r) => (similarity(TOWARD_X)(r) ?? -1) >= THRESHOLD,
        );
        assert.deepEqual(names(expected), ['d', 'j']);
        assert.deepEqual(names(other), []);
        let near = { embedding: { to: TOWARD_X, minSimilarity: THRESHOLD } };
        await inEveryForm(
          {
            type: T,
            filter: { near },
            sort: [{ by: 'embedding', near: TOWARD_Y }],
            page: { size: 2 },
          },
          {
            filter: { on: T, near },
            sort: [{ on: T, by: 'embedding', near: TOWARD_Y }],
            page: { size: 2 },
          },
          (got, form) => {
            assert.deepEqual(got.names, names(expected), form);
            assert.strictEqual(got.meta.page.total, admitted.length, form);
            assert.true(got.meta.page.hasMore, form);
            for (let [i, row] of got.rows.entries()) {
              close(
                assert,
                row._nearSimilarity,
                similarity(TOWARD_Y)(expected[i])!,
                `${form}: the similarity is the sort's, not the filter's`,
                0.02,
              );
            }
          },
        );
      },
    );

    // --- select --------------------------------------------------------------

    test('a select table has the rows the card answer has, in its order, after collapse, a window and page', async function (assert) {
      let matches = ITEMS.filter((r) => r.price <= 70);
      let kept = collapse(
        sorted(
          matches,
          desc((r) => r.score),
        ),
      );
      let size = new Map(kept.map((k) => [k.row.name, k.size]));
      let order = rerank(
        kept.map((k) => k.row),
        3,
        (r) => r.price,
      );
      assert.deepEqual(names(order), ['f', 'j', 'a', 'g']);
      for (let number of [0, 1]) {
        let page = pageOf(order, 2, number);
        let got = await table({
          type: T,
          filter: { range: { price: { lte: 70 } } },
          sort: [{ expression: 'price', top: 3 }, ...scoreDesc],
          collapse: 'group',
          page: { number, size: 2 },
          select: ['name', 'price', '_window', '_collapseSize'],
        });
        assert.deepEqual(got.columns, [
          'id',
          'name',
          'price',
          '_window',
          '_collapseSize',
        ]);
        assert.deepEqual(
          got.rows,
          page.map((r) => [
            r.name,
            r.name,
            r.price,
            // the fourth row lies past the window of three
            order.indexOf(r) < 3 ? r.price : null,
            size.get(r.name),
          ]),
          `page ${number}`,
        );
        assert.deepEqual(
          got.rows.map((r) => r[0]),
          got.cards.names,
          `page ${number}: the card answer's rows`,
        );
        assert.strictEqual(got.meta.page.total, kept.length);
        assert.strictEqual(got.cards.meta.page.total, kept.length);
      }
    });

    test('a select score column carries the score the card answer carries, ranked over every match', async function (assert) {
      let scores = fuse(ITEMS, SCORE_AND_STOCK);
      let kept = collapse(sorted(ITEMS, byFused(scores)));
      let page = pageOf(kept, 3);
      let got = await table({
        type: T,
        sort: [scoreAndStock],
        collapse: 'group',
        page: { size: 3 },
        select: ['_blendScore', '_collapseSize'],
      });
      assert.deepEqual(
        got.rows.map((r) => [r[0], r[2]]),
        page.map((k) => [k.row.name, k.size]),
      );
      for (let [i, row] of got.rows.entries()) {
        close(assert, row[1], scores.get(page[i].row.name)!, `${row[0]}`);
        assert.strictEqual(
          row[1],
          Number(got.cards.rows[i]._blendScore),
          `${row[0]}: the card answer's score`,
        );
      }
    });

    // --- explain -------------------------------------------------------------

    test('explain reports and never changes the answer', async function (assert) {
      let queries: [string, Q][] = [
        [
          'blend + collapse + facets + page',
          {
            type: T,
            filter: { range: { price: { lte: 70 } } },
            sort: [scoreAndStock],
            collapse: 'group',
            facets: [{ by: 'color' }],
            page: { size: 3 },
          },
        ],
        [
          'blend + window + page',
          {
            type: T,
            sort: [{ expression: 'price', top: 4 }, scoreAndStock],
            page: { number: 1, size: 3 },
          },
        ],
        ['a field sort', { type: T, sort: scoreDesc, page: { size: 3 } }],
      ];
      let answer = (got: Got) => ({
        names: got.names,
        total: got.meta.page.total,
        hasMore: got.meta.page.hasMore,
        facets: got.meta.facets,
        rerank: got.meta.window,
        scores: got.rows.map((r) => [
          r._blendScore == null ? null : Number(r._blendScore),
          r._window == null ? null : Number(r._window),
          r._collapseSize == null ? null : Number(r._collapseSize),
        ]),
      });
      for (let [name, typed] of queries) {
        let plain = forms(typed);
        let explained = forms({ ...typed, explain: true });
        for (let [i, [form, query]] of plain.entries()) {
          let without = await run(query);
          let withExplain = await run(explained[i][1]);
          assert.true(without.names.length > 0, `${name}, ${form}: rows`);
          assert.deepEqual(
            answer(withExplain),
            answer(without),
            `${name}, ${form}: the same answer`,
          );
          assert.true(
            without.rows.every((r) => r._explain === undefined),
            `${name}, ${form}: nothing unasked`,
          );
          // the order's first key, past a window (an expression with top)
          let leading = Array.isArray(typed.sort)
            ? typed.sort.find((e: Q) => !('top' in e))
            : undefined;
          let blended = Boolean(leading && 'blend' in leading);
          for (let row of withExplain.rows) {
            if (blended) {
              close(
                assert,
                row._explain?.score,
                Number(row._blendScore),
                `${name}, ${form}: ${nameOf(row.url)} explains its own score`,
              );
            } else {
              assert.strictEqual(
                row._explain,
                undefined,
                'no blend to explain',
              );
            }
          }
        }
      }
    });

    test('explain ranks each signal over every match, whatever the collapse and the page hide', async function (assert) {
      let matches = ITEMS.filter((r) => r.price <= 70);
      let scores = fuse(matches, SCORE_AND_STOCK);
      let page = pageOf(collapse(sorted(matches, byFused(scores))), 2, 1);
      let ranks = SCORE_AND_STOCK.map((signal) => ranksOf(matches, signal));
      await inEveryForm(
        {
          type: T,
          filter: { range: { price: { lte: 70 } } },
          sort: [scoreAndStock],
          collapse: 'group',
          explain: true,
          page: { number: 1, size: 2 },
        },
        undefined,
        (got, form) => {
          assert.deepEqual(got.names, names(page.map((k) => k.row)), form);
          for (let row of got.rows) {
            let name = nameOf(row.url);
            assert.deepEqual(
              row._explain.signals.map((s: Q) => s.rank),
              ranks.map((r) => r.get(name)),
              `${form}: ${name}'s ranks over the nine matches`,
            );
          }
        },
      );
    });

    vectorTest(
      "explain lists a row's signals in the order the blend lists them, each with exactly the fields it has today",
      async function (assert) {
        let blend = [
          { boost: { eq: { color: 'red' } }, weight: 2 },
          { by: 'price', direction: 'asc' },
          { by: 'embedding', near: TOWARD_X },
          { by: 'stock', weight: -0.5 },
          { expression: 'score / 10' },
        ];
        let signals: Signal[] = [
          { boost: (r) => r.color === 'red', weight: 2 },
          { value: (r) => r.price, direction: 'asc' },
          { value: similarity(TOWARD_X) },
          { value: (r) => r.stock, weight: -0.5 },
          { value: (r) => r.score / 10 },
        ];
        // a near signal is named by its field, as docs/search.md says of
        // every signal ("the field a signal sorts by")
        let named = ['when', 'price', 'embedding', 'stock', 'score / 10'];
        let weights = [2, 1, 1, -0.5, 1];
        let fields = ['signal', 'weight', 'value', 'rank', 'contribution'];
        let inverted = [
          'signal',
          'weight',
          'inverted',
          'value',
          'rank',
          'contribution',
        ];
        for (let reversed of [false, true]) {
          let order = (list: any[]) => (reversed ? [...list].reverse() : list);
          let scores = fuse(ITEMS, signals);
          let ranks = order(signals).map((s) => ranksOf(ITEMS, s));
          await inEveryForm(
            { type: T, sort: [{ blend: order(blend) }], explain: true },
            undefined,
            (got, form) => {
              let at = `${form}${reversed ? ', blend reversed' : ''}`;
              assert.strictEqual(got.rows.length, ITEMS.length, at);
              for (let row of got.rows) {
                let name = nameOf(row.url);
                let explain = row._explain;
                assert.deepEqual(
                  Object.keys(explain),
                  ['score', 'k', 'signals'],
                  `${at}: ${name}'s explanation`,
                );
                assert.strictEqual(explain.k, 60, `${at}: ${name}'s k`);
                close(
                  assert,
                  explain.score,
                  scores.get(name)!,
                  `${at}: ${name}`,
                );
                assert.deepEqual(
                  explain.signals.map((s: Q) => s.signal),
                  order(named),
                  `${at}: ${name}'s signals, as the blend lists them`,
                );
                assert.deepEqual(
                  explain.signals.map((s: Q) => s.weight),
                  order(weights),
                  `${at}: ${name}'s weights`,
                );
                assert.deepEqual(
                  explain.signals.map((s: Q) => Object.keys(s)),
                  order(weights).map((w) => (w < 0 ? inverted : fields)),
                  `${at}: ${name}'s entry fields`,
                );
                assert.deepEqual(
                  explain.signals.map((s: Q) => s.rank),
                  ranks.map((r) => r.get(name) ?? null),
                  `${at}: ${name}'s ranks`,
                );
                close(
                  assert,
                  explain.signals.reduce(
                    (t: number, s: Q) => t + s.contribution,
                    0,
                  ),
                  explain.score,
                  `${at}: ${name}'s contributions add up`,
                );
              }
              // The one row with no vector: no value, no rank, no share.
              let i = got.rows.find((r) => nameOf(r.url) === 'i')!;
              let near = i._explain.signals[order(named).indexOf('embedding')];
              assert.deepEqual(
                [near.value, near.rank, near.contribution],
                [null, null, 0],
                `${at}: a signal the row has no value for`,
              );
            },
          );
        }
      },
    );

    // --- relative dates and NOW() --------------------------------------------

    test('a relative bound in the filter, the same bound in a facet range and NOW() in an expression agree on which rows are recent', async function (assert) {
      // Rows within 30 days of the run, most recent first. The fixture's
      // days are 20 and 45 either side of the bound, so this holds whenever
      // it runs; it cannot show that the three read the same instant (see
      // the report: that needs a clock the test can set).
      let recent = sorted(
        ITEMS.filter((r) => r.daysAgo <= 30),
        asc((r) => r.daysAgo),
      );
      assert.deepEqual(names(recent), ['a', 'g', 'i', 'b', 'e']);
      await inEveryForm(
        {
          type: T,
          filter: { range: { day: { gte: 'now-30d/d' } } },
          sort: [{ expression: 'DAYS(NOW(), day)', direction: 'asc' }],
          facets: [
            {
              by: 'day',
              own: 'ignore',
              ranges: [
                { key: 'recent', from: 'now-30d/d' },
                { key: 'older', to: 'now-30d/d' },
              ],
            },
          ],
        },
        undefined,
        (got, form) => {
          assert.deepEqual(got.names, names(recent), `${form}: the filter`);
          assert.deepEqual(
            countsOf(got, 'day'),
            { recent: recent.length, older: ITEMS.length - recent.length },
            `${form}: the facet range, counted without the filter`,
          );
          for (let [i, row] of got.rows.entries()) {
            close(
              assert,
              row._expression,
              recent[i].daysAgo,
              `${form}: ${recent[i].name}'s age by NOW()`,
              1.5,
            );
          }
        },
      );
    });

    test('a malformed relative date on a date field is refused in a filter, a range bound and a facet range; on a text field it is text', async function (assert) {
      let refused = async (typed: Q, bound: string, where: string) => {
        for (let [form, query] of forms(typed)) {
          let error: any;
          try {
            await run(query);
          } catch (e) {
            error = e;
          }
          assert.strictEqual(
            error?.code,
            'invalid-value',
            `${where} (${form}): refused`,
          );
          let message = String(error?.message);
          let named = message.includes('day') && message.includes(bound);
          assert.true(
            named,
            `${where} (${form}): the message names the field and the bound: ${message}`,
          );
        }
      };
      await refused(
        { type: T, filter: { range: { day: { gte: 'now-3x' } } } },
        'now-3x',
        'an unknown unit in a range bound',
      );
      await refused(
        { type: T, filter: { eq: { day: 'now-1' } } },
        'now-1',
        'an amount with no unit under eq',
      );
      await refused(
        { type: T, filter: { in: { day: ['now/d', 'now/q'] } } },
        'now/q',
        'an unknown rounding under in',
      );
      await refused(
        {
          type: T,
          facets: [{ by: 'day', ranges: [{ key: 'x', from: 'now-3x' }] }],
        },
        'now-3x',
        'a facet range bound',
      );
      // The same string on a text field is the text as written: no item is
      // named it, so nothing matches, and nothing is refused.
      await inEveryForm(
        { type: T, filter: { eq: { name: 'now-3x' } } },
        undefined,
        (got, form) => assert.deepEqual(got.names, [], `${form}: text`),
      );
    });

    // --- three at once --------------------------------------------------------

    test('collapse, then the window, then page', async function (assert) {
      let order = sorted(
        ITEMS,
        desc((r) => r.score),
      );
      let kept = collapse(order);
      let size = new Map(kept.map((k) => [k.row.name, k.size]));
      let expected = pageOf(
        rerank(
          kept.map((k) => k.row),
          3,
          (r) => r.price,
        ),
        2,
        1,
      );
      // Rerank the raw rows, collapse, page: (f, g). Page the raw rows,
      // collapse, rerank: (b, d).
      let rerankFirst = pageOf(
        collapse(rerank(order, 3, (r) => r.price)).map((k) => k.row),
        2,
        1,
      );
      let pageFirst = rerank(
        collapse(pageOf(order, 2, 1)).map((k) => k.row),
        3,
        (r) => r.price,
      );
      assert.deepEqual(names(expected), ['a', 'g']);
      assert.deepEqual(names(rerankFirst), ['f', 'g']);
      assert.deepEqual(names(pageFirst), ['d', 'b']);
      let w = { expression: 'price', top: 3 };
      let more = { page: { number: 1, size: 2 } };
      await inEveryForm(
        { type: T, sort: [w, ...scoreDesc], collapse: 'group', ...more },
        {
          filter: { type: T },
          sort: [w, ...scoreDescSaved],
          collapse: { by: 'group', on: T },
          ...more,
        },
        (got, form) => {
          assert.deepEqual(got.names, names(expected), form);
          assert.deepEqual(
            got.rows.map((r) => [
              r._window == null ? null : Number(r._window),
              Number(r._collapseSize),
            ]),
            [
              [10, size.get('a')],
              [null, size.get('g')],
            ],
            `${form}: a is the window's last row; g lies past it`,
          );
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${form}: total`,
          );
        },
      );
    });

    test("filter, a facet with own: 'ignore', and collapse: the facet counts uncollapsed rows without its own selection", async function (assert) {
      let red = ITEMS.filter((r) => r.color === 'red');
      let kept = collapse(
        sorted(
          red,
          desc((r) => r.score),
        ),
      );
      let expected = countBy(ITEMS, (r) => r.color);
      // Under its own selection: { red: 5 }. Over collapsed rows without it
      // (a, j, f, g, h): { red: 2, green: 2, blue: 1 }.
      assert.deepEqual(expected, { red: 5, blue: 3, green: 2 });
      assert.deepEqual(names(kept.map((k) => k.row)), ['a', 'e', 'g', 'i']);
      await inEveryForm(
        {
          type: T,
          filter: { eq: { color: 'red' } },
          sort: scoreDesc,
          collapse: 'group',
          facets: [{ by: 'color', own: 'ignore' }],
        },
        {
          filter: { on: T, eq: { color: 'red' } },
          sort: scoreDescSaved,
          collapse: { by: 'group', on: T },
          facets: [{ by: 'color', own: 'ignore' }],
        },
        (got, form) => {
          assert.deepEqual(got.names, names(kept.map((k) => k.row)), form);
          assert.deepEqual(
            got.rows.map((r) => Number(r._collapseSize)),
            kept.map((k) => k.size),
            `${form}: sizes count the red rows of each group`,
          );
          assert.strictEqual(
            got.meta.page.total,
            kept.length,
            `${form}: total`,
          );
          assert.deepEqual(countsOf(got, 'color'), expected, `${form}: facet`);
        },
      );
    });

    test('blend, collapse, facets and total: ranks and facets over the matches, total and page over what the collapse keeps', async function (assert) {
      let matches = ITEMS.filter((r) => r.price <= 70);
      let scores = fuse(matches, SCORE_AND_STOCK);
      let kept = collapse(sorted(matches, byFused(scores)));
      let page = pageOf(kept, 2);
      assert.strictEqual(matches.length, 9);
      assert.strictEqual(kept.length, 4);
      for (let mode of totalModes) {
        await inEveryForm(
          {
            type: T,
            filter: { range: { price: { lte: 70 } } },
            sort: [scoreAndStock],
            collapse: 'group',
            facets: [{ by: 'color' }],
            page: paged(2, mode),
          },
          undefined,
          (got, form) => {
            let at = `${form}, total ${mode ?? 'unnamed'}`;
            assert.deepEqual(got.names, names(page.map((k) => k.row)), at);
            assert.strictEqual(
              got.meta.page.total,
              kept.length,
              `${at}: total`,
            );
            assert.true(got.meta.page.hasMore, `${at}: hasMore`);
            assert.deepEqual(
              countsOf(got, 'color'),
              countBy(matches, (r) => r.color),
              `${at}: facet`,
            );
            for (let [i, row] of got.rows.entries()) {
              close(
                assert,
                row._blendScore,
                scores.get(page[i].row.name)!,
                `${at}: ${page[i].row.name}'s score`,
              );
              assert.strictEqual(
                Number(row._collapseSize),
                page[i].size,
                `${at}: ${page[i].row.name}'s group size`,
              );
            }
          },
        );
      }
    });
  });
});

// The bulk rows' names in `n` order: 00001 … 01005.
function bulkNames(): string[] {
  return Array.from({ length: BULK_ROWS }, (_, i) =>
    String(i + 1).padStart(5, '0'),
  );
}
