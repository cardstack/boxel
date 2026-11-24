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
import type { Query } from '@cardstack/runtime-common/query-v2/query';

import {
  resetSearchBoundsForTests,
  setSearchBoundsForTests,
} from '@cardstack/runtime-common/query-v2/search-bounds';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A full-text term that is a conjunct of the filter has its candidates
// narrowed by the value store (store-narrow.ts) before their rows are read:
// the page and total are the general read's. The general read is asked the
// same question with the term inside a nested `every`, which the engine
// does not narrow and which admits the same cards.

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

// 40 notes, every fifth a SubNote, every seventh hidden, every fourth a
// draft. Most mention a lamp on their page; every sixth does not. No field
// holds the word. Each note's label is in its searchable text: every third
// is a shade.
const notes = Array.from({ length: 40 }, (_, i) => ({
  name: `n${String(i).padStart(2, '0')}`,
  sub: i % 5 === 0,
  hidden: i % 7 === 6,
  label: i % 3 === 0 ? 'shade' : 'chair',
  status: i % 4 === 0 ? 'draft' : 'live',
  page: i % 6 === 5 ? `Note ${i}: a chair.` : `Note ${i}: a brass lamp.`,
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
          label: note.label,
          status: note.status,
          _searchText: { A: note.name, C: note.label },
        },
        markdown: note.page,
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
    resetSearchBoundsForTests();
    await closeTestPgAdapter(adapter);
  });

  const narrowed = () => statements.some((sql) => sql.includes('AS sc WHERE'));

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
    return {
      ids: (results as Record<string, unknown>[]).map((r) => String(r.url)),
      total: meta.page.total,
      flagged: (meta.warnings ?? []).some((w) => w.code === 'total-estimated'),
      narrowed: narrowed(),
    };
  }

  // The filter as asked, and with its term nested where nothing narrows it.
  async function compare(
    assert: Assert,
    every: object[],
    term: object,
    label: string,
    rest: Partial<Query> = {},
  ) {
    let store = await page({
      filter: { on: noteRef, every: [...every, term] },
      page: { size: 50 },
      ...rest,
    } as unknown as Query);
    let general = await page({
      filter: { on: noteRef, every: [...every, { every: [term] }] },
      page: { size: 50 },
      ...rest,
    } as unknown as Query);
    assert.true(store.narrowed, `${label}: the store narrowed the term`);
    assert.false(
      general.narrowed,
      `${label}: nothing narrowed the nested term`,
    );
    assert.deepEqual(store.ids, general.ids, `${label}: the same rows`);
    assert.strictEqual(store.total, general.total, `${label}: the same total`);
    assert.strictEqual(
      store.flagged,
      general.flagged,
      `${label}: the same flag`,
    );
    return store;
  }

  test('a term beside type and negated tests reads only the candidates the store keeps', async function (assert) {
    let got = await compare(
      assert,
      [
        { not: { eq: { hidden: true } } },
        { not: { type: subRef } },
        { not: { in: { status: ['draft'] } } },
      ],
      { matches: 'lamp' },
      'type and negated tests',
    );
    let expected = notes.filter(
      (n) =>
        !n.hidden && !n.sub && n.status !== 'draft' && n.page.includes('lamp'),
    );
    assert.strictEqual(got.total, expected.length, 'the matches, worked out');
  });

  test('a broad term is narrowed the same way, and keeps its flag', async function (assert) {
    setSearchBoundsForTests({ matchCandidateCap: 3 });
    // A third of the notes hold 'shade' in their fields: more than the cap.
    let got = await compare(
      assert,
      [{ not: { eq: { hidden: true } } }],
      { matches: 'shade' },
      'a capped term',
      { sort: [{ by: '_matchRelevance', direction: 'desc' }] },
    );
    assert.true(got.flagged, 'the term is broad');
  });

  test('a term only on rendered pages is not broad, and its total is exact', async function (assert) {
    // The broad probe counts the cards whose fields hold the term. No field
    // holds 'lamp', so the cap does not reach it, however many pages do.
    setSearchBoundsForTests({ matchCandidateCap: 3 });
    let got = await compare(
      assert,
      [{ not: { eq: { hidden: true } } }],
      { matches: 'lamp' },
      'a term on pages',
      { sort: [{ by: '_matchRelevance', direction: 'desc' }] },
    );
    assert.false(got.flagged, 'the term is not broad');
    assert.strictEqual(
      got.total,
      notes.filter((n) => !n.hidden && n.page.includes('lamp')).length,
      'every match is counted',
    );
  });

  test('a term under not, or in an any, is not narrowed', async function (assert) {
    let negated = await page({
      filter: {
        on: noteRef,
        every: [
          { not: { eq: { hidden: true } } },
          { not: { matches: 'lamp' } },
        ],
      },
      page: { size: 50 },
    } as unknown as Query);
    assert.false(negated.narrowed, 'a negated term is not narrowed');
    assert.deepEqual(
      negated.ids.sort(),
      notes
        .filter((n) => !n.hidden && !n.page.includes('lamp'))
        .map((n) => `${testRealm}Note/${n.name}.json`)
        .sort(),
      'the cards whose page does not hold it',
    );
  });
});
