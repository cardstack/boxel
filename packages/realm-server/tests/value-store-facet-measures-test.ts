import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  internalKeyFor,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type FieldDefinition,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// The facets of a match set the value store decides are counted by one
// set-based statement: the set's cards (each test a range of the value
// index, the others joined to it), joined to the value rows at each facet's
// path, grouped, ordered and cut. No statement probes the store once per
// card. A positive range on a number field is a test the store decides: a
// card with a number in range, or text there that reads as one. The counts
// are the general read's: the same search under a grant that admits every
// card, which the store's set does not answer.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const mod = `${testRealm}product`;
const productRef = ref(mod, 'Product');
const pricingRef = ref(mod, 'Pricing');

function field(
  fieldOrCard: ResolvedCodeRef,
  serializerName?: string,
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(serializerName ? { serializerName } : {}),
    search: { facet: true },
  } as FieldDefinition;
}
const productFields = {
  cardTitle: field(stringRef),
  productType: field(stringRef),
  color: field(stringRef),
  rating: field(numberRef, 'number'),
  reviewCount: field(numberRef, 'number'),
  priceMin: field(numberRef, 'number'),
  inStock: field(booleanRef, 'boolean'),
  sizes: {
    ...field(numberRef, 'number'),
    type: 'containsMany',
  } as FieldDefinition,
  pricing: {
    type: 'contains',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: pricingRef,
    search: { facet: true },
  } as FieldDefinition,
};
const pricingDef = {
  type: 'field-def',
  codeRef: pricingRef,
  displayName: 'Pricing',
  fields: { min: 'g0' },
  fieldDefs: { g0: field(numberRef, 'number') },
} as unknown as Definition;
const productDef = {
  type: 'card-def',
  codeRef: productRef,
  displayName: 'Product',
  fields: Object.fromEntries(
    Object.keys(productFields).map((name, i) => [name, `f${i}`]),
  ),
  fieldDefs: Object.fromEntries(
    Object.values(productFields).map((f, i) => [`f${i}`, f]),
  ),
} as Definition;

function makeDefinitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === mod) {
        return 'name' in codeRef && codeRef.name === 'Pricing'
          ? pricingDef
          : productDef;
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

// 60 products: ratings and review counts with ties and gaps, one rating held
// as text, one as text that is no number.
const products = Array.from({ length: 60 }, (_, i) => ({
  name: `p${String(i).padStart(2, '0')}`,
  productType: ['SHOES', 'LAMP', 'HOME', 'GROCERY'][i % 4],
  color: i % 7 === 0 ? undefined : ['red', 'blue', 'black'][i % 3],
  rating:
    i === 11
      ? '4.9'
      : i === 13
        ? 'n/a'
        : i % 9 === 8
          ? undefined
          : [3.5, 4, 4.5, 4.8, 5][i % 5],
  reviewCount: i % 6 === 5 ? undefined : (i * 13) % 140,
  priceMin: i === 17 ? '149.5' : (i * 37) % 600,
  inStock: i % 3 === 0,
  sizes: [i % 4, (i * 3) % 7],
  // p23's pricing holds so many numbers that the budget marks the whole
  // object: its measured `pricing.min` is read from its search doc
  pricing: {
    min: (i * 11) % 90,
    ...(i === 23
      ? Object.fromEntries(
          Array.from({ length: 320 }, (_, n) => [`tier${n}`, n * 1.5]),
        )
      : {}),
  },
}));

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let statements: string[];

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    let network = new VirtualNetwork();
    engine = new IndexQueryEngine(adapter, makeDefinitionLookup(), network);
    let key = internalKeyFor(productRef, undefined, network);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      network,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let p of products) {
      let url = `${testRealm}Product/${p.name}`;
      let { name, ...data } = p;
      await batch.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(mod), name: 'Product' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          cardTitle: name,
          ...Object.fromEntries(
            Object.entries(data).filter(([, v]) => v !== undefined),
          ),
        },
        deps: new Set(),
        displayNames: ['Product'],
        types: [key],
        isolatedHtml: `<div>${name}</div>`,
      });
    }
    await batch.done();
    statements = [];
    let execute = adapter.execute.bind(adapter);
    adapter.execute = ((sql: string, opts?: unknown) => {
      statements.push(sql);
      return execute(sql, opts as never);
    }) as typeof adapter.execute;
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // One facet per field (meta.facets answers by field), in two searches.
  const facetSets = [
    [
      { by: 'productType', measure: { avg: 'priceMin' }, size: 100 },
      { by: 'color', measure: { sum: 'reviewCount' }, order: 'measure' },
      { by: 'inStock', measure: { max: 'rating' } },
    ],
    [
      { by: 'productType', measure: { min: 'priceMin' }, own: 'ignore' },
      { by: 'color', measure: { avg: 'sizes' }, own: 'ignore' },
      { by: 'inStock', measure: { avg: 'pricing.min' } },
    ],
  ];

  const filters: Record<string, unknown> = {
    'a whole type': undefined,
    'a range': { range: { rating: { gte: 4.5 } } },
    'a value test': { eq: { productType: 'LAMP' } },
  };

  async function counted(
    filter: unknown,
    facets: unknown[],
    size: number,
    general = false,
  ): Promise<Record<string, unknown>> {
    statements = [];
    let { meta } = await engine.search(
      new URL(testRealm),
      {
        type: productRef,
        ...(filter ? { filter } : {}),
        facets,
        page: { size },
      } as unknown as Query,
      general ? { grantFilter: { type: productRef } } : {},
      { kind: 'dataOnly' },
      'all',
    );
    return {
      total: meta.page?.total,
      facets: meta.facets,
      facetStats: meta.facetStats,
    };
  }

  // A measure read once per card: a lateral or scalar probe keyed by card.
  const probesPerCard = () =>
    statements.some(
      (sql) =>
        /CROSS JOIN LATERAL/.test(sql) && /\w+\.card_id = k\.card_id/.test(sql),
    );
  const facetsFromIndexRows = () =>
    statements.some(
      (sql) =>
        sql.includes('facet_paths') && /FROM boxel_index AS i\b/.test(sql),
    );

  test('the fixture holds a measured value only as a marker', async function (assert) {
    let rows = (await adapter.execute(
      `SELECT c.url FROM boxel_index_values AS v
         JOIN boxel_index_value_cards AS c ON c.id = v.card_id
         JOIN boxel_index_value_paths AS p ON p.id = v.path_id
        WHERE v.kind = 'm' AND p.path = 'pricing'`,
    )) as { url: string }[];
    assert.strictEqual(rows.length, 1, 'the one trimmed card');
  });

  for (let [name, filter] of Object.entries(filters)) {
    test(`${name}: measures are aggregates of the facet's own grouped statement`, async function (assert) {
      for (let facets of facetSets) {
        let expected = await counted(filter, facets, 60, true);
        assert.ok(Number(expected.total) > 0, 'the search matches cards');
        for (let size of [0, 7]) {
          let found = await counted(filter, facets, size);
          assert.false(
            facetsFromIndexRows(),
            `size ${size}: the facets' match set is the store's`,
          );
          assert.false(probesPerCard(), `size ${size}: no per-card probes`);
          assert.deepEqual(
            found,
            expected,
            `size ${size}: the general read's total, facets and measures`,
          );
        }
      }
    });
  }
});
