import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  InvalidQueryError,
  VectorSerializer,
  VirtualNetwork,
  assertQuery,
  hasVectorIndex,
  internalKeyFor,
  rri,
  setVectorSearchSettings,
  vectorStoreFor,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { lowerQuery } from '@cardstack/runtime-common/query-syntax';
import { BXL_FORMULA_FUNCTIONS } from '@cardstack/bxl/compiler';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// The edges of ranking (docs/search.md): an expression sort entry's window
// (`top`) and its
// boundary, expressions that fail or give no number, comparison sets
// (`peers.` and `stats.`), what `explain` reports, and vectors in mixed
// states under `near`.
//
// Cards are written through the real index writer, which is what copies
// their vectors into the vector table. These tests need the pgvector
// extension in the test database and fail without it.
//
// Every query is written in the documented spelling and takes the path a
// request takes: lowered with BXL's function names, checked by
// `assertQuery`, then run by the engine.
//
// Every expectation is computed here in plain JavaScript from the fixture
// rows, or written out by hand beside the rule it follows. A test whose
// comment says "pins current behavior; rule not yet decided" records what
// the engine does where docs/search.md says nothing.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const vectorRef = ref('@cardstack/base/vector', 'default');
const itemRef = ref(`${testRealm}item`, 'Item');
const partRef = ref(`${testRealm}item`, 'Part');

const text = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: stringRef,
} as const;
const number = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: numberRef,
  serializerName: 'number',
} as const;
const vector = {
  type: 'contains',
  isPrimitive: true,
  isComputed: false,
  fieldOrCard: vectorRef,
  serializerName: 'vector',
} as const;

const partDef = {
  type: 'field-def',
  codeRef: partRef,
  displayName: 'Part',
  fields: { embedding: 'vector' },
  fieldDefs: { vector },
} as unknown as Definition;

const itemDef = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: {
    name: 'text',
    group: 'facet',
    color: 'text',
    score: 'number',
    heat: 'number',
    price: 'number',
    stock: 'number',
    big: 'number',
    seq: 'number',
    flag: 'boolean',
    // opted in to look-alike lookups (rerank compare.near)
    embedding: 'neighbors',
    // a vector field that has not opted in
    sketch: 'vector',
    parts: 'parts',
  },
  fieldDefs: {
    text,
    number,
    vector,
    facet: { ...text, search: { facet: true } },
    boolean: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: booleanRef,
      serializerName: 'boolean',
    },
    neighbors: { ...vector, search: { neighbors: true } },
    parts: {
      type: 'containsMany',
      isPrimitive: false,
      isComputed: false,
      fieldOrCard: partRef,
    },
  },
} as unknown as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      for (let def of [itemDef, partDef]) {
        let defRef = def.codeRef as ResolvedCodeRef;
        if (defRef.module === codeRef.module && defRef.name === codeRef.name) {
          return def;
        }
      }
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
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
  };
  return lookup as unknown as DefinitionLookup;
}

type Doc = Record<string, any>;
type Row = Doc & { id: string };
type Corpus = Record<string, Doc>;

const rowsOf = (corpus: Corpus): Row[] =>
  Object.entries(corpus).map(([id, doc]) => ({ id, ...doc }));
const idsOf = (rows: { id: string }[]) => rows.map((r) => r.id);
const byName = (a: Row, b: Row) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

// ── The fixture for windows, expressions, comparison sets and explain ──────
//
// `score` and `heat` hold each of 1..12 once, in unrelated orders. `price`
// holds each of 10, 20, .. 110 once and is missing on `l`, so the priced
// cards number 11 and a percent rank among them is a whole number of tenths.
// `stock` is 0 on two cards and missing on two more. `big` is on one card.
const items: Corpus = {
  a: {
    name: 'a',
    group: 'x',
    color: 'red',
    score: 7,
    heat: 3,
    price: 40,
    stock: 4,
    flag: true,
  },
  b: {
    name: 'b',
    group: 'x',
    color: 'blue',
    score: 3,
    heat: 11,
    price: 10,
    stock: 0,
    flag: false,
  },
  c: {
    name: 'c',
    group: 'x',
    color: 'green',
    score: 11,
    heat: 6,
    price: 90,
    stock: 2,
    big: 1e200,
  },
  d: { name: 'd', group: 'x', score: 1, heat: 9, price: 30, flag: true },
  e: { name: 'e', group: 'x', score: 9, heat: 1, price: 70, stock: 8 },
  f: { name: 'f', group: 'y', score: 5, heat: 12, price: 20, stock: 5 },
  g: { name: 'g', group: 'y', score: 12, heat: 4, price: 110, stock: 1 },
  h: { name: 'h', group: 'y', score: 2, heat: 8, price: 60, stock: 0 },
  i: { name: 'i', group: 'y', score: 8, heat: 2, price: 50, stock: 10 },
  j: { name: 'j', group: 'y', score: 6, heat: 10, price: 100 },
  k: { name: 'k', score: 10, heat: 7, price: 80, stock: 20 },
  l: { name: 'l', score: 4, heat: 5, stock: 16 },
};
const itemRows = rowsOf(items);
const byScoreDesc = [...itemRows].sort((a, b) => b.score - a.score);

// ── The fixture for vectors ────────────────────────────────────────────────
//
// Unit vectors in a plane, named by their angle from the x axis. The angles
// between any two differ (30, 45, 75, 95, 140, 170 degrees), so no two cards
// are equally similar to a third. `price` is a power of two, so a sum of
// prices names the exact set of cards it was taken over.
const SPACE = 'edge-model@1 test 3';
const declared = {
  _vectorFields: {
    embedding: { space: SPACE, list: false, computed: false },
    'parts.embedding': { space: SPACE, list: true, computed: false },
  },
};
const { encodeVector, queryableValue } = VectorSerializer;
// float32, so the stored components are the ones the oracle reads
const vec = (components: number[]) =>
  queryableValue(encodeVector(components, { encoding: 'float32' }));
const atAngle = (degrees: number) => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
  0,
];
const xAxis = [1, 0, 0];
const angles: Record<string, number | undefined> = {
  v0: 0,
  v30: 30,
  v75: 75,
  v170: 170,
  vNone: undefined,
};
const vectors: Corpus = Object.fromEntries(
  Object.entries(angles).map(([name, angle], index) => [
    name,
    {
      name,
      group: index % 2 === 0 ? 'x' : 'y',
      // unrelated to the order of the angles
      score: [3, 1, 5, 2, 4][index],
      heat: [5, 2, 4, 6, 1][index],
      price: 2 ** index,
      ...(angle === undefined ? {} : { embedding: vec(atAngle(angle)) }),
      ...declared,
    },
  ]),
);
const vectorRows = rowsOf(vectors);

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}
// A fixture card's similarity to a target, null when it holds no vector.
const similarityTo = (target: number[]) => (row: Row) =>
  angles[row.id] === undefined
    ? null
    : cosine(atAngle(angles[row.id]!), target);

// ── Oracles ────────────────────────────────────────────────────────────────

type Value = (row: Row) => number | null;

// Rows ordered by a value, best first: those with a number by the number
// (highest first unless `asc`), ties in the order given; then the rows with
// no number, in the order given.
function ordered(
  rows: Row[],
  value: Value,
  direction: 'asc' | 'desc' = 'desc',
): Row[] {
  let sign = direction === 'asc' ? 1 : -1;
  let valued = rows
    .filter((r) => value(r) != null)
    .sort((a, b) => (value(a)! - value(b)!) * sign);
  return [...valued, ...rows.filter((r) => value(r) == null)];
}

// A window (an expression sort entry with `top`): the first `top` rows of
// the order the rest of the sort gives, re-ordered by the value, then the
// rows after the window in that order.
function reranked(
  base: Row[],
  top: number,
  value: Value,
  direction: 'asc' | 'desc' = 'desc',
): Row[] {
  return [...ordered(base.slice(0, top), value, direction), ...base.slice(top)];
}

interface SignalSpec {
  // the name `explain` gives the signal
  name: string;
  weight?: number;
  direction?: 'asc' | 'desc';
  // the card's value for the signal, null when it has none; for a boost, 1
  // for a card its filter admits
  value: Value;
}

// Reciprocal rank fusion as docs/search.md states it: each card scores
// sum(weight / (k + rank)) over the signals it has a value for, each signal
// ranked over every row, best first (highest first unless `asc`; a negative
// weight ranks the other way around with the weight's size). Cards with the
// same value share a rank.
function fuse(rows: Row[], signals: SignalSpec[], k = 60) {
  let ranks = signals.map((s) => {
    let highestFirst = (s.direction ?? 'desc') === 'desc';
    if ((s.weight ?? 1) < 0) highestFirst = !highestFirst;
    let valued = rows
      .map((r) => ({ id: r.id, v: s.value(r) }))
      .filter((x): x is { id: string; v: number } => x.v != null);
    return new Map(
      valued.map((x) => [
        x.id,
        1 + valued.filter((y) => (highestFirst ? y.v > x.v : y.v < x.v)).length,
      ]),
    );
  });
  return new Map(
    rows.map((row) => {
      let parts = signals.map((s, j) => {
        let weight = s.weight ?? 1;
        let rank = ranks[j].get(row.id) ?? null;
        return {
          signal: s.name,
          weight,
          ...(weight < 0 ? { inverted: true } : {}),
          value: s.value(row),
          rank,
          contribution: rank == null ? 0 : Math.abs(weight) / (k + rank),
        };
      });
      return [
        row.id,
        {
          score: parts.reduce((sum, p) => sum + p.contribution, 0),
          k,
          signals: parts,
        },
      ];
    }),
  );
}

// Numbers rounded so a float computed two ways compares equal.
function rounded<T>(value: T, digits = 9): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === 'number' ? Number(v.toFixed(digits)) : v,
    ),
  );
}

// The aggregates `stats.<field>` offers, over a list of numbers. The
// percentiles interpolate linearly between the two nearest values (Excel's
// PERCENTILE.INC) and `stdev` is the sample standard deviation (Excel's
// STDEV.S).
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const percentile = (xs: number[], p: number) => {
  let sorted = [...xs].sort((a, b) => a - b);
  let h = (sorted.length - 1) * p;
  let lo = Math.floor(h);
  let hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};
