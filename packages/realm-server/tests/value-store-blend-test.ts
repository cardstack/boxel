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

// A page sorted by one blend reads its scores from the value store
// (store-blend.ts) when the store holds every part of the query; the page,
// its scores and its total are the general read's. The general read is
// asked the same question through a filter the store does not decide (an
// `any` of one branch), which admits the same cards.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const booleanRef = ref('@cardstack/base/boolean', 'default');
const mod = `${testRealm}note`;
const noteRef = ref(mod, 'Note');
const subRef = ref(mod, 'SubNote');

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
    ...(fieldOrCard === booleanRef ? { serializerName: 'boolean' } : {}),
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
const noteFields = {
  cardTitle: field(stringRef),
  score: field(numberRef),
  likes: field(numberRef),
  label: field(stringRef),
  status: field(stringRef),
  hidden: field(booleanRef),
};
const noteDef = def(noteRef, noteFields);
const subDef = def(subRef, noteFields);

function makeDefinitionLookup(): DefinitionLookup {
  let lookupDefinition = async (codeRef: CodeRef) => {
    if ('name' in codeRef && 'module' in codeRef && codeRef.module === mod) {
      if (codeRef.name === 'Note') return noteDef;
      if (codeRef.name === 'SubNote') return subDef;
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

// 60 notes, every fifth a SubNote. Scores tie in fours, a few are missing
// and one is held as text; labels mix case (the database's collation and
// byte order disagree on them); a few notes have no status or no label.
const words = ['apple', 'Banana', 'cherry', 'Date', 'elder', 'Fig'];
const notes = Array.from({ length: 60 }, (_, i) => ({
  name: `n${String(i).padStart(2, '0')}`,
  sub: i % 5 === 0,
  score: i % 13 === 12 ? undefined : i === 7 ? '3' : i % 4,
  likes: i % 7 === 3 ? undefined : (i * 7) % 11,
  label: i % 17 === 16 ? undefined : words[i % words.length],
  status: i % 19 === 18 ? undefined : i % 3 === 0 ? 'draft' : 'live',
  hidden: i % 10 === 9,
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
    let batch = await new IndexWriter(adapter).createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let noteKey = internalKeyFor(noteRef, undefined, virtualNetwork);
    let subKey = internalKeyFor(subRef, undefined, virtualNetwork);
    for (let note of notes) {
      let url = `${testRealm}Note/${note.name}`;
      let codeRef = note.sub ? subRef : noteRef;
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
        searchData: {
          cardTitle: note.name,
          hidden: note.hidden,
          ...(note.score === undefined ? {} : { score: note.score }),
          ...(note.likes === undefined ? {} : { likes: note.likes }),
          ...(note.label === undefined ? {} : { label: note.label }),
          ...(note.status === undefined ? {} : { status: note.status }),
        },
        deps: new Set(),
        displayNames: [codeRef.name],
        types: note.sub ? [subKey, noteKey] : [noteKey],
        isolatedHtml: '<div></div>',
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

  const fromStore = () =>
    statements.some((sql) => sql.includes('WITH x AS MATERIALIZED'));

  async function page(query: Query) {
    statements = [];
    let { results, meta } = await engine.search(
      new URL(testRealm),
      query,
      {},
      {
        kind: 'dataOnly',
      },
    );
    let rows = results as Record<string, unknown>[];
    return {
      ids: rows.map((r) => String(r.url)),
      scores: rows.map((r) => Number(r._blendScore)),
      sizes: rows.map((r) => r._collapseSize ?? null),
      total: meta.page.total,
      store: fromStore(),
    };
  }

  // The query as asked, and through the general read.
  async function compare(assert: Assert, query: Query, label: string) {
    let store = await page(query);
    let general = await page({
      ...query,
      filter: { any: [query.filter!] },
    } as Query);
    assert.true(store.store, `${label}: the store answered`);
    assert.false(general.store, `${label}: the general read answered`);
    assert.deepEqual(store.ids, general.ids, `${label}: the same page`);
    assert.deepEqual(store.scores, general.scores, `${label}: the same scores`);
    assert.deepEqual(store.sizes, general.sizes, `${label}: the same groups`);
    assert.strictEqual(store.total, general.total, `${label}: the same total`);
  }

  // The fields a filter tests are read on its type (`on`), as any query
  // names them.
  const notHidden = {
    on: noteRef,
    every: [{ not: { eq: { hidden: true } } }],
  } as Query['filter'];

  test('a blend of number fields ranks from the store, ties and missing values as the general read', async function (assert) {
    for (let [size, number] of [
      [5, 0],
      [7, 2],
      [50, 0],
      [9, 6],
    ]) {
      await compare(
        assert,
        {
          filter: notHidden,
          sort: [
            {
              blend: [
                { by: 'score', on: noteRef, weight: 2 },
                { by: 'likes', on: noteRef, direction: 'asc' },
              ],
              k: 10,
            },
          ],
          page: { size, number },
        } as unknown as Query,
        `page ${number} of ${size}`,
      );
    }
  });

  test('a text signal ranks in the database collation, and a negative weight inverts a signal', async function (assert) {
    await compare(
      assert,
      {
        filter: {
          on: noteRef,
          every: [{ not: { in: { status: ['draft'] } } }],
        },
        sort: [
          {
            blend: [
              { by: 'label', on: noteRef, direction: 'asc' },
              { by: 'score', on: noteRef, weight: -1 },
            ],
          },
        ],
        page: { size: 12 },
      } as unknown as Query,
      'label and inverted score',
    );
  });

  test('a boost and a collapse read from the store', async function (assert) {
    await compare(
      assert,
      {
        filter: notHidden,
        sort: [
          {
            blend: [
              { by: 'score', on: noteRef },
              {
                boost: { on: noteRef, in: { label: ['apple', 'Fig'] } },
                weight: 2,
              },
            ],
          },
        ],
        collapse: { by: 'label', on: noteRef, keep: 2 },
        page: { size: 5, number: 1 },
      } as unknown as Query,
      'boost and collapse',
    );
  });

  test('a negated type test reads from the store', async function (assert) {
    await compare(
      assert,
      {
        filter: { every: [{ type: noteRef }, { not: { type: subRef } }] },
        sort: [{ blend: [{ by: 'likes', on: noteRef }] }],
        page: { size: 10 },
      } as unknown as Query,
      'notes that are not sub-notes',
    );
  });
});
