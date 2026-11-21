import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  checkValueStore,
  internalKeyFor,
  query as runQuery,
  rri,
  setCompareRowLimitForTests,
  syncValueStoreLiveness,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Expression,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
  type SerializedError,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A search of one card type whose candidates the value store bounds reads
// only the store's cards: a positive range on a number field in the mixed
// scope a realm `_search` runs (no `scope` sent), and a re-rank's comparison
// set of a whole type, read from the store's own rows. Those statements take
// liveness from the store (a card has rows only while it is live) and probe
// no rendering for a render error. Every answer is the general read's: the
// same engine with the value store turned off reads the same rows in the
// same order, whatever error state a card is in.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const mod = `${testRealm}item`;
const itemRef = ref(mod, 'Item');

function field(fieldOrCard: ResolvedCodeRef): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(fieldOrCard === numberRef ? { serializerName: 'number' } : {}),
  } as FieldDefinition;
}
const itemFields = {
  cardTitle: field(stringRef),
  rating: field(numberRef),
  reviews: field(numberRef),
  kind: field(stringRef),
};
const itemDef = {
  type: 'card-def',
  codeRef: itemRef,
  displayName: 'Item',
  fields: Object.fromEntries(
    Object.keys(itemFields).map((name, i) => [name, `f${i}`]),
  ),
  fieldDefs: Object.fromEntries(
    Object.values(itemFields).map((f, i) => [`f${i}`, f]),
  ),
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === mod) {
        return itemDef;
      }
      throw new Error(
        `unexpected definition lookup: ${JSON.stringify(codeRef)}`,
      );
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

// The same engine reading every search the general way: no statement of it
// reads the value store.
class GeneralReadEngine extends IndexQueryEngine {
  constructor(...args: ConstructorParameters<typeof IndexQueryEngine>) {
    super(...args);
    this.dialect = { ...this.dialect, valueStore: false };
  }
}

// 40 items: ratings and review counts with ties, some missing, one rating
// held as text; three kinds.
const ratings = [3.5, 4, 4.2, 4.5, 4.8, 5];
const items = Array.from({ length: 40 }, (_, i) => ({
  name: `i${String(i).padStart(2, '0')}`,
  rating: i % 7 === 6 ? undefined : i === 9 ? '4.5' : ratings[i % 6],
  reviews: i % 5 === 4 ? undefined : (i * 7) % 60,
  kind: ['chair', 'table', 'lamp'][i % 3],
}));
const cardURL = (name: string) => `${testRealm}Item/${name}.json`;

const genuineError: SerializedError = {
  status: 500,
  title: 'Error',
  message: 'Cannot read properties of undefined',
  additionalErrors: null,
};
const renderTimeout: SerializedError = {
  status: 504,
  title: 'Render timeout',
  message: 'Render timed-out after 60000 ms',
  additionalErrors: null,
  renderTimeout: true,
};

// The case-8 shape: a re-rank by a standardized score within each item's
// kind, over the type's whole comparison set, then a smoothed average.
const reranked = {
  type: itemRef,
  filter: {
    every: [
      { range: { rating: { gte: 4 } } },
      { range: { reviews: { gte: 10 } } },
    ],
  },
  sort: [
    {
      expression:
        'STANDARDIZE(rating, stats.rating.avg, stats.rating.stdev) * LOG10(reviews)',
      top: 12,
      compare: { by: 'kind', filter: { type: itemRef } },
    },
    { expression: '(rating * reviews + 4 * 50) / (reviews + 50)' },
  ],
  page: { size: 8 },
} as unknown as Query;