const aggregates: Record<string, (xs: number[]) => number> = {
  count: (xs) => xs.length,
  sum,
  avg: (xs) => sum(xs) / xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  median: (xs) => percentile(xs, 0.5),
  p10: (xs) => percentile(xs, 0.1),
  p25: (xs) => percentile(xs, 0.25),
  p75: (xs) => percentile(xs, 0.75),
  p90: (xs) => percentile(xs, 0.9),
  stdev: (xs) => {
    let mean = sum(xs) / xs.length;
    return Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / (xs.length - 1));
  },
};
const pricesOf = (rows: Row[]) =>
  rows.map((r) => r.price).filter((p): p is number => typeof p === 'number');
// Excel's PERCENTRANK.INC for a value that is in the list: the share of the
// other values below it. Outside the list's range it is #N/A, no number.
const percentRank = (xs: number[], x: number | undefined) =>
  x === undefined || !xs.includes(x)
    ? null
    : xs.filter((y) => y < x).length / (xs.length - 1);

// The refusal codes docs/search.md lists.
const DOCUMENTED_CODES = [
  'unknown-key',
  'unknown-field',
  'invalid-value',
  'missing-member',
  'conflicting-members',
  'limit-exceeded',
  'invalid-nesting',
  'invalid-type',
  'needs-type',
  'sort-needs-type',
  'needs-declaration',
  'needs-postgres',
  'matches-required',
  'engine-only',
  'invalid-expression',
  'expression-placement',
  'expression-unsupported',
  'unknown-function',
  'unknown-binding',
  'binding-kind',
  'vector-space-mismatch',
  'policy-linked-from',
  'invalid-page',
  'invalid-json',
  'invalid-filter',
  'not-selectable',
  'select-excludes-fields',
];

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let engine: IndexQueryEngine;
  let virtualNetwork: VirtualNetwork;
  let itemKey: string;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    itemKey = internalKeyFor(itemRef, undefined, virtualNetwork);
    setVectorSearchSettings();
    if (!(await hasVectorIndex(adapter))) {
      throw new Error(
        'these tests need the pgvector extension in the test database, and it is not installed',
      );
    }
  });

  hooks.afterEach(async function () {
    setVectorSearchSettings();
    await closeTestPgAdapter(adapter);
  });

  const url = (id: string, realm = testRealm) => `${realm}Item/${id}.json`;

  async function index(corpus: Corpus) {
    let realm = testRealm;
    let batch = await indexWriter.createBatch(
      new URL(realm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let [id, searchData] of Object.entries(corpus)) {
      let cardURL = new URL(url(id, realm));
      await batch.updateEntry(cardURL, {
        type: 'instance',
        resource: {
          id: rri(cardURL.href),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: { module: rri(itemRef.module), name: 'Item' },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData,
        deps: new Set(),
        displayNames: ['Item'],
        types: [itemKey],
        isolatedHtml: `<div>${id}</div>`,
      });
    }
    await batch.done();
  }

  const numberOrNull = (v: unknown) => (v == null ? null : Number(v));

  // Runs a query written in the documented spelling the way a request does.
  async function run(query: Record<string, any>) {
    let lowered = lowerQuery(query, { knownFunctions: BXL_FORMULA_FUNCTIONS });
    assertQuery(lowered.query);
    let { results, meta } = await engine.search(
      new URL(testRealm),
      lowered.query as Query,
      {},
      { kind: 'renderSet' },
    );
    let rows = results.map((r: any) => ({
      id: String(r.url).replace(`${testRealm}Item/`, '').replace('.json', ''),
      // whether the row carries a rerank value at all, then the value
      hasRerank: '_window' in r,
      rerank: numberOrNull(r._window),
      expression: numberOrNull(r._expression),
      blend: numberOrNull(r._blendScore),
      similarity: numberOrNull(r._nearSimilarity),
      explain: r._explain as
        | { score: number; k: number; signals: any[] }
        | undefined,
    }));
    return { rows, ids: idsOf(rows), meta: meta as Record<string, any> };
  }

  type Ran = Awaited<ReturnType<typeof run>>;
  type Outcome =
    | ({ kind: 'rows' } & Ran)
    | { kind: 'refused'; code: string; message: string }
    | { kind: 'raw'; message: string };

  // A query's outcome: its rows, a coded refusal, or (never acceptable) an
  // error that is not a refusal, such as one the database raised.
  async function attempt(query: Record<string, any>): Promise<Outcome> {
    try {
      return { kind: 'rows', ...(await run(query)) };
    } catch (e: any) {
      if (e instanceof InvalidQueryError) {
        return { kind: 'refused', code: String(e.code), message: e.message };
      }
      return { kind: 'raw', message: String(e?.message ?? e) };
    }
  }

  function assertRefused(
    assert: Assert,
    outcome: Outcome,
    codes: string | string[],
    what: string,
  ) {
    let expected = Array.isArray(codes) ? codes : [codes];
    assert.true(
      outcome.kind === 'refused' && expected.includes(outcome.code),
      `${what}: refused with ${expected.join(' or ')} (got ${
        outcome.kind === 'refused'
          ? `${outcome.code}: ${outcome.message}`
          : outcome.kind === 'raw'
            ? `an error that is no refusal: ${outcome.message}`
            : `rows ${outcome.ids.join(' ')}`
      })`,
    );
  }

  // The query answered with every row of `expected`, in that order.
  function assertOrder(
    assert: Assert,
    outcome: Outcome,
    expected: Row[],
    what: string,
  ): Ran | undefined {
    if (outcome.kind !== 'rows') {
      assert.true(
        false,
        `${what}: expected rows, got ${
          outcome.kind === 'raw'
            ? `an error that is no refusal: ${outcome.message}`
            : `a refusal (${outcome.code}: ${outcome.message})`
        }`,
      );
      return undefined;
    }
    assert.deepEqual(
      [...outcome.ids].sort(),
      idsOf(expected).sort(),
      `${what}: every matching row is returned, once`,
    );
    assert.deepEqual(outcome.ids, idsOf(expected), `${what}: in order`);
    return outcome;
  }

  // ── 1. The rerank window ─────────────────────────────────────────────────

  module('expression window (top)', function () {
    // The base order (the sort after the window entry) is by score, highest
    // first. The window's expression reads `heat`, which orders the cards
    // another way, and gives every card a different number.
    const heatValue: Value = (r) => r.heat * 2 + 1;
    const windowQuery = (window: Doc, extra: Doc = {}) => ({
      type: itemRef,
      sort: [
        { expression: 'heat * 2 + 1', top: 100, ...window },
        { by: 'score', direction: 'desc' },
      ],
      ...extra,
    });

    test('the first `top` rows are the same rows, re-ordered by the expression', async function (assert) {
      await index(items);
      let { rows } = await run(windowQuery({ top: 5 }));
      let expected = reranked(byScoreDesc, 5, heatValue).slice(0, 5);
      assert.deepEqual(
        rows.slice(0, 5).map((r) => [r.id, r.rerank]),
        expected.map((r) => [r.id, heatValue(r)]),
        'the five highest scores, by heat * 2 + 1, each with its value',
      );
    });

    test('the rows after the window keep the base order and carry no window value', async function (assert) {
      await index(items);
      let { rows } = await run(windowQuery({ top: 5 }, { page: { size: 12 } }));
      assert.deepEqual(
        rows.slice(5).map((r) => r.id),
        idsOf(byScoreDesc.slice(5)),
        'the seven lower scores, still by score',
      );
      assert.deepEqual(
        rows.slice(5).filter((r) => r.hasRerank),
        [],
        'none of them carries _window',
      );
    });

    // A search with no `page` returns every match; a window re-orders the top
    // of a result, it does not shorten it.
    test('a query with no page still returns every match when its window is smaller', async function (assert) {
      await index(items);
      let outcome = await attempt(windowQuery({ top: 5 }));
      assertOrder(
        assert,
        outcome,
        reranked(byScoreDesc, 5, heatValue),
        'twelve matches, top: 5, no page',
      );
    });

    test('a window smaller than the result is reported as truncated', async function (assert) {
      await index(items);
      let { meta } = await run(windowQuery({ top: 5 }));
      assert.strictEqual(meta.window?.rows, 5, 'the window is `top` rows');
      assert.strictEqual(meta.window?.scored, 5, 'each got a number');
      assert.true(meta.window?.truncated, 'more rows matched than the window');
      assert.strictEqual(meta.page?.total, 12, 'the total counts every match');
    });

    for (let size of [2, 3, 4, 7]) {
      test(`pages of ${size} laid end to end across the window boundary equal the unpaged result`, async function (assert) {
        await index(items);
        let expected = idsOf(reranked(byScoreDesc, 5, heatValue));
        let seen: string[] = [];
        for (let number = 0; number * size < expected.length; number++) {
          let page = await run(
            windowQuery({ top: 5 }, { page: { number, size } }),
          );
          assert.deepEqual(
            page.ids,
            expected.slice(number * size, (number + 1) * size),
            `page ${number}`,
          );
          seen.push(...page.ids);
        }
        assert.deepEqual(seen, expected, 'no row twice, none left out');
      });
    }

    test('a `top` equal to the number of matches re-ranks every row', async function (assert) {
      await index(items);
      let { ids, meta } = await run(windowQuery({ top: 12 }));
      assert.deepEqual(ids, idsOf(ordered(byScoreDesc, heatValue)));
      assert.strictEqual(meta.window?.rows, 12);
      assert.notOk(meta.window?.truncated, 'nothing lies past the window');
    });

    test('a `top` larger than the number of matches re-ranks every row and reports the rows it had', async function (assert) {
      await index(items);
      let { ids, meta } = await run(windowQuery({ top: 50 }));
      assert.deepEqual(ids, idsOf(ordered(byScoreDesc, heatValue)));
      assert.strictEqual(meta.window?.rows, 12, 'twelve rows, not fifty');
      assert.notOk(meta.window?.truncated);
    });

    test('a `top` of 1 leaves the base order as it was', async function (assert) {
      await index(items);
      let { rows } = await run(windowQuery({ top: 1 }, { page: { size: 12 } }));
      assert.deepEqual(idsOf(rows), idsOf(byScoreDesc));
      assert.deepEqual(
        rows.filter((r) => r.hasRerank).map((r) => [r.id, r.rerank]),
        [[byScoreDesc[0].id, heatValue(byScoreDesc[0])]],
        'only the first row carries a window value',
      );
    });

    for (let [what, top] of [
      ['just past the maximum', 501],
      ['zero', 0],
      ['not a whole number', 2.5],
      ['a string', '5'],
    ] as const) {
      test(`a \`top\` that is ${what} is refused with invalid-value`, async function (assert) {
        await index(items);
        assertRefused(
          assert,
          await attempt(windowQuery({ top })),
          'invalid-value',
          `top: ${JSON.stringify(top)}`,
        );
      });
    }

    // decided (deterministic): rows that tie on the window's value keep the
    // base order, in either direction, as the sort entries after it break
    // its ties.
    for (let direction of ['desc', 'asc'] as const) {
      test(`rows that tie on the window value keep the base order (${direction})`, async function (assert) {
        await index(items);
        let { ids, meta } = await run(
          windowQuery({ expression: '1', direction }),
        );
        assert.deepEqual(ids, idsOf(byScoreDesc));
        assert.strictEqual(meta.window?.scored, 12, 'every row got the value');
      });
    }

    test('a row whose window expression gives no number keeps its place after the rows that have one', async function (assert) {
      await index(items);
      // `stock` alone is blank for d and j, which hold none.
      let stockValue: Value = (r) => r.stock ?? null;
      for (let direction of ['desc', 'asc'] as const) {
        let { ids, meta } = await run(
          windowQuery({ expression: 'stock', direction }),
        );
        assert.deepEqual(
          ids,
          idsOf(ordered(byScoreDesc, stockValue, direction)),
          `${direction}: ten rows by stock, then j and d as the query had them`,
        );
        assert.strictEqual(meta.window?.scored, 10, 'ten rows got a number');
      }
    });

    module('over 510 rows', function () {
      // `seq` is the query's order; `heat` holds 510 different numbers in
      // another order (37 and 511 share no factor).
      const many: Corpus = Object.fromEntries(
        Array.from({ length: 510 }, (_, seq) => [
          `n${seq}`,
          { name: `n${seq}`, seq, heat: (seq * 37) % 511 },
        ]),
      );
      const bySeq = rowsOf(many);
      const heat: Value = (r) => r.heat;

      test('with `compare` and no `top`, the window is the first 100 rows', async function (assert) {
        await index(many);
        let { ids, meta } = await run({
          type: itemRef,
          sort: [{ expression: 'heat', compare: {} }, { by: 'seq' }],
          page: { size: 510 },
        });
        assert.deepEqual(ids, idsOf(reranked(bySeq, 100, heat)));
        assert.strictEqual(meta.window?.rows, 100);
      });

      test('with `top: 500`, the window re-orders the first 500 rows and leaves the last ten', async function (assert) {
        await index(many);
        let { ids, meta } = await run({
          type: itemRef,
          sort: [{ expression: 'heat', top: 500 }, { by: 'seq' }],
          page: { size: 510 },
        });
        assert.deepEqual(ids, idsOf(reranked(bySeq, 500, heat)));
        assert.strictEqual(meta.window?.rows, 500);
        assert.true(meta.window?.truncated);
      });

      test('without `top` or `compare`, an expression orders every match, past 500', async function (assert) {
        await index(many);
        let { ids, meta } = await run({
          type: itemRef,
          sort: [{ expression: 'heat' }, { by: 'seq' }],
          page: { size: 510 },
        });
        assert.deepEqual(ids, idsOf(ordered(bySeq, heat)));
        assert.strictEqual(meta.window, undefined, 'no window');
        assert.strictEqual(meta.page?.total, 510);
      });
    });

    test('a window entry that is not the first sort entry is refused with expression-placement', async function (assert) {
      await index(items);
      assertRefused(
        assert,
        await attempt({
          type: itemRef,
          sort: [{ by: 'score' }, { expression: 'heat', top: 5 }],
        }),
        'expression-placement',
        'an expression with top as the second entry',
      );
    });

    test('top-level `rerank` is refused with unknown-key, naming the sort entry to write', async function (assert) {
      await index(items);
      let outcome = await attempt({
        type: itemRef,
        sort: [{ by: 'score' }],
        rerank: { expression: 'heat', top: 5 },
      });
      assertRefused(assert, outcome, 'unknown-key', 'rerank');
      let message = outcome.kind === 'refused' ? outcome.message : '';
      assert.true(
        /sort entry/.test(message),
        'the message says re-ranking is a sort entry',
      );
    });
  });

  // ── 2. Expressions that fail ─────────────────────────────────────────────

  module('expression failures', function () {
    // Each case runs as an `expression` sort (with `name` as the next sort
    // key) and as a window's expression (over a base order by `name`). In
    // both, docs/search.md gives one order: the rows with a number by the
    // number, ties by name, then the rows with none (blank, an error, no
    // number) by name. Whatever the expression, the query must answer with
    // every row or refuse with a code.
    const byNameRows = [...itemRows].sort(byName);
    const forms = {
      'expression sort': (expression: unknown, direction: string) => ({
        type: itemRef,
        sort: [{ expression, direction }, { by: 'name' }],
      }),
      window: (expression: unknown, direction: string) => ({
        type: itemRef,
        sort: [{ expression, direction, top: 100 }, { by: 'name' }],
      }),
    };

    let nested = 'score / stock';
    for (let depth = 0; depth < 40; depth++) {
      nested = `IFERROR(${nested}, score)`;
    }
    const exp = (x: number) =>
      Number.isFinite(Math.exp(x)) ? Math.exp(x) : null;

    const ranked: { rule: string; expression: string; value: Value }[] = [
      {
        // A missing field is 0 in arithmetic, so d and j divide by zero too.
        rule: 'a division by zero is an error, and the row ranks last',
        expression: 'score / stock',
        value: (r) => (r.stock ? r.score / r.stock : null),
      },
      {
        rule: 'a field with no value is 0 in arithmetic',
        expression: 'price - stock',
        value: (r) => (r.price ?? 0) - (r.stock ?? 0),
      },
      {
        rule: 'an expression that ends blank ranks the row last',
        expression: 'stock',
        value: (r) => r.stock ?? null,
      },
      {
        rule: 'IFERROR catches the error and the row ranks by its fallback',
        expression: 'IFERROR(score / stock, -1)',
        value: (r) => (r.stock ? r.score / r.stock : -1),
      },
      {
        rule: 'the log of a non-positive number is an error, and the row ranks last',
        expression: 'LN(stock)',
        value: (r) => (r.stock > 0 ? Math.log(r.stock) : null),
      },
      {
        rule: 'the root of a negative number is an error, and the row ranks last',
        expression: 'SQRT(score - 6)',
        value: (r) => (r.score >= 6 ? Math.sqrt(r.score - 6) : null),
      },
      {
        rule: 'an expression that is an error on every row returns every row',
        expression: '0 / 0',
        value: () => null,
      },
      {
        // 1e200 squared is past a double; the other cards hold no `big`,
        // which is 0, and 0 squared is 0.
        rule: 'a value too large for a number on one row ranks that row last',
        expression: 'POWER(big, 2)',
        value: (r) => (r.big ? null : 0),
      },
      {
        // e^(score * 100) is past a double from score 8 up.
        rule: 'a value too large for a number on some rows ranks those rows last',
        expression: 'EXP(score * 100)',
        value: (r) => exp(r.score * 100),
      },
      {
        // 90 additions (181 parts): within the 200 parts SQL takes.
        rule: 'a long expression within the size limit ranks every row',
        expression: 'score' + ' + 1'.repeat(90),
        value: (r) => r.score + 90,
      },
      {
        // IFERROR nested 40 deep: cheap to write, and each level reads its
        // argument more than once where it is lowered to SQL.
        rule: 'a deeply nested expression ranks every row',
        expression: nested,
        value: (r) => (r.stock ? r.score / r.stock : r.score),
      },
    ];

    // pins current behavior; rule not yet decided: docs/search.md says a
    // card whose expression "ends blank or an error" ranks last, and does
    // not say what a result that is text or true/false ranks as. Today text
    // is no number (the row ranks with the blank ones) and true and false
    // are 1 and 0.
    const pinned: { rule: string; expression: string; value: Value }[] = [
      {
        rule: 'a text field as the result gives no row a number',
        expression: 'color',
        value: () => null,
      },
      {
        rule: 'a comparison as the result ranks true as 1 and false as 0',
        expression: 'score > 6',
        value: (r) => (r.score > 6 ? 1 : 0),
      },
      {
        rule: 'a true/false field as the result ranks true as 1, false as 0 and a missing one last',
        expression: 'flag',
        value: (r) => (r.flag === undefined ? null : r.flag ? 1 : 0),
      },
    ];

    // decided (every expression runs in SQL): what SQL cannot hold or
    // compute is refused, where a thread used to give rows no number.
    const refusedRules: { rule: string; expression: string; code: string }[] = [
      {
        // Postgres raises where a double overflows in arithmetic
        rule: 'a product too large for a number is refused with limit-exceeded',
        expression: 'score * 1e308 * 100',
        code: 'limit-exceeded',
      },
      {
        // 450 additions: past the 200 parts the score profile takes,
        // though within the 2,000 characters an expression may have
        rule: 'an expression past the size SQL takes is refused with limit-exceeded',
        expression: 'score' + ' + 1'.repeat(450),
        code: 'limit-exceeded',
      },
      {
        rule: 'a text result is refused with expression-unsupported',
        expression: 'IF(score > 6, "high", "low")',
        code: 'expression-unsupported',
      },
      {
        rule: 'a number written past what a number can hold is refused with expression-unsupported',
        expression: '1e999',
        code: 'expression-unsupported',
      },
    ];

    for (let [form, queryOf] of Object.entries(forms)) {
      for (let { rule, expression, value } of ranked) {
        test(`${form}: ${rule}`, async function (assert) {
          await index(items);
          for (let direction of ['desc', 'asc'] as const) {
            assertOrder(
              assert,
              await attempt(queryOf(expression, direction)),
              ordered(byNameRows, value, direction),
              direction,
            );
          }
        });
      }
      for (let { rule, expression, value } of pinned) {
        test(`${form}: ${rule}`, async function (assert) {
          await index(items);
          for (let direction of ['desc', 'asc'] as const) {
            assertOrder(
              assert,
              await attempt(queryOf(expression, direction)),
              ordered(byNameRows, value, direction),
              direction,
            );
          }
        });
      }

      for (let { rule, expression, code } of refusedRules) {
        test(`${form}: ${rule}`, async function (assert) {
          await index(items);
          assertRefused(
            assert,
            await attempt(queryOf(expression, 'desc')),
            code,
            expression,
          );
        });
      }

      test(`${form}: a function BXL does not know is refused with unknown-function`, async function (assert) {
        await index(items);
        assertRefused(
          assert,
          await attempt(queryOf('NOSUCHFUNCTION(score)', 'desc')),
          'unknown-function',
          'NOSUCHFUNCTION(score)',
        );
      });

      // docs/search.md lists `unknown-field` as the refusal for "a field the
      // type does not have", and does not exempt an expression. A misspelled
      // field that read as blank would rank every row at 0 without a word.
      test(`${form}: a field the type does not have is refused with unknown-field`, async function (assert) {
        await index(items);
        assertRefused(
          assert,
          await attempt(queryOf('nosuchfield * 2', 'desc')),
          'unknown-field',
          'nosuchfield * 2',
        );
      });

      for (let broken of [
        'score +* (',
        'IF(',
        'score + ',
        ')score',
        'score; heat',
        "LEN('single')",
      ]) {
        test(`${form}: the malformed expression ${JSON.stringify(broken)} is refused with invalid-expression`, async function (assert) {
          await index(items);
          assertRefused(
            assert,
            await attempt(queryOf(broken, 'desc')),
            'invalid-expression',
            broken,
          );
        });
      }

      // pins current behavior; rule not yet decided: docs/search.md gives an
      // expression no length limit. Today one past 2,000 characters is
      // refused, with `invalid-value`.
      test(`${form}: an expression past 2,000 characters is refused with a code`, async function (assert) {
        await index(items);
        let long = 'score' + ' + 1'.repeat(750);
        let outcome = await attempt(queryOf(long, 'desc'));
        assertRefused(assert, outcome, DOCUMENTED_CODES, '3,005 characters');
        assertRefused(assert, outcome, 'invalid-value', '3,005 characters');
      });
    }

    for (let [what, expression] of [
      ['an empty string', ''],
      ['only spaces', '   '],
      ['a number', 42],
      ['null', null],
      ['a list', ['score']],
    ] as const) {
      test(`an expression sort whose expression is ${what} is refused with invalid-expression`, async function (assert) {
        await index(items);
        assertRefused(
          assert,
          await attempt(forms['expression sort'](expression, 'desc')),
          'invalid-expression',
          JSON.stringify(expression),
        );
      });

      // decided: a window's expression is refused as an expression sort's
      // is, with `invalid-expression` (docs/search.md, Refusals: "an
      // expression that is not a string")
      test(`a window whose expression is ${what} is refused with invalid-expression`, async function (assert) {
        await index(items);
        assertRefused(
          assert,
          await attempt(forms.window(expression, 'desc')),
          'invalid-expression',
          JSON.stringify(expression),
        );
      });
    }

    test('an expression sort carries its value on each row', async function (assert) {
      await index(items);
      let { rows, meta } = await run(
        forms['expression sort']('score / stock', 'desc'),
      );
      assert.strictEqual(meta.expression, undefined, 'no placement report');
      assert.deepEqual(
        rounded(Object.fromEntries(rows.map((r) => [r.id, r.expression]))),
        rounded(
          Object.fromEntries(
            itemRows.map((r) => [r.id, r.stock ? r.score / r.stock : null]),
          ),
        ),
        'meta._expression is the value, and nothing for a row with an error',
      );
    });

    // What SQL cannot compute is refused, whatever its place in the query:
    // there is no other place an expression runs.
    for (let expression of ['LET(x, score, x * 2)', 'STDEV_S(score)']) {
      for (let [form, queryOf] of Object.entries(forms)) {
        test(`${form}: ${expression} is refused with expression-unsupported`, async function (assert) {
          await index(items);
          assertRefused(
            assert,
            await attempt(queryOf(expression, 'desc')),
            'expression-unsupported',
            expression,
          );
        });
      }
    }

    test('peers. and stats. outside a window are refused with expression-placement', async function (assert) {
      await index(items);
      assertRefused(
        assert,
        await attempt({
          type: itemRef,
          sort: [{ expression: 'price / stats.price.median' }],
        }),
        'expression-placement',
        'stats. in an expression sort with no top',
      );
    });

    test('a window in a blend signal is refused with invalid-nesting', async function (assert) {
      await index(items);
      for (let extra of [{ top: 5 }, { compare: { by: 'group' } }]) {
        assertRefused(
          assert,
          await attempt({
            type: itemRef,
            sort: [
              { blend: [{ by: 'score' }, { expression: 'heat', ...extra }] },
            ],
          }),
          'invalid-nesting',
          JSON.stringify(extra),
        );
      }
    });
  });

  // ── 3. Comparison sets: peers and stats ──────────────────────────────────

  module('peers and stats', function () {
    const byNameRows = [...itemRows].sort(byName);
    const groupX = byNameRows.filter((r) => r.group === 'x');
    const groupY = byNameRows.filter((r) => r.group === 'y');
    const comparing = (window: Doc, extra: Doc = {}) => ({
      type: itemRef,
      sort: [{ top: 100, ...window }, { by: 'name' }],
      ...extra,
    });
    const valuesById = (rows: Ran['rows']) =>
      rounded(Object.fromEntries(rows.map((r) => [r.id, r.rerank])));

    test('the comparison set is every match of the query, not the window', async function (assert) {
      await index(items);
      let { rows } = await run(
        comparing({ expression: 'stats.price.count', top: 3 }),
      );
      assert.deepEqual(
        rows.slice(0, 3).map((r) => r.rerank),
        [11, 11, 11],
        'each of the three window rows sees all 11 priced matches',
      );
    });

    test('PERCENTRANK_INC over peers places each row among every match', async function (assert) {
      await index(items);
      let prices = pricesOf(itemRows);
      let value: Value = (r) => percentRank(prices, r.price);
      let { rows, ids } = await run(
        comparing({ expression: 'PERCENTRANK_INC(peers.price, price)' }),
      );
      assert.deepEqual(
        valuesById(rows),
        rounded(Object.fromEntries(itemRows.map((r) => [r.id, value(r)]))),
        'each priced row gets its share of lower prices; l, with no price, gets no number',
      );
      assert.deepEqual(ids, idsOf(ordered(byNameRows, value)));
    });

    test('a filter that narrows the matches narrows the peers', async function (assert) {
      await index(items);
      let prices = pricesOf(groupX);
      let { rows } = await run(
        comparing(
          { expression: 'PERCENTRANK_INC(peers.price, price)' },
          { filter: { eq: { group: 'x' } } },
        ),
      );
      assert.deepEqual(
        valuesById(rows),
        rounded(
          Object.fromEntries(
            groupX.map((r) => [r.id, percentRank(prices, r.price)]),
          ),
        ),
        'each x row is placed among the five x prices alone',
      );
    });

    test('`compare.filter` names the comparison set in place of the matches', async function (assert) {
      await index(items);
      let { rows } = await run(
        comparing(
          {
            expression: 'stats.price.max',
            compare: { filter: { on: itemRef, eq: { group: 'y' } } },
          },
          { filter: { eq: { group: 'x' } } },
        ),
      );
      assert.deepEqual(
        valuesById(rows),
        Object.fromEntries(
          groupX.map((r) => [r.id, Math.max(...pricesOf(groupY))]),
        ),
        'each x row reads the highest y price',
      );
    });

    test("`compare.by` narrows the set to the rows sharing the row's value", async function (assert) {
      await index(items);
      let { rows } = await run(
        comparing({
          expression: 'stats.price.sum',
          compare: { by: 'group' },
        }),
      );
      let grouped = [...groupX, ...groupY];
      let got = valuesById(rows);
      assert.deepEqual(
        Object.fromEntries(grouped.map((r) => [r.id, got[r.id]])),
        Object.fromEntries(
          grouped.map((r) => [
            r.id,
            sum(pricesOf(r.group === 'x' ? groupX : groupY)),
          ]),
        ),
        'each row reads the prices of its own group',
      );
    });

    // pins current behavior; rule not yet decided: docs/search.md says
    // `compare.by` narrows the set to "the rows sharing the row's value" and
    // does not say what a row with no value there is compared with. Today
    // the rows with no value are each other's set.
    test('rows with no value at `compare.by` are compared with each other', async function (assert) {
      await index(items);
      let { rows } = await run(
        comparing({
          expression: 'stats.score.sum',
          compare: { by: 'group' },
        }),
      );
      let ungrouped = byNameRows.filter((r) => r.group === undefined);
      let got = valuesById(rows);
      assert.deepEqual(
        Object.fromEntries(ungrouped.map((r) => [r.id, got[r.id]])),
        Object.fromEntries(
          ungrouped.map((r) => [r.id, sum(ungrouped.map((u) => u.score))]),
        ),
        'k and l read the scores of k and l',
      );
    });

    test('a row with no value for a field is left out of that field in peers and stats', async function (assert) {
      await index(items);
      let { rows } = await run(
        comparing({
          expression: 'COUNT(peers.price) * 100 + stats.price.count',
        }),
      );
      assert.deepEqual(
        [...new Set(rows.map((r) => r.rerank))],
        [1111],
        '11 of the 12 matches hold a price, in peers and in stats alike',
      );
    });

    // The percentile method and the kind of standard deviation are not in
    // docs/search.md; the expected values follow Excel (PERCENTILE.INC,
    // STDEV.S), as the peer functions beside them do.
    for (let [name, aggregate] of Object.entries(aggregates)) {
      test(`stats.<field>.${name} is the ${name} of the field over the comparison set`, async function (assert) {
        await index(items);
        let expected = aggregate(pricesOf(itemRows));
        let { rows } = await run(
          comparing({ expression: `stats.price.${name}` }),
        );
        assert.deepEqual(
          [...new Set(rows.map((r) => rounded(r.rerank)))],
          [rounded(expected)],
          `every row reads ${expected}`,
        );
      });
    }

    for (let [fn, aggregate] of Object.entries({
      COUNT: aggregates.count,
      SUM: aggregates.sum,
      MIN: aggregates.min,
      MAX: aggregates.max,
      AVERAGE: aggregates.avg,
      MEDIAN: aggregates.median,
    })) {
      test(`${fn}(peers.<field>) is computed over the comparison set's values`, async function (assert) {
        await index(items);
        let expected = aggregate(pricesOf(itemRows));
        let { rows } = await run(
          comparing({ expression: `${fn}(peers.price)` }),
        );
        assert.deepEqual(
          [...new Set(rows.map((r) => rounded(r.rerank)))],
          [rounded(expected)],
          `every row reads ${expected}`,
        );
      });
    }

    test("a row's price against the median of its group ranks the rows", async function (assert) {
      await index(items);
      let medianOf = (r: Row) =>
        aggregates.median(pricesOf(r.group === 'x' ? groupX : groupY));
      // A missing price is 0 in arithmetic.
      let value: Value = (r) => (r.price ?? 0) / medianOf(r);
      let grouped = [...groupX, ...groupY].sort(byName);
      assertOrder(
        assert,
        await attempt(
          comparing(
            {
              expression: 'price / stats.price.median',
              compare: { by: 'group' },
            },
            { filter: { exists: 'group' } },
          ),
        ),
        ordered(grouped, value),
        'the ten grouped rows',
      );
    });

    // The comparison functions the score profile computes in SQL, against
    // values worked out here by Excel's rules.
    const percentRankInc = (xs: number[], x: number) => {
      let sorted = [...xs].sort((a, b) => a - b);
      let n = sorted.length;
      if (n === 0 || x < sorted[0] || x > sorted[n - 1]) return null;
      if (n === 1) return 0;
      for (let i = 0; i < n; i++) {
        if (sorted[i] === x) return i / (n - 1);
        if (sorted[i] < x && x < sorted[i + 1]) {
          return (i + (x - sorted[i]) / (sorted[i + 1] - sorted[i])) / (n - 1);
        }
      }
      return null;
    };
    const prices = () => pricesOf(itemRows);
    const handComputed: { rule: string; expression: string; value: Value }[] = [
      {
        rule: 'COUNTIF counts the peers above the row with a criterion built by &',
        expression: 'COUNTIF(peers.price, ">" & price)',
        value: (r) => prices().filter((p) => p > (r.price ?? 0)).length,
      },
      {
        rule: 'COUNTIF takes a criterion written as text',
        expression: 'COUNTIF(peers.price, ">=40")',
        value: () => prices().filter((p) => p >= 40).length,
      },
      {
        rule: 'COUNTIF with a number counts the peers equal to it',
        expression: 'COUNTIF(peers.price, price)',
        value: (r) => prices().filter((p) => p === (r.price ?? 0)).length,
      },
      {
        rule: 'STANDARDIZE is the distance from the mean in standard deviations',
        expression: 'STANDARDIZE(price, stats.price.avg, stats.price.stdev)',
        value: (r) =>
          ((r.price ?? 0) - aggregates.avg(prices())) /
          aggregates.stdev(prices()),
      },
      {
        rule: 'PERCENTRANK_INC interpolates for a value between two peers, and is #N/A past them',
        expression: 'PERCENTRANK_INC(peers.price, price + 1)',
        value: (r) => percentRankInc(prices(), (r.price ?? 0) + 1),
      },
      {
        rule: 'NA() is an error: the row gets no number',
        expression: 'IF(price > 30, price, NA())',
        value: (r) => ((r.price ?? 0) > 30 ? r.price : null),
      },
      {
        rule: 'MEDIAN over peers and SUM over peers combine in one expression',
        expression: 'MEDIAN(peers.price) + SUM(peers.price) / 1000',
        value: () =>
          aggregates.median(prices()) + aggregates.sum(prices()) / 1000,
      },
    ];
    for (let { rule, expression, value } of handComputed) {
      test(rule, async function (assert) {
        await index(items);
        let { rows, ids } = await run(comparing({ expression }));
        assert.deepEqual(
          valuesById(rows),
          rounded(Object.fromEntries(itemRows.map((r) => [r.id, value(r)]))),
          "each row's value, by hand",
        );
        assert.deepEqual(ids, idsOf(ordered(byNameRows, value)), 'in order');
      });
    }

    module('look-alikes (compare.near)', function () {
      const withVector = vectorRows.filter((r) => angles[r.id] !== undefined);
      // A card's look-alikes: the other cards with a vector, nearest first.
      const lookalikes = (row: Row, k: number, minSimilarity = -1) =>
        angles[row.id] === undefined
          ? []
          : withVector
              .filter((other) => other.id !== row.id)
              .map((other) => ({
                row: other,
                similarity: similarityTo(atAngle(angles[row.id]!))(other)!,
              }))
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, k)
              .filter((n) => n.similarity >= minSimilarity);
      const nearQuery = (expression: string, compare: Doc) => ({
        type: itemRef,
        sort: [
          { expression, compare: { near: 'embedding', ...compare } },
          { by: 'name' },
        ],
      });

      test("each row's comparison set is its k nearest other cards", async function (assert) {
        await index(vectors);
        let { rows } = await run(nearQuery('SUM(peers.price)', { k: 2 }));
        let got = Object.fromEntries(rows.map((r) => [r.id, r.rerank]));
        // prices are powers of two, so the sum names the exact neighbors
        assert.deepEqual(
          Object.fromEntries(withVector.map((r) => [r.id, got[r.id]])),
          Object.fromEntries(
            withVector.map((r) => [
              r.id,
              sum(lookalikes(r, 2).map((n) => n.row.price)),
            ]),
          ),
        );
      });

      test('`minSimilarity` leaves out the look-alikes less similar than it', async function (assert) {
        await index(vectors);
        let { rows } = await run(
          nearQuery('stats.similarity.count', { k: 3, minSimilarity: 0.5 }),
        );
        let got = Object.fromEntries(rows.map((r) => [r.id, r.rerank ?? 0]));
        assert.deepEqual(
          Object.fromEntries(withVector.map((r) => [r.id, got[r.id]])),
          Object.fromEntries(
            withVector.map((r) => [r.id, lookalikes(r, 3, 0.5).length]),
          ),
          'v0 and v75 keep v30; v30 keeps both; v170 keeps none',
        );
      });

      test("`peers.similarity` holds each look-alike's similarity to the row", async function (assert) {
        await index(vectors);
        let { rows } = await run(nearQuery('MIN(peers.similarity)', { k: 2 }));
        let got = Object.fromEntries(rows.map((r) => [r.id, r.rerank]));
        assert.deepEqual(
          rounded(
            Object.fromEntries(withVector.map((r) => [r.id, got[r.id]])),
            5,
          ),
          rounded(
            Object.fromEntries(
              withVector.map((r) => [
                r.id,
                Math.min(...lookalikes(r, 2).map((n) => n.similarity)),
              ]),
            ),
            5,
          ),
          'the lower of its two nearest similarities',
        );
      });

      test('a row with no vector has no look-alikes and keeps its place after the rows with a number', async function (assert) {
        await index(vectors);
        // `stats` of an empty set are blank
        let { rows } = await run(nearQuery('stats.price.max', { k: 2 }));
        let last = rows[rows.length - 1];
        assert.deepEqual(
          [last.id, last.rerank],
          ['vNone', null],
          'the card with no vector is last, with no value',
        );
      });

      test('a vector field that has not opted in to look-alikes is refused with needs-declaration', async function (assert) {
        await index(vectors);
        assertRefused(
          assert,
          await attempt({
            type: itemRef,
            sort: [
              {
                expression: 'MAX(peers.similarity)',
                compare: { near: 'sketch' },
              },
              { by: 'name' },
            ],
          }),
          'needs-declaration',
          'compare.near: sketch',
        );
      });

      test('`compare.near` beside `compare.by` is refused with conflicting-members', async function (assert) {
        await index(vectors);
        assertRefused(
          assert,
          await attempt(nearQuery('MAX(peers.similarity)', { by: 'group' })),
          'conflicting-members',
          'near with by',
        );
      });
    });
  });

  // ── 4. explain ───────────────────────────────────────────────────────────

  module('explain', function () {
    const field =
      (name: string): Value =>
      (r) =>
        r[name] ?? null;
    // A blend over the item fixture: a field, a field ranked lowest first,
    // and a weighted field one card has no value for.
    const blend = [
      { by: 'score' },
      { by: 'heat', direction: 'asc' },
      { by: 'price', weight: 0.5 },
    ];
    const signals: SignalSpec[] = [
      { name: 'score', value: field('score') },
      { name: 'heat', direction: 'asc', value: field('heat') },
      { name: 'price', weight: 0.5, value: field('price') },
    ];
    const explained = (sort: Doc[], extra: Doc = {}) => ({
      type: itemRef,
      sort,
      explain: true,
      ...extra,
    });
    const explanations = (rows: Ran['rows'], digits = 9) =>
      rounded(Object.fromEntries(rows.map((r) => [r.id, r.explain])), digits);
    const expectedFrom = (
      fused: ReturnType<typeof fuse>,
      rows: Row[],
      digits = 9,
    ) =>
      rounded(
        Object.fromEntries(rows.map((r) => [r.id, fused.get(r.id)])),
        digits,
      );

    test('every row carries score, k and one entry per signal: signal, weight, value, rank, contribution', async function (assert) {
      await index(items);
      let { rows } = await run(explained([{ blend }]));
      assert.deepEqual(
        explanations(rows),
        expectedFrom(fuse(itemRows, signals), itemRows),
        'each rank is over all twelve matches, each contribution weight / (60 + rank)',
      );
    });

    test('the signals come in the order the blend lists them', async function (assert) {
      await index(items);
      for (let order of [
        [0, 1, 2],
        [2, 0, 1],
        [1, 2, 0],
      ]) {
        let { rows } = await run(
          explained([{ blend: order.map((i) => blend[i]) }]),
        );
        let expected = order.map((i) => signals[i].name);
        assert.deepEqual(
          [
            ...new Set(
              rows.map((r) => r.explain?.signals.map((s) => s.signal).join()),
            ),
          ],
          [expected.join()],
          `${expected.join(', ')} on every row`,
        );
      }
    });

    test("the contributions add up to the row's score, which is its _blendScore", async function (assert) {
      await index(items);
      let { rows } = await run(explained([{ blend }]));
      for (let row of rows) {
        let total = sum(row.explain!.signals.map((s) => s.contribution));
        assert.strictEqual(
          rounded(total),
          rounded(row.explain!.score),
          `${row.id}: the shares add up to score`,
        );
        assert.strictEqual(
          rounded(row.explain!.score),
          rounded(row.blend),
          `${row.id}: score is _blendScore`,
        );
      }
    });

    test('a row with no value for a signal has no rank there and gets nothing from it', async function (assert) {
      await index(items);
      let { rows } = await run(explained([{ blend }]));
      // l holds no price
      assert.deepEqual(rows.find((r) => r.id === 'l')!.explain!.signals[2], {
        signal: 'price',
        weight: 0.5,
        value: null,
        rank: null,
        contribution: 0,
      });
    });

    test('a page carries ranks over every match, not over the page', async function (assert) {
      await index(items);
      let fused = fuse(itemRows, signals);
      let { rows, meta } = await run(
        explained([{ blend }, { by: 'name' }], {
          page: { number: 1, size: 5 },
        }),
      );
      let order = [...itemRows].sort(
        (a, b) =>
          fused.get(b.id)!.score - fused.get(a.id)!.score || byName(a, b),
      );
      let page = order.slice(5, 10);
      assert.deepEqual(idsOf(rows), idsOf(page), 'the second page of five');
      assert.deepEqual(explanations(rows), expectedFrom(fused, page));
      assert.strictEqual(meta.page?.total, 12);
    });

    test('a boost is named "when": a matching row has value 1 and rank 1, another has neither', async function (assert) {
      await index(items);
      let boosted: SignalSpec[] = [
        { name: 'score', value: field('score') },
        {
          name: 'when',
          weight: 1.5,
          value: (r) => (r.group === 'x' ? 1 : null),
        },
      ];
      let { rows } = await run(
        explained([
          {
            blend: [
              { by: 'score' },
              { boost: { eq: { group: 'x' } }, weight: 1.5 },
            ],
          },
        ]),
      );
      assert.deepEqual(
        explanations(rows),
        expectedFrom(fuse(itemRows, boosted), itemRows),
        'each x card gains 1.5 / 61 from the boost',
      );
    });

    test('a negative weight is marked inverted and ranks the signal the other way around', async function (assert) {
      await index(items);
      let inverted: SignalSpec[] = [
        { name: 'score', value: field('score') },
        { name: 'heat', weight: -2, value: field('heat') },
      ];
      let { rows } = await run(
        explained([{ blend: [{ by: 'score' }, { by: 'heat', weight: -2 }] }]),
      );
      assert.deepEqual(
        explanations(rows),
        expectedFrom(fuse(itemRows, inverted), itemRows),
        'the lowest heat ranks first, contributing 2 / 61',
      );
    });

    test('an expression signal is named by its text and carries its value', async function (assert) {
      await index(items);
      let expression = 'IFERROR(score / stock, 0)';
      let withExpression: SignalSpec[] = [
        {
          name: expression,
          weight: 1.5,
          value: (r) => (r.stock ? r.score / r.stock : 0),
        },
        { name: 'heat', value: field('heat') },
      ];
      let { rows } = await run(
        explained([{ blend: [{ expression, weight: 1.5 }, { by: 'heat' }] }]),
      );
      assert.deepEqual(
        explanations(rows),
        expectedFrom(fuse(itemRows, withExpression), itemRows),
      );
    });

    test('a `k` of the blend is reported and used', async function (assert) {
      await index(items);
      let { rows } = await run(explained([{ blend, k: 5 }]));
      assert.deepEqual(
        explanations(rows),
        expectedFrom(fuse(itemRows, signals, 5), itemRows),
      );
    });

    // pins current behavior; rule not yet decided: docs/search.md says a
    // boost's matches "tie for first place" and says nothing of two cards
    // with the same value for a field. Today they share a rank and the next
    // rank is skipped (1, 1, 3), which is what `fuse` computes.
    test('cards with the same value for a signal share a rank', async function (assert) {
      await index(items);
      let { rows } = await run(explained([{ blend: [{ by: 'stock' }] }]));
      let ranks = Object.fromEntries(
        rows.map((r) => [r.id, r.explain!.signals[0].rank]),
      );
      // stocks: 20, 16, 10, 8, 5, 4, 2, 1, then 0 twice; d and j hold none
      assert.deepEqual(
        [ranks.b, ranks.h, ranks.g, ranks.d],
        [9, 9, 8, null],
        'b and h (stock 0) are both ninth, after g (stock 1)',
      );
    });

    module('with a near signal', function () {
      const nearBlend = [
        { by: 'embedding', near: xAxis, weight: 2 },
        { by: 'score' },
      ];

      test("a near signal's value is the similarity, and a card with no vector has no rank", async function (assert) {
        await index(vectors);
        let { rows } = await run(explained([{ blend: nearBlend }]));
        let got = rows[0].explain!.signals[0].signal;
        let nearSignals: SignalSpec[] = [
          // named as the engine names it; the name has a test of its own
          { name: got, weight: 2, value: similarityTo(xAxis) },
          { name: 'score', value: field('score') },
        ];
        assert.deepEqual(
          explanations(rows, 5),
          expectedFrom(fuse(vectorRows, nearSignals), vectorRows, 5),
        );
      });

      // docs/search.md: "`signal` names a `relevance` signal ..., `when` for
      // a `boost`, or the field a signal sorts by."
      test('a near signal is named by the field it sorts by', async function (assert) {
        await index(vectors);
        let { rows } = await run(explained([{ blend: nearBlend }]));
        assert.strictEqual(rows[0].explain!.signals[0].signal, 'embedding');
      });
    });

    module('leaves the result as it was', function () {
      // Each kind of ranking, over the vector fixture, with a facet and a
      // page smaller than the result.
      const kinds: Record<string, { query: Doc; explains: boolean }> = {
        'a plain sort': { query: { sort: [{ by: 'score' }] }, explains: false },
        'a blend': {
          query: {
            sort: [{ blend: [{ by: 'score' }, { by: 'heat', weight: 0.5 }] }],
          },
          explains: true,
        },
        'a blend with a boost': {
          query: {
            sort: [
              {
                blend: [
                  { by: 'score' },
                  { boost: { eq: { group: 'x' } }, weight: 2 },
                ],
              },
            ],
          },
          explains: true,
        },
        'a near sort': {
          query: { sort: [{ by: 'embedding', near: xAxis }] },
          explains: false,
        },
        'an expression in SQL': {
          query: { sort: [{ expression: 'score * heat' }] },
          explains: false,
        },
        'a window': {
          query: {
            sort: [{ expression: 'heat', top: 3 }, { by: 'score' }],
          },
          explains: false,
        },
        'a window over a blend': {
          query: {
            sort: [
              { expression: 'price', top: 3 },
              { blend: [{ by: 'score' }, { by: 'heat', weight: 0.5 }] },
            ],
          },
          explains: true,
        },
      };
      for (let [kind, { query, explains }] of Object.entries(kinds)) {
        let asked = {
          type: itemRef,
          facets: [{ by: 'group' }],
          page: { number: 0, size: 4 },
          ...query,
        };
        const comparable = ({ rows, meta }: Ran) => ({
          rows: rows.map(({ explain: _explain, ...rest }) => rest),
          total: meta.page?.total,
          facets: meta.facets,
        });

        test(`explain does not change the rows, order, total or facets of ${kind}`, async function (assert) {
          await index(vectors);
          let plain = await run(asked);
          let withExplain = await run({ ...asked, explain: true });
          assert.deepEqual(comparable(withExplain), comparable(plain));
          assert.strictEqual(plain.meta.page?.total, 5, 'five matches');
          assert.strictEqual(plain.rows.length, 4, 'a page of four');
        });

        // docs/search.md: "every result of a query sorted by a `blend` or
        // `relevance` carries `meta._explain`".
        test(`with explain, the rows of ${kind} carry ${explains ? 'an explanation' : 'no explanation'}`, async function (assert) {
          await index(vectors);
          let { rows } = await run({ ...asked, explain: true });
          assert.deepEqual(
            rows.map((r) => r.explain !== undefined),
            rows.map(() => explains),
          );
        });
      }

      test('a re-ranked row keeps the explanation its blend gave it', async function (assert) {
        await index(items);
        let { rows } = await run(
          explained([{ expression: 'heat', top: 4 }, { blend }], {
            page: { size: 12 },
          }),
        );
        assert.deepEqual(
          explanations(rows),
          expectedFrom(fuse(itemRows, signals), itemRows),
          'window rows and the rows after them alike',
        );
      });
    });
  });

  // ── How a near search ran: meta.near and the near-exact-scan warning ─────

  module('near: how the search ran', function () {
    // The thresholds below make four vectors "many". A space's index is
    // built only once its vectors pass the threshold, after a write
    // commits (`VectorStore.buildIndexes`), so each test that lowers it
    // builds the index as the writer would have.
    async function settingsWithIndex(
      settings: Parameters<typeof setVectorSearchSettings>[0],
    ) {
      setVectorSearchSettings(settings);
      let spaces = await adapter.execute(
        'SELECT space FROM boxel_vector_spaces',
      );
      await vectorStoreFor(adapter).buildIndexes(
        spaces.map((r) => String(r.space)),
      );
    }
    // The fixture holds four vectors. With the exact threshold lowered to
    // three, the realm is "large" and the engine has to choose a path.
    const nearSort = (extra: Doc = {}) => ({
      by: 'embedding',
      near: xAxis,
      ...extra,
    });
    const bySimilarity = ordered(
      [...vectorRows].sort(byName),
      similarityTo(xAxis),
    );
    const warningCodes = (meta: Doc) =>
      ((meta.warnings as { code: string }[] | undefined) ?? []).map(
        (w) => w.code,
      );

    test('at or below the threshold a near search is exact (below-threshold), with no warning', async function (assert) {
      await index(vectors);
      await settingsWithIndex({ exactThreshold: 4 });
      let { ids, meta } = await run({
        type: itemRef,
        sort: [nearSort()],
        page: { size: 3 },
      });
      assert.deepEqual(
        { path: meta.near?.path, reason: meta.near?.reason },
        { path: 'exact', reason: 'below-threshold' },
      );
      assert.strictEqual(meta.near?.candidates, 4, 'four vectors counted');
      assert.strictEqual(meta.near?.threshold, 4);
      assert.deepEqual(warningCodes(meta), []);
      assert.deepEqual(ids, idsOf(bySimilarity.slice(0, 3)));
    });

    for (let [what, reason, query] of [
      ['an unpaged near sort', 'unpaged', { sort: [nearSort()] }],
      [
        'a near sort that does not lead the sort',
        'not-leading',
        { sort: [{ by: 'group' }, nearSort()], page: { size: 3 } },
      ],
      [
        'a near sort that ranks least similar first',
        'not-leading',
        { sort: [nearSort({ direction: 'asc' })], page: { size: 3 } },
      ],
    ] as const) {
      test(`past the threshold, ${what} is exact (${reason}) and warns near-exact-scan`, async function (assert) {
        await index(vectors);
        await settingsWithIndex({ exactThreshold: 3 });
        let { meta } = await run({ type: itemRef, ...query });
        assert.deepEqual(
          { path: meta.near?.path, reason: meta.near?.reason },
          { path: 'exact', reason },
        );
        assert.deepEqual(warningCodes(meta), ['near-exact-scan']);
      });
    }

    // Not covered here: `small-share` (the engine keeps what it read of a
    // space's size for 30 seconds, so a test cannot make a realm a small
    // share of a space it has just filled). `no-index` (a space whose
    // vectors have not yet passed the threshold) is covered in
    // vector-search-test.ts.

    module('a near filter that admits too many cards', function () {
      // similarity at least 0 admits v0, v30 and v75
      const query = {
        type: itemRef,
        filter: { near: { embedding: { to: xAxis, minSimilarity: 0 } } },
        sort: [{ by: 'name' }],
        page: { size: 10 },
      };

      test('is answered exactly (too-many-matches), admitting every card within the threshold', async function (assert) {
        await index(vectors);
        await settingsWithIndex({ exactThreshold: 3, filterCandidates: 2 });
        let { ids, meta } = await run(query);
        assert.deepEqual(
          { path: meta.near?.path, reason: meta.near?.reason },
          { path: 'exact', reason: 'too-many-matches' },
        );
        assert.deepEqual(
          ids,
          idsOf(
            [...vectorRows]
              .sort(byName)
              .filter((r) => (similarityTo(xAxis)(r) ?? -2) >= 0),
          ),
        );
      });

      // docs/search.md: "An exact search over more vectors than the
      // threshold, for any reason but a small share, adds the warning
      // `near-exact-scan`".
      test('warns near-exact-scan', async function (assert) {
        await index(vectors);
        await settingsWithIndex({ exactThreshold: 3, filterCandidates: 2 });
        let { meta } = await run(query);
        assert.deepEqual(warningCodes(meta), ['near-exact-scan']);
      });
    });

    module(
      'a filter that admits only cards the approximate read left out',
      function () {
        // The approximate read takes the two nearest (v0, v30); the filter
        // admits the two furthest.
        const settings = { exactThreshold: 3, minRescore: 1, rescoreFactor: 1 };
        const query = {
          type: itemRef,
          filter: { any: [{ eq: { name: 'v75' } }, { eq: { name: 'v170' } }] },
          sort: [nearSort()],
          page: { size: 2 },
        };

        test('is answered exactly (filtered-out), each admitted card with its similarity', async function (assert) {
          await index(vectors);
          await settingsWithIndex(settings);
          let { rows, meta } = await run(query);
          assert.deepEqual(
            { path: meta.near?.path, reason: meta.near?.reason },
            { path: 'exact', reason: 'filtered-out' },
          );
          assert.deepEqual(
            rounded(
              rows.map((r) => [r.id, r.similarity]),
              5,
            ),
            rounded(
              [
                ['v75', Math.cos((75 * Math.PI) / 180)],
                ['v170', Math.cos((170 * Math.PI) / 180)],
              ],
              5,
            ),
          );
        });

        // The same sentence of docs/search.md as above.
        test('warns near-exact-scan', async function (assert) {
          await index(vectors);
          await settingsWithIndex(settings);
          let { meta } = await run(query);
          assert.deepEqual(warningCodes(meta), ['near-exact-scan']);
        });
      },
    );
  });

  // ── 5. Vectors in mixed states ───────────────────────────────────────────

  module('near over vectors in mixed states', function () {
    const byNameRows = [...vectorRows].sort(byName);
    const nearSorted = (extra: Doc = {}, sortExtra: Doc = {}) => ({
      type: itemRef,
      sort: [{ by: 'embedding', near: xAxis, ...sortExtra }, { by: 'name' }],
      ...extra,
    });
    const similarities = (rows: Ran['rows']) =>
      rounded(
        rows.map((r) => [r.id, r.similarity]),
        5,
      );
    const expectedSimilarities = (rows: Row[], target = xAxis) =>
      rounded(
        rows.map((r) => [r.id, similarityTo(target)(r)]),
        5,
      );

    test('a near sort ranks most similar first, and a card with no vector last', async function (assert) {
      await index(vectors);
      let { rows } = await run(nearSorted());
      assert.deepEqual(
        similarities(rows),
        expectedSimilarities(ordered(byNameRows, similarityTo(xAxis))),
      );
    });

    test('a near sort with `direction: "asc"` ranks least similar first, and a card with no vector still last', async function (assert) {
      await index(vectors);
      let { rows } = await run(nearSorted({}, { direction: 'asc' }));
      assert.deepEqual(
        similarities(rows),
        expectedSimilarities(ordered(byNameRows, similarityTo(xAxis), 'asc')),
      );
    });

    module(
      'a card whose vector is in another space than the field declares',
      function () {
        // v30's vector is left in the space of an earlier model: the same
        // size, but not the space the field declares.
        async function indexWithStale() {
          await index(vectors);
          await adapter.execute(
            `UPDATE boxel_index_vectors SET space = 'edge-model@0 test 3' WHERE url = $1`,
            { bind: [url('v30')] },
          );
        }
        const withoutStale: Value = (r) =>
          r.id === 'v30' ? null : similarityTo(xAxis)(r);

        // The states are read from the engine's own description of them
        // (`VectorQuery#vectorStatus`); docs/search.md does not list them.
        test('is reported as stale by vectorStatus, beside ok and missing', async function (assert) {
          await indexWithStale();
          let status = async (id: string) =>
            (await engine.vectorStatus(new URL(url(id)))).embedding;
          assert.deepEqual(await status('v30'), {
            status: 'stale',
            space: SPACE,
            count: 0,
          });
          assert.deepEqual(await status('v0'), {
            status: 'ok',
            space: SPACE,
            count: 1,
          });
          assert.deepEqual(await status('vNone'), {
            status: 'missing',
            space: SPACE,
            count: 0,
          });
        });

        for (let direction of ['desc', 'asc'] as const) {
          test(`is never compared by a near sort: it ranks with the cards that have no vector (${direction})`, async function (assert) {
            await indexWithStale();
            let { rows } = await run(nearSorted({}, { direction }));
            assert.deepEqual(
              similarities(rows),
              rounded(
                ordered(byNameRows, withoutStale, direction).map((r) => [
                  r.id,
                  withoutStale(r),
                ]),
                5,
              ),
              'v30 carries no similarity and sorts with vNone, by name',
            );
          });
        }

        test('is never admitted by a near filter with a threshold', async function (assert) {
          await indexWithStale();
          let { ids } = await run({
            type: itemRef,
            filter: { near: { embedding: { to: xAxis, minSimilarity: 0.5 } } },
            sort: [{ by: 'name' }],
          });
          // v0 (1) and v30 (0.87) are within 0.5; v30 is not compared
          assert.deepEqual(ids, ['v0']);
        });

        // pins current behavior; rule not yet decided: docs/search.md says a
        // near filter without `minSimilarity` "keeps every card that has a
        // vector of `to`'s dimension there", and also that a vector in another
        // space "never compares just because its size matches". A filter with
        // no threshold compares nothing. Today the stale card is left out.
        test('is left out by a near filter with no threshold', async function (assert) {
          await indexWithStale();
          let { ids } = await run({
            type: itemRef,
            filter: { near: { embedding: { to: xAxis } } },
            sort: [{ by: 'name' }],
          });
          assert.deepEqual(ids, ['v0', 'v170', 'v75']);
        });

        test('is admitted by the negation of a near filter, as a card with no vector is', async function (assert) {
          await indexWithStale();
          let { ids } = await run({
            type: itemRef,
            filter: {
              not: { near: { embedding: { to: xAxis, minSimilarity: 0.5 } } },
            },
            sort: [{ by: 'name' }],
          });
          assert.deepEqual(ids, ['v170', 'v30', 'v75', 'vNone']);
        });
      },
    );

    module('a target of another size than the stored vectors', function () {
      test('a near filter keeps no card, since none holds a vector of that size', async function (assert) {
        await index(vectors);
        let outcome = await attempt({
          type: itemRef,
          filter: { near: { embedding: { to: [1, 0] } } },
          sort: [{ by: 'name' }],
        });
        assertOrder(assert, outcome, [], 'a two-number target');
      });

      // pins current behavior; rule not yet decided: docs/search.md does not
      // say whether a near sort whose target has another size than the
      // field's vectors is refused. Today it is answered: every row, none
      // with a similarity.
      test('a near sort returns every row with no similarity', async function (assert) {
        await index(vectors);
        let outcome = await attempt({
          type: itemRef,
          sort: [{ by: 'embedding', near: [1, 0] }, { by: 'name' }],
        });
        let ran = assertOrder(
          assert,
          outcome,
          byNameRows,
          'a two-number target',
        );
        assert.deepEqual(
          ran?.rows.map((r) => r.similarity),
          byNameRows.map(() => null),
        );
      });
    });

    module('a vector of all zeros, which has no direction', function () {
      const withZero: Corpus = {
        ...vectors,
        vZero: {
          name: 'vZero',
          embedding: vec([0, 0, 0]),
          ...declared,
        },
      };
      const zeroRows = rowsOf(withZero).sort(byName);
      const defined: Value = (r) =>
        r.id === 'vZero' ? null : similarityTo(xAxis)(r);

      // Cosine similarity to a vector of zeros is undefined (0 / 0). The
      // card can be no nearer than a card with a real similarity, so it
      // belongs with the cards that have no vector.
      test('stored on a card, it does not outrank the cards that have a similarity', async function (assert) {
        await index(withZero);
        let outcome = await attempt(nearSorted());
        let ran = assertOrder(
          assert,
          outcome,
          ordered(zeroRows, defined),
          'most similar first',
        );
        assert.deepEqual(
          ran?.rows.filter((r) => Number.isNaN(r.similarity)).map((r) => r.id),
          [],
          'no row carries a similarity that is not a number',
        );
      });

      test('stored on a card, it does not lead a least-similar-first sort either', async function (assert) {
        await index(withZero);
        assertOrder(
          assert,
          await attempt(nearSorted({}, { direction: 'asc' })),
          ordered(zeroRows, defined, 'asc'),
          'least similar first',
        );
      });

      test('stored on a card, it is not within any similarity threshold', async function (assert) {
        await index(withZero);
        let outcome = await attempt({
          type: itemRef,
          filter: { near: { embedding: { to: xAxis, minSimilarity: -1 } } },
          sort: [{ by: 'name' }],
        });
        assertOrder(
          assert,
          outcome,
          zeroRows.filter((r) => defined(r) != null),
          'similarity at least -1',
        );
      });

      // As a target, no card has a similarity to it. Whether the query is
      // refused or answered is not in docs/search.md; either way it must not
      // fail with a database error, drop rows, or hand back a similarity
      // that is not a number.
      test('as the target of a near sort, it is refused with a code or returns every row with no similarity', async function (assert) {
        await index(vectors);
        let outcome = await attempt({
          type: itemRef,
          sort: [{ by: 'embedding', near: [0, 0, 0] }, { by: 'name' }],
        });
        if (outcome.kind === 'refused') {
          assertRefused(assert, outcome, DOCUMENTED_CODES, 'a zero target');
        } else {
          let ran = assertOrder(assert, outcome, byNameRows, 'a zero target');
          assert.deepEqual(
            ran?.rows.map((r) => String(r.similarity)),
            byNameRows.map(() => 'null'),
            'no row has a similarity to a vector with no direction',
          );
        }
      });

      test('as the target of a near filter with a threshold, it is refused with a code or admits no card', async function (assert) {
        await index(vectors);
        let outcome = await attempt({
          type: itemRef,
          filter: { near: { embedding: { to: [0, 0, 0], minSimilarity: 0 } } },
          sort: [{ by: 'name' }],
        });
        if (outcome.kind === 'refused') {
          assertRefused(assert, outcome, DOCUMENTED_CODES, 'a zero target');
        } else {
          assertOrder(assert, outcome, [], 'a zero target');
        }
      });
    });

    module('cards holding the same vector', function () {
      const twins: Corpus = Object.fromEntries(
        ['t1', 't2', 't3', 't4'].map((name) => [
          name,
          { name, embedding: vec(atAngle(30)), ...declared },
        ]),
      );

      test('with a next sort key, tied cards follow that key', async function (assert) {
        await index({ ...vectors, ...twins });
        let rows = rowsOf({ ...vectors, ...twins }).sort(byName);
        let value: Value = (r) =>
          r.id.startsWith('t')
            ? cosine(atAngle(30), xAxis)
            : similarityTo(xAxis)(r);
        assertOrder(
          assert,
          await attempt(nearSorted()),
          // rounded so the five cards at 30 degrees tie exactly
          ordered(rows, (r) =>
            value(r) == null ? null : Number(value(r)!.toFixed(5)),
          ),
          'similarity, then name',
        );
      });

      test('with no other sort key, pages of one hold each tied card once', async function (assert) {
        await index(twins);
        let seen: string[] = [];
        for (let number = 0; number < 4; number++) {
          let { ids } = await run({
            type: itemRef,
            sort: [{ by: 'embedding', near: xAxis }],
            page: { number, size: 1 },
          });
          seen.push(...ids);
        }
        assert.deepEqual([...seen].sort(), ['t1', 't2', 't3', 't4']);
      });
    });

    module('a list of vectors (`parts.embedding`)', function () {
      const partsAt = (...partAngles: (number | undefined)[]) => ({
        parts: partAngles.map((angle) =>
          angle === undefined ? {} : { embedding: vec(atAngle(angle)) },
        ),
        ...declared,
      });
      // each card's part angles; undefined is a part with no vector
      const partAngles: Record<string, (number | undefined)[] | undefined> = {
        far: [170, 120],
        mixed: [140, 20, 95],
        gaps: [undefined, 60, undefined],
        empty: [],
        unset: undefined,
        blanks: [undefined, undefined],
      };
      const lists: Corpus = Object.fromEntries(
        Object.entries(partAngles).map(([name, list]) => [
          name,
          { name, ...(list ? partsAt(...list) : declared) },
        ]),
      );
      const listRows = rowsOf(lists).sort(byName);
      // A card scores by its nearest part; none when no part has a vector.
      const nearest: Value = (r) => {
        let present = (partAngles[r.id] ?? []).filter(
          (a): a is number => a !== undefined,
        );
        return present.length
          ? Math.max(...present.map((a) => cosine(atAngle(a), xAxis)))
          : null;
      };
      const listSorted = (direction: 'asc' | 'desc') => ({
        type: itemRef,
        sort: [
          { by: 'parts.embedding', near: xAxis, direction },
          { by: 'name' },
        ],
      });

      test('a card scores by its nearest part, skipping parts with no vector; an empty or missing list sorts last', async function (assert) {
        await index(lists);
        let { rows } = await run(listSorted('desc'));
        assert.deepEqual(
          similarities(rows),
          rounded(
            ordered(listRows, nearest).map((r) => [r.id, nearest(r)]),
            5,
          ),
        );
      });

      // pins current behavior; rule not yet decided: docs/search.md says a
      // plural path "scores a card by its nearest vector" and does not say
      // which vector counts when the sort asks for least similar first.
      // Today the card's nearest part still gives its score.
      test('least similar first still scores a card by its nearest part', async function (assert) {
        await index(lists);
        let { rows } = await run(listSorted('asc'));
        assert.deepEqual(
          similarities(rows),
          rounded(
            ordered(listRows, nearest, 'asc').map((r) => [r.id, nearest(r)]),
            5,
          ),
        );
      });

      test('a near filter holds when some part is within the threshold', async function (assert) {
        await index(lists);
        let { ids } = await run({
          type: itemRef,
          filter: {
            near: { 'parts.embedding': { to: xAxis, minSimilarity: 0.4 } },
          },
          sort: [{ by: 'name' }],
        });
        assert.deepEqual(
          ids,
          idsOf(listRows.filter((r) => (nearest(r) ?? -2) >= 0.4)),
          'gaps (60 degrees) and mixed (20 degrees)',
        );
      });

      test('the negation of a near filter keeps the cards with no part within the threshold, empty lists among them', async function (assert) {
        await index(lists);
        let { ids } = await run({
          type: itemRef,
          filter: {
            not: {
              near: { 'parts.embedding': { to: xAxis, minSimilarity: 0.4 } },
            },
          },
          sort: [{ by: 'name' }],
        });
        assert.deepEqual(
          ids,
          idsOf(listRows.filter((r) => !((nearest(r) ?? -2) >= 0.4))),
        );
      });
    });

    module('the target', function () {
      // docs/search.md: "`near` targets are a number array or a vector in
      // its stored form". There is no text target, so nothing here calls an
      // embedding model.
      for (let [what, near] of [
        ['text to embed', { text: 'a red chair' }],
        ['a string', 'a red chair'],
        ['a list holding a non-number', [1, 'x', 0]],
        ['a list holding infinity', [1, Infinity, 0]],
      ] as const) {
        test(`a near sort whose target is ${what} is refused with invalid-value`, async function (assert) {
          await index(vectors);
          assertRefused(
            assert,
            await attempt({
              type: itemRef,
              sort: [{ by: 'embedding', near }],
            }),
            'invalid-value',
            JSON.stringify(near),
          );
        });
      }

      // pins current behavior; rule not yet decided: docs/search.md does not
      // name the code for a target with no numbers. Today it is
      // `limit-exceeded`, whose message gives the sizes a target may have.
      test('an empty target is refused with limit-exceeded', async function (assert) {
        await index(vectors);
        assertRefused(
          assert,
          await attempt({
            type: itemRef,
            sort: [{ by: 'embedding', near: [] }],
          }),
          'limit-exceeded',
          '[]',
        );
      });

      test('a target in its stored form ranks as the same numbers do', async function (assert) {
        await index(vectors);
        let target = atAngle(50);
        let stored = VectorSerializer.serialize(
          encodeVector(target, { encoding: 'float32' }),
        );
        let { rows } = await run({
          type: itemRef,
          sort: [{ by: 'embedding', near: stored }, { by: 'name' }],
        });
        assert.deepEqual(
          similarities(rows),
          expectedSimilarities(
            ordered(byNameRows, similarityTo(target)),
            target,
          ),
        );
      });
    });
  });
});
