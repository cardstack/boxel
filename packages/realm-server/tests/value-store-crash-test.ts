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

// The value store is UNLOGGED, as its source `boxel_index` is, so a crash
// empties both: pages, totals and facets then agree that the realm is empty.
// A rebuild of the whole realm takes out the rows of a card it no longer
// produces, which a crash leaves with no tombstone, and of any other card the
// index does not hold live.

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
  let vn: VirtualNetwork;
  let rebuild: (names: string[]) => Promise<void>;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    let virtualNetwork = new VirtualNetwork();
    vn = virtualNetwork;
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
    rebuild = async (names: string[]) => {
      let b2 = await new IndexWriter(adapter).createBatch(
        new URL(testRealm),
        vn,
        undefined,
        { splitPrerenderHtml: false },
      );
      let w2 = async (
        url: string,
        codeRef: ResolvedCodeRef,
        searchData: Record<string, unknown>,
      ) =>
        await b2.updateEntry(new URL(`${url}.json`), {
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
          types: [internalKeyFor(codeRef, undefined, vn)],
          isolatedHtml: '<div></div>',
        });
      await w2(ada, personRef, { cardTitle: 'Ada' });
      for (let name of names)
        await w2(`${testRealm}Note/${name}`, noteRef, notes[name]);
      await b2.done({ fullRealm: true });
    };
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

  async function observe() {
    let found = await meta({
      filter: { type: noteRef },
      page: { size: 0 },
      facets: [{ by: 'status' }],
    } as Query);
    let page = await engine.searchCards(new URL(testRealm), {
      filter: { type: noteRef },
      sort: [{ by: 'score', on: noteRef, direction: 'asc' }],
      page: { size: 10, total: 'exact' },
    } as Query);
    return {
      facets: found.facets?.status ?? [],
      total: found.page?.total,
      page: page.cards.map((c) => String(c.id)),
      pageTotal: page.meta.page?.total,
    };
  }

  async function valueRowsOf(url: string) {
    let [row] = (await adapter.execute(
      "SELECT count(*)::int AS n FROM boxel_index_values v JOIN boxel_index_value_cards c ON c.id = v.card_id WHERE c.realm_url = $1 AND c.url IN ($2::text, $2::text || '.json')",
      { bind: [testRealm, url] },
    )) as { n: number }[];
    return row.n;
  }

  // What crash recovery does: every UNLOGGED table is emptied, every logged
  // one kept.
  async function crash() {
    let unlogged = (
      await adapter.execute(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relpersistence = 'u'",
      )
    ).map((r) => String(r.relname));
    await adapter.execute(
      `TRUNCATE ${unlogged.map((t) => `"${t}"`).join(', ')}`,
    );
  }

  test('the value store and its dictionaries are UNLOGGED, as boxel_index is', async function (assert) {
    let rows = (await adapter.execute(
      "SELECT relname, relpersistence FROM pg_class WHERE relkind = 'r' AND relname IN ('boxel_index', 'boxel_index_values', 'boxel_index_value_cards', 'boxel_index_value_paths', 'boxel_index_value_types', 'boxel_index_value_realms') ORDER BY relname",
    )) as { relname: string; relpersistence: string }[];
    assert.deepEqual(
      rows.map((r) => [r.relname, r.relpersistence]),
      [
        ['boxel_index', 'u'],
        ['boxel_index_value_cards', 'u'],
        ['boxel_index_value_paths', 'u'],
        ['boxel_index_value_realms', 'u'],
        ['boxel_index_value_types', 'u'],
        ['boxel_index_values', 'u'],
      ],
    );
  });

  test('after a crash empties the index, pages, totals and facets agree', async function (assert) {
    let before = await observe();
    assert.strictEqual(before.total, 3, 'three notes indexed');
    assert.strictEqual(before.page.length, 3);
    await crash();
    let after = await observe();
    assert.deepEqual(after.facets, [], 'no facet counts a card the index lost');
    assert.strictEqual(after.total, 0, 'the total is the empty index');
    assert.deepEqual(after.page, [], 'and so is the page');
    assert.strictEqual(after.pageTotal, 0);
  });

  test('a rebuild after a crash leaves nothing of a card it no longer produces', async function (assert) {
    assert.true(
      (await valueRowsOf(`${testRealm}Note/three`)) > 0,
      'the store holds the note before the crash',
    );
    await crash();
    await rebuild(['one', 'two']);
    let after = await observe();
    assert.deepEqual(after.page, [
      `${testRealm}Note/one`,
      `${testRealm}Note/two`,
    ]);
    assert.strictEqual(after.total, 2, 'the facet total is the two notes');
    assert.deepEqual(after.facets, [{ value: 'open', count: 2 }]);
    assert.strictEqual(
      await valueRowsOf(`${testRealm}Note/three`),
      0,
      'no value row of the vanished note remains',
    );
  });

  test('a rebuild of the whole realm takes out value rows its index does not hold live, with no crash', async function (assert) {
    // Drift with no crash: the index loses a card's row and nothing else.
    await adapter.execute(
      "DELETE FROM boxel_index WHERE realm_url = $1 AND url IN ($2::text, $2::text || '.json')",
      { bind: [testRealm, `${testRealm}Note/three`] },
    );
    assert.true(
      (await valueRowsOf(`${testRealm}Note/three`)) > 0,
      'the store still holds it',
    );
    await rebuild(['one', 'two']);
    assert.strictEqual(
      await valueRowsOf(`${testRealm}Note/three`),
      0,
      'the rebuild took its rows out',
    );
    assert.deepEqual((await observe()).facets, [{ value: 'open', count: 2 }]);
  });
});
