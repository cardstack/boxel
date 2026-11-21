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
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A search counts its facets in one statement over one materialized match
// set, reading each declared field's values from the value store
// (`boxel_index_values`), and reading a card's search doc where the store
// holds only a marker for the field (a value the hot column trimmed).

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const mod = `${testRealm}note`;
const noteRef = ref(mod, 'Note');
const personRef = ref(mod, 'Person');
const facet = { search: { facet: true } };

function field(
  fieldOrCard: ResolvedCodeRef,
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return {
    type: 'contains',
    isPrimitive: true,
    isComputed: false,
    fieldOrCard,
    ...(fieldOrCard === numberRef ? { serializerName: 'number' } : {}),
    ...extra,
  } as FieldDefinition;
}
function def(
  codeRef: ResolvedCodeRef,
  fields: Record<string, FieldDefinition>,
): Definition {
  let names: Record<string, string> = {};
  let defs: Record<string, FieldDefinition> = {};
  Object.entries(fields).forEach(([name, f], i) => {
    names[name] = `f${i}`;
    defs[`f${i}`] = f;
  });
  return {
    type: 'card-def',
    codeRef,
    displayName: codeRef.name,
    fields: names,
    fieldDefs: defs,
  } as Definition;
}
const personDef = def(personRef, { cardTitle: field(stringRef) });
const noteDef = def(noteRef, {
  cardTitle: field(stringRef),
  tags: field(stringRef, { type: 'containsMany', ...facet }),
  score: field(numberRef, facet),
  status: field(stringRef, facet),
  author: {
    type: 'linksTo',
    isPrimitive: false,
    isComputed: false,
    fieldOrCard: personRef,
    ...facet,
  } as FieldDefinition,
});

function makeDefinitionLookup(): DefinitionLookup {
  let lookupDefinition = async (codeRef: CodeRef) => {
    if ('name' in codeRef && 'module' in codeRef && codeRef.module === mod) {
      if (codeRef.name === 'Note') return noteDef;
      if (codeRef.name === 'Person') return personDef;
    }
    throw new Error(`unexpected definition lookup: ${JSON.stringify(codeRef)}`);
  };
  const lookup = {
    lookupDefinition,
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// More than the hot column keeps of a list (512 bytes of JSON): the store
// holds a marker at `tags` for the card that holds it.
const longTags = Array.from(
  { length: 30 },
  (_, i) => `a-rather-long-tag-${String(i).padStart(2, '0')}`,
);
const ada = `${testRealm}Person/ada`;
const notes: Record<string, Record<string, unknown>> = {
  one: {
    cardTitle: 'One',
    tags: ['red', 'blue'],
    score: 1,
    status: 'open',
    author: { id: ada },
  },
  two: {
    cardTitle: 'Two',
    tags: ['red', ...longTags],
    score: 2,
    status: 'open',
  },
  three: { cardTitle: 'Three', tags: ['blue'], status: 'closed' },
};

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
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let write = async (
      url: string,
      codeRef: ResolvedCodeRef,
      searchData: Record<string, unknown>,
    ) =>
      await batch.updateEntry(new URL(`${url}.json`), {
        type: 'instance',
        resource: {
          id: rri(url),
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: { module: rri(codeRef.module), name: codeRef.name },
          },
        },
        lastModified: Date.now(),
        resourceCreatedAt: Date.now(),
        searchData,
        deps: new Set(),
        displayNames: [codeRef.name],
        types: [internalKeyFor(codeRef, undefined, virtualNetwork)],
        isolatedHtml: '<div></div>',
      });
    await write(ada, personRef, { cardTitle: 'Ada' });
    for (let [name, data] of Object.entries(notes)) {
      await write(`${testRealm}Note/${name}`, noteRef, data);
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

  async function meta(query: Query) {
    return (await engine.searchCards(new URL(testRealm), query)).meta;
  }
  const facetStatements = () =>
    statements.filter((sql) => /facet_keys_0/.test(sql)).length;

  test("a search's facets are counted in one statement over one match set", async function (assert) {
    let found = await meta({
      filter: {
        every: [{ type: noteRef }, { on: noteRef, eq: { status: 'open' } }],
      },
      facets: [
        { by: 'status', own: 'ignore' },
        { by: 'tags', size: 2 },
        { by: 'score', stats: true, missing: true },
      ],
    });
    assert.strictEqual(facetStatements(), 1, 'one facet statement');
    assert.deepEqual(found.facets?.status, [
      { value: 'open', count: 2 },
      { value: 'closed', count: 1 },
    ]);
    assert.deepEqual(found.facets?.tags, [
      { value: 'red', count: 2 },
      { value: 'a-rather-long-tag-00', count: 1 },
    ]);
    assert.deepEqual(found.facetStats?.score, {
      count: 2,
      distinct: 2,
      values: 2,
      min: 1,
      max: 2,
      sum: 3,
      avg: 1.5,
      missing: 0,
      order: 'count',
    });
  });
  test('a value the hot column trimmed is read from the search doc', async function (assert) {
    let [marked] = (await adapter.execute(
      `SELECT count(*)::int AS n FROM boxel_index_values AS v JOIN boxel_index_value_paths AS p ON p.id = v.path_id WHERE p.path = 'tags' AND v.kind = 'm'`,
    )) as { n: number }[];
    assert.strictEqual(marked.n, 1, 'the store holds a marker for one card');
    let found = await meta({
      filter: { type: noteRef },
      facets: [{ by: 'tags', size: 100, stats: true }],
    });
    assert.strictEqual(found.facets?.tags?.length, 32, 'every tag counts');
    assert.deepEqual(found.facets?.tags?.slice(0, 2), [
      { value: 'blue', count: 2 },
      { value: 'red', count: 2 },
    ]);
    assert.strictEqual(found.facetStats?.tags?.count, 3);
  });

  test('links, measures and missing values read from the store', async function (assert) {
    let found = await meta({
      filter: { type: noteRef },
      facets: [
        { by: 'author', missing: true },
        { by: 'status', measure: { sum: 'score' }, order: 'measure' },
      ],
    });
    assert.deepEqual(found.facets?.author, [
      { value: ada, count: 1, label: 'Ada' },
    ]);
    assert.strictEqual(found.facetStats?.author?.missing, 2);
    assert.deepEqual(found.facets?.status, [
      { value: 'open', count: 2, measure: { sum: 3 } },
      { value: 'closed', count: 1 },
    ]);
  });
});