const ranged = {
  type: itemRef,
  filter: {
    every: [
      { range: { rating: { gte: 4.2 } } },
      { range: { reviews: { lt: 40 } } },
    ],
  },
  sort: [{ by: 'reviews', direction: 'desc' }],
  page: { size: 5 },
} as unknown as Query;

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;
  let general: IndexQueryEngine;
  let statements: string[];
  let itemKey: string;

  const entry = (item: (typeof items)[number], extra: object = {}) => ({
    type: 'instance' as const,
    resource: {
      id: rri(`${testRealm}Item/${item.name}`),
      type: 'card' as const,
      attributes: {},
      meta: { adoptsFrom: { module: rri(mod), name: 'Item' } },
    },
    lastModified: Date.now(),
    resourceCreatedAt: Date.now(),
    searchData: {
      cardTitle: item.name,
      kind: item.kind,
      ...(item.rating === undefined ? {} : { rating: item.rating }),
      ...(item.reviews === undefined ? {} : { reviews: item.reviews }),
      ...extra,
    },
    deps: new Set<string>(),
    displayNames: ['Item'],
    types: [itemKey],
    isolatedHtml: `<div>${item.name}</div>`,
  });

  async function pass(write: (batch: any) => Promise<void>) {
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    await write(batch);
    await batch.done();
  }

  const host = () => ({
    dbAdapter: adapter,
    query: (e: Expression) => runQuery(adapter, e),
  });

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    general = new GeneralReadEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    itemKey = internalKeyFor(itemRef, undefined, virtualNetwork);
    await pass(async (batch) => {
      for (let item of items) {
        await batch.updateEntry(new URL(cardURL(item.name)), entry(item));
      }
    });
    statements = [];
    let execute = adapter.execute.bind(adapter);
    adapter.execute = ((sql: string, opts?: unknown) => {
      statements.push(sql);
      return execute(sql, opts as never);
    }) as typeof adapter.execute;
  });

  hooks.afterEach(async function () {
    setCompareRowLimitForTests(undefined);
    await closeTestPgAdapter(adapter);
  });

  // A search as realm `_search` runs one with no `scope`: the item-only
  // projection over both kinds of row.
  async function answer(on: IndexQueryEngine, q: Query) {
    let { results, meta } = await on.search(
      new URL(testRealm),
      q,
      {},
      { kind: 'dataOnly' },
      'all',
    );
    return {
      urls: results.map((r) => `${r.type} ${r.url}`),
      total: meta.page?.total,
      window: (meta as { window?: unknown }).window,
      warnings: meta.warnings,
      rerank: results.map(
        (r) => (r as Record<string, unknown>)._window ?? null,
      ),
    };
  }

  // The store-bounded answer, the general read's, and the statements the
  // store-bounded one ran.
  async function both(q: Query) {
    statements = [];
    let bounded = await answer(engine, q);
    let ran = statements;
    statements = [];
    let expected = await answer(general, q);
    return { bounded, expected, ran };
  }

  const storeRead = (sql: string) => sql.includes('boxel_index_value_cards');
  const probes = (sql: string) => sql.includes('prerendered_html AS phe');
  const readsCandidates = (sql: string) =>
    storeRead(sql) && /FROM boxel_index AS i\b/.test(sql);

  test('a range search of a card type in the mixed scope reads its candidates from the store', async function (assert) {
    let { bounded, expected, ran } = await both(ranged);
    assert.deepEqual(bounded, expected, 'the general read’s answer');
    assert.ok(bounded.urls.length > 0, 'the search matches cards');
    assert.true(
      ran.some((sql) => sql.includes('v.num >=')),
      'the range read its candidates from the store',
    );
    assert.true(
      ran.filter(readsCandidates).every((sql) => !probes(sql)),
      'no statement whose candidates the store bounds probes for a render error',
    );
  });

  test('two ranges narrow the candidates by one set, their intersection', async function (assert) {
    for (let q of [ranged, reranked]) {
      let { bounded, expected, ran } = await both(q);
      assert.deepEqual(bounded, expected, 'the general read’s answer');
      let reads = ran.filter(readsCandidates);
      assert.ok(reads.length > 0, 'a statement reads the store’s candidates');
      for (let sql of reads) {
        // Each place the condition reads the range candidates holds one
        // array on url, the two ranges' store sets intersected, not one
        // array each.
        let arrays = (sql.match(/WHERE c\.id = ANY \(ARRAY\(/g) ?? []).length;
        assert.ok(arrays > 0);
        assert.strictEqual(
          (sql.match(/\) INTERSECT \(/g) ?? []).length,
          arrays,
          'the candidate read has one = ANY on url, an intersection',
        );
      }
    }
  });

  test('a range under a `not` reads what the general read reads, for missing, null and 0 values', async function (assert) {
    // Cards whose reviews are null, beside the fixture's 0s and missing ones.
    await pass(async (batch) => {
      for (let item of items.slice(0, 3)) {
        await batch.updateEntry(
          new URL(cardURL(item.name)),
          entry({ ...item, reviews: undefined }, { reviews: null }),
        );
      }
    });
    let gt0 = { range: { reviews: { gt: 0 } } };
    let high = { range: { rating: { gte: 4.2 } } };
    let filters = [
      { not: gt0 },
      { not: { not: gt0 } },
      { not: { every: [high, { not: gt0 }] } },
      {
        every: [
          high,
          { not: { every: [gt0, { range: { rating: { lt: 5 } } }] } },
        ],
      },
      { not: { any: [{ not: high }, { not: gt0 }] } },
    ];
    for (let filter of filters) {
      for (let q of [filter, { not: filter }]) {
        let query = {
          type: itemRef,
          filter: q,
          sort: [{ by: 'reviews', direction: 'desc' }],
          page: { size: 100 },
        } as unknown as Query;
        let { bounded, expected } = await both(query);
        assert.deepEqual(bounded, expected, JSON.stringify(q));
      }
    }
  });

  test('a re-rank compares with a whole type read from the store', async function (assert) {
    let { bounded, expected, ran } = await both(reranked);
    assert.deepEqual(bounded, expected, 'the general read’s answer');
    assert.ok(bounded.urls.length > 0);
    assert.true(
      ran.some(
        (sql) =>
          storeRead(sql) &&
          sql.includes('c0') &&
          !/FROM boxel_index AS i\b/.test(sql),
      ),
      'the comparison set read only the store',
    );
    assert.false(
      ran.some(
        (sql) =>
          /FROM boxel_index AS i\b/.test(sql) &&
          sql.includes('AS c0') &&
          sql.includes('LIMIT 10001'),
      ),
      'the comparison set read no index row',
    );
    assert.true(
      ran.filter(readsCandidates).every((sql) => !probes(sql)),
      'no store-bounded statement probes for a render error',
    );
  });

  test('a comparison set cut at its row limit is the general read’s cut', async function (assert) {
    setCompareRowLimitForTests(7);
    let { bounded, expected } = await both(reranked);
    assert.deepEqual(bounded, expected);
    assert.ok(
      (bounded.warnings ?? []).some((w) => w.code === 'compare-truncated'),
      'the cut is reported',
    );
  });

  test('a comparison value held only in the search doc is read the general way', async function (assert) {
    // A kind longer than search_keys keeps: the store holds a marker there.
    await pass(async (batch) => {
      await batch.updateEntry(
        new URL(cardURL('i03')),
        entry(items[3], { kind: `lamp ${'x'.repeat(400)}` }),
      );
    });
    let { bounded, expected } = await both(reranked);
    assert.deepEqual(bounded, expected);
  });

  // Each error state a card can be in, through the writer's own paths: the
  // store-bounded reads find exactly the cards the general read does.
  const errorCases: [string, () => Promise<void>, boolean][] = [
    [
      'an index error',
      () =>
        pass(async (batch) => {
          await batch.updateEntry(new URL(cardURL('i02')), {
            type: 'instance-error',
            error: { ...genuineError, id: cardURL('i02'), deps: [] },
            types: [itemKey],
          });
        }),
      false,
    ],
    [
      'a render error at the card’s generation',
      async () => {
        await storeRenderError('i02', genuineError);
      },
      false,
    ],
    [
      'a render error from an older generation (still live)',
      async () => {
        await storeRenderError('i02', genuineError, -1);
      },
      true,
    ],
    [
      'a transient render error (still live)',
      async () => {
        await storeRenderError('i02', renderTimeout);
      },
      true,
    ],
    [
      'a transient render error with no good render to keep',
      async () => {
        await storeRenderError('i02', {
          ...renderTimeout,
          noGoodRowToKeep: true,
        } as SerializedError);
      },
      false,
    ],
    [
      'a deleted card',
      () =>
        pass(async (batch) => {
          await batch.invalidate([new URL(cardURL('i02'))]);
        }),
      false,
    ],
    [
      'a card fixed by a later pass',
      async () => {
        await pass(async (batch) => {
          await batch.updateEntry(new URL(cardURL('i02')), {
            type: 'instance-error',
            error: { ...genuineError, id: cardURL('i02'), deps: [] },
            types: [itemKey],
          });
        });
        await pass(async (batch) => {
          await batch.updateEntry(new URL(cardURL('i02')), entry(items[2]));
        });
      },
      true,
    ],
    [
      'a render-only break, then its fix',
      async () => {
        await storeRenderError('i02', genuineError);
        await storeRenderError('i02', null);
      },
      true,
    ],
  ];

  // A render-only pass's write: the card's rendering carries `error` (from
  // `generations` behind the card's own), and the store follows its
  // liveness.
  async function storeRenderError(
    name: string,
    error: SerializedError | null,
    generations = 0,
  ) {
    await adapter.execute(
      `UPDATE prerendered_html AS ph SET error_doc = $1::jsonb,
          generation = i.generation + $3
         FROM boxel_index AS i
        WHERE ph.url = $2 AND ph.type = 'instance'
          AND i.url = ph.url AND i.realm_url = ph.realm_url AND i.type = ph.type`,
      {
        bind: [
          error ? JSON.stringify(error) : null,
          cardURL(name),
          generations,
        ],
      },
    );
    await syncValueStoreLiveness(host(), testRealm, [cardURL(name)]);
  }

  for (let [name, apply, live] of errorCases) {
    test(`${name}: the store-bounded reads find what the general read finds`, async function (assert) {
      let before = (await answer(general, ranged)).total;
      await apply();
      assert.strictEqual(
        (await answer(general, ranged)).total,
        live ? before : Number(before) - 1,
        live ? 'the card is still a match' : 'the card is no longer a match',
      );
      assert.deepEqual(
        await checkValueStore(host(), testRealm),
        [],
        'the store matches the index',
      );
      for (let q of [ranged, reranked]) {
        let { bounded, expected, ran } = await both(q);
        assert.deepEqual(bounded, expected, 'the general read’s answer');
        assert.true(
          ran.filter(readsCandidates).every((sql) => !probes(sql)),
          'no store-bounded statement probes for a render error',
        );
      }
    });
  }
});
