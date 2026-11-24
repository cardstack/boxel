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

// Facets of a match set the value store decides are counted from the
// store's rows at each facet's path, by the index's leading key, even when
// some card holds only a marker at or above a facet's path (its value is in
// its search doc, too long for search_keys, or trimmed by its budget): that
// facet reads that card's value from its search doc, and nothing else reads
// an index row. The counts are the general read's: the same search under a
// grant that admits every card, which the store's set does not answer,
// counts the same values.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const mod = `${testRealm}item`;
const itemRef = ref(mod, 'Item');

function field(fieldOrCard: ResolvedCodeRef, facet = false): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(fieldOrCard === numberRef ? { serializerName: 'number' } : {}),
    ...(facet ? { search: { facet: true } } : {}),
  } as FieldDefinition;
}
const itemFields = {
  cardTitle: field(stringRef),
  kind: field(stringRef, true),
  material: field(stringRef, true),
  status: field(stringRef, true),
  size: field(numberRef, true),
  notes: field(stringRef),
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

// 24 items in three kinds. i04's material is longer than search_keys keeps
// of a string (256 bytes); i10's fits, but i10's notes push its projection
// over the 3,000-byte budget, which trims its largest strings first, its
// material among them; i17 is open with a long material too.
const longMaterial = (i: number) => `oak ${'grain '.repeat(60)}${i}`;
const items = Array.from({ length: 24 }, (_, i) => ({
  name: `i${String(i).padStart(2, '0')}`,
  kind: ['chair', 'table', 'lamp'][i % 3],
  material:
    i === 4 || i === 17
      ? longMaterial(i)
      : i === 10
        ? `pine ${'p'.repeat(240)}`
        : ['oak', 'pine', 'steel', 'glass'][i % 4],
  status: i % 2 ? 'open' : 'closed',
  size: i % 5,
  notes:
    i === 10
      ? Array.from({ length: 14 }, (_, n) => `${n} ${'x'.repeat(200)}`)
      : undefined,
}));

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let engine: IndexQueryEngine;
  let statements: string[];

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    let virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
    let itemKey = internalKeyFor(itemRef, undefined, virtualNetwork);
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let item of items) {
      let url = `${testRealm}Item/${item.name}`;
      let { notes, ...data } = item;
      await batch.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module: rri(mod), name: 'Item' } },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData: {
          cardTitle: item.name,
          kind: data.kind,
          material: data.material,
          status: data.status,
          size: data.size,
          ...(notes
            ? Object.fromEntries(notes.map((note, n) => [`note${n}`, note]))
            : {}),
        },
        deps: new Set(),
        displayNames: ['Item'],
        types: [itemKey],
        isolatedHtml: `<div>${item.name}</div>`,
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

  const facets = [
    { by: 'kind', size: 100 },
    { by: 'material', size: 100 },
    { by: 'size', size: 100, stats: true },
  ];

  async function counted(query: Query, everyCard = false) {
    statements = [];
    let { results, meta } = await engine.search(
      new URL(testRealm),
      query,
      everyCard ? { grantFilter: { type: itemRef } } : {},
      { kind: 'dataOnly' },
      'all',
    );
    return {
      urls: results.map((r) => r.url),
      total: meta.page?.total,
      facets: meta.facets,
      facetStats: meta.facetStats,
    };
  }
  // A facet statement that reads index rows only for the search docs it
  // must: no match set read from `boxel_index AS i`.
  const fromStore = () =>
    statements.some(
      (sql) =>
        sql.includes('facet_paths') && !/FROM boxel_index AS i\b/.test(sql),
    );

  test('the store holds markers where the fixture means it to', async function (assert) {
    let rows = (await adapter.execute(
      `SELECT c.url, p.path FROM boxel_index_values AS v
         JOIN boxel_index_value_cards AS c ON c.id = v.card_id
         JOIN boxel_index_value_paths AS p ON p.id = v.path_id
        WHERE v.kind = 'm' AND p.path = 'material' ORDER BY c.url`,
    )) as { url: string; path: string }[];
    assert.deepEqual(
      rows.map((r) => r.url.replace(`${testRealm}Item/`, '')),
      ['i04.json', 'i10.json', 'i17.json'],
    );
  });

  for (let size of [0, 5]) {
    test(`a whole type's facets count a marked card from its search doc (page size ${size})`, async function (assert) {
      let query = {
        filter: { type: itemRef },
        facets,
        page: { size },
      } as unknown as Query;
      let found = await counted(query);
      assert.true(fromStore(), 'the facets were counted from the store');
      let expected = await counted(query, true);
      assert.deepEqual(found, expected, 'the general read’s counts');
      assert.strictEqual(
        found.facets?.material?.find((v) => v.value === longMaterial(4))?.count,
        1,
        'the long material is counted',
      );
    });

    test(`a filtered set counts only its own marked cards (page size ${size})`, async function (assert) {
      let query = {
        filter: {
          every: [{ type: itemRef }, { on: itemRef, eq: { status: 'open' } }],
        },
        facets,
        page: { size },
      } as unknown as Query;
      let found = await counted(query);
      assert.true(fromStore(), 'the facets were counted from the store');
      let expected = await counted(query, true);
      assert.deepEqual(found, expected, 'the general read’s counts');
      assert.ok(
        found.facets?.material?.some((v) => v.value === longMaterial(17)),
        'an open card’s long material is counted',
      );
      assert.notOk(
        found.facets?.material?.some((v) => v.value === longMaterial(4)),
        'a closed card’s is not',
      );
    });
  }

  test('a counts-only html search counts error cards from their search docs, as a paged one does', async function (assert) {
    let virtualNetwork = new VirtualNetwork();
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    for (let name of ['i07', 'i17']) {
      let url = `${testRealm}Item/${name}.json`;
      await batch.updateEntry(new URL(url), {
        type: 'instance-error',
        error: {
          id: url,
          status: 500,
          title: 'broken',
          message: 'a render that failed',
          additionalErrors: null,
          deps: [],
        },
        types: [internalKeyFor(itemRef, undefined, virtualNetwork)],
      });
    }
    await batch.done();
    let html = async (size: number) => {
      statements = [];
      let { meta } = await engine.search(
        new URL(testRealm),
        {
          filter: {
            every: [{ type: itemRef }, { on: itemRef, eq: { status: 'open' } }],
          },
          facets,
          page: { size },
        } as unknown as Query,
        { includeErrors: true },
        { kind: 'renderSet' },
        'all',
      );
      return {
        total: meta.page?.total,
        facets: meta.facets,
        facetStats: meta.facetStats,
      };
    };
    let countsOnly = await html(0);
    assert.true(
      statements.some((sql) => sql.includes('(-ROW_NUMBER() OVER ())')),
      'the error rows were read for their search docs',
    );
    assert.false(
      statements.some((sql) => sql.includes('live_keys')),
      'no match set joined the store’s cards back to their index rows',
    );
    assert.deepEqual(countsOnly, await html(24), 'the paged search’s counts');
    assert.strictEqual(countsOnly.total, 12, 'the error cards are counted');
  });

  test('a marker at a path a test reads leaves the set to the general read', async function (assert) {
    let query = {
      filter: {
        every: [
          { type: itemRef },
          { on: itemRef, eq: { material: longMaterial(4) } },
        ],
      },
      facets,
      page: { size: 0 },
    } as unknown as Query;
    let found = await counted(query);
    let expected = await counted(query, true);
    assert.deepEqual(found, expected);
    assert.strictEqual(found.total, 1);
  });
});
