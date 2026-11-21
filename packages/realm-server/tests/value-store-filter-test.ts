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

// A positive range test on a number field reads its candidates from the
// value store (value-store-filter.ts), and a search of a whole type counts
// its total from the store; the answers are the general read's.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
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
  status: field(stringRef),
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

// 30 notes, every fifth a SubNote; a few hold no score, one holds its score
// as text.
const notes = Array.from({ length: 30 }, (_, i) => ({
  name: `n${String(i).padStart(2, '0')}`,
  sub: i % 5 === 0,
  score: i % 11 === 10 ? undefined : i === 7 ? '7' : i % 9,
  status: i % 2 ? 'odd' : 'even',
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
          status: note.status,
          ...(note.score === undefined ? {} : { score: note.score }),
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

  async function ids(filter: Query['filter']) {
    statements = [];
    let { cards } = await engine.searchCards(new URL(testRealm), { filter });
    return cards.map((c) => String(c.id)).sort();
  }
  const urls = (keep: (n: (typeof notes)[number]) => boolean) =>
    notes
      .filter(keep)
      .map((n) => `${testRealm}Note/${n.name}`)
      .sort();
  const narrowed = () => statements.some((sql) => sql.includes('v.num >='));

  test('a range filter on a number field reads its candidates from the store', async function (assert) {
    let between = (n: (typeof notes)[number]) =>
      n.score !== undefined && Number(n.score) >= 3 && Number(n.score) < 8;
    assert.deepEqual(
      await ids({
        every: [
          { type: noteRef },
          { on: noteRef, range: { score: { gte: 3, lt: 8 } } },
        ],
      }),
      urls(between),
      'the matches, the text-held score among them',
    );
    assert.true(narrowed(), 'the store narrowed the test');
    assert.deepEqual(
      await ids({
        every: [
          { type: noteRef },
          { not: { on: noteRef, range: { score: { gte: 3, lt: 8 } } } },
        ],
      }),
      urls((n) => n.score !== undefined && !between(n)),
      'a negated range is not narrowed: a card with no score matches neither',
    );
    assert.false(narrowed());
  });

  test('a whole type is counted from the store', async function (assert) {
    statements = [];
    let { meta } = await engine.searchCards(new URL(testRealm), {
      filter: { type: noteRef },
      page: { size: 0 },
    });
    assert.strictEqual(meta.page.total, notes.length);
    assert.true(
      statements.some((sql) => sql.includes("v.kind = 'c'")),
      'the count read the store',
    );
    statements = [];
    let sub = await engine.searchCards(new URL(testRealm), {
      filter: { type: subRef },
      page: { size: 2 },
    });
    assert.strictEqual(sub.meta.page.total, notes.filter((n) => n.sub).length);
    assert.true(statements.some((sql) => sql.includes("v.kind = 'c'")));
  });
});
