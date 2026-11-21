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

// A plain page sorted by a number field reads its keys off the value store's
// number index (value-store-order.ts) when the condition fills the page soon
// enough, and the general way otherwise; the page is the same either way.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const stringRef = ref('@cardstack/base/string', 'default');
const numberRef = ref('@cardstack/base/number', 'default');
const dateRef = ref('@cardstack/base/date', 'default');
const dateTimeRef = ref('@cardstack/base/datetime', 'default');
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
  day: field(dateRef, { serializerName: 'date' }),
  status: field(stringRef),
  at: field(dateTimeRef, { serializerName: 'datetime' }),
  due: field(dateRef, { serializerName: 'date' }),
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

// 40 notes, every fifth a SubNote: scores tie in groups of five, and a few
// have no score.
const notes = Array.from({ length: 40 }, (_, i) => ({
  name: `n${String(i).padStart(2, '0')}`,
  sub: i % 5 === 0,
  score: i % 13 === 12 ? undefined : i % 8,
  status: i === 3 ? 'rare' : i % 2 ? 'odd' : 'even',
  // Days tie in threes; one is text that is no day, a few have none.
  day:
    i === 17
      ? 'soon'
      : i % 10 === 9
        ? undefined
        : `2026-0${1 + (Math.floor(i / 3) % 9)}-${String(10 + (i % 4)).padStart(2, '0')}`,
  // A date-time mostly to the minute, mixed with other forms: a day (the
  // instant of its midnight), an offset whose text sorts on one day and
  // whose instant falls on the next, seconds; one has none.
  at:
    i === 29
      ? undefined
      : i === 11
        ? '2026-01-10T23:59-12:00'
        : i === 22
          ? '2026-01-10T00:00:30'
          : i % 7 === 3
            ? `2026-0${1 + (Math.floor(i / 4) % 3)}-1${i % 3}`
            : `2026-0${1 + (Math.floor(i / 4) % 3)}-1${i % 3}T0${i % 2 ? 0 : 9}:${i % 4 < 2 ? '00' : '30'}`,
  // A date mostly a day, a few to the minute (one at the midnight of a day
  // other cards hold).
  due:
    i % 6 === 1
      ? `2026-0${1 + (Math.floor(i / 5) % 4)}-0${1 + (i % 3)}T${i % 4 === 1 ? '00:00' : '12:00'}`
      : `2026-0${1 + (Math.floor(i / 5) % 4)}-0${1 + (i % 3)}`,
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
          ...(note.day === undefined ? {} : { day: note.day }),
          ...(note.at === undefined ? {} : { at: note.at }),
          due: note.due,
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

  // The page as the query's order defines it: by score (missing last), then
  // by url.
  function expected(
    direction: 'asc' | 'desc',
    keep: (n: (typeof notes)[number]) => boolean,
    offset: number,
    size: number,
  ) {
    return notes
      .filter(keep)
      .sort((a, b) =>
        a.score === b.score
          ? a.name < b.name
            ? -1
            : 1
          : a.score === undefined
            ? 1
            : b.score === undefined
              ? -1
              : direction === 'desc'
                ? b.score - a.score
                : a.score - b.score,
      )
      .slice(offset, offset + size)
      .map((n) => `${testRealm}Note/${n.name}.json`);
  }
  async function page(
    direction: 'asc' | 'desc',
    filter: Query['filter'],
    number: number,
    size: number,
  ) {
    statements = [];
    let { cards, meta } = await engine.searchCards(new URL(testRealm), {
      filter,
      sort: [{ by: 'score', on: noteRef, direction }],
      page: { number, size },
    });
    return {
      ids: cards.map((c) => `${c.id}.json`),
      total: meta.page.total,
      ordered: statements.some((sql) => sql.includes('walked AS MATERIALIZED')),
      general: statements.some((sql) =>
        /^\s*SELECT (h\.\*|i\.url AS url, i\.type AS type\b)/.test(sql),
      ),
    };
  }

  test('a page sorted by a number field is read off the store, ties and types merged', async function (assert) {
    for (let [direction, number, size] of [
      ['desc', 0, 7],
      ['desc', 2, 7],
      ['asc', 0, 12],
      ['asc', 1, 5],
    ] as const) {
      let found = await page(direction, { type: noteRef }, number, size);
      assert.deepEqual(
        found.ids,
        expected(direction, () => true, number * size, size),
        `${direction} page ${number} of ${size}`,
      );
      assert.true(found.ordered, 'the ordered read ran');
      assert.false(found.general, 'and answered the page');
      assert.strictEqual(found.total, notes.length);
    }
  });

  test('a condition the walk cannot fill the page from reads the general way', async function (assert) {
    let found = await page(
      'desc',
      // A filter the search doc's index does not serve, so the page is not
      // read filter-first.
      {
        every: [
          { type: noteRef },
          { on: noteRef, contains: { cardTitle: 'n03' } },
        ],
      },
      0,
      5,
    );
    assert.deepEqual(
      found.ids,
      expected('desc', (n) => n.name === 'n03', 0, 5),
    );
    assert.true(found.ordered, 'the ordered read was tried');
    assert.true(found.general, 'and gave the page to the general read');
    let past = await page('desc', { type: noteRef }, 6, 6);
    assert.deepEqual(
      past.ids,
      expected('desc', () => true, 36, 6),
      'a page reaching the cards with no score',
    );
    assert.true(past.general);
  });
  test('a page sorted by a date field is read off the instant index', async function (assert) {
    // The query orders a date by its text; for a calendar day that is its
    // day's order, and text that is no day sorts among them as text.
    let order = (direction: 'asc' | 'desc', offset: number, size: number) =>
      [...notes]
        .sort((a, b) =>
          a.day === b.day
            ? a.name < b.name
              ? -1
              : 1
            : a.day === undefined
              ? 1
              : b.day === undefined
                ? -1
                : (a.day < b.day ? -1 : 1) * (direction === 'desc' ? -1 : 1),
        )
        .slice(offset, offset + size)
        .map((n) => `${testRealm}Note/${n.name}.json`);
    for (let [direction, number, size] of [
      ['desc', 0, 6],
      ['asc', 1, 7],
      ['asc', 0, 4],
    ] as const) {
      statements = [];
      let { cards } = await engine.searchCards(new URL(testRealm), {
        filter: { type: noteRef },
        sort: [{ by: 'day', on: noteRef, direction }],
        page: { number, size },
      });
      assert.deepEqual(
        cards.map((c) => `${c.id}.json`),
        order(direction, number * size, size),
        `${direction} page ${number} of ${size}`,
      );
      assert.true(
        statements.some((sql) => sql.includes('walked AS MATERIALIZED')),
        'the ordered read ran',
      );
      assert.false(
        statements.some((sql) =>
          /^\s*SELECT (h\.\*|i\.url AS url, i\.type AS type\b)/.test(sql),
        ),
        'and answered the page',
      );
    }
  });

  // The page of a sort by a date or date-time field, in the order the
  // database's collation gives the field's text (missing last), ties by url.
  async function textOrder(
    field: 'at' | 'due',
    direction: 'asc' | 'desc',
    offset: number,
    size: number,
  ) {
    let values = notes
      .map(
        (n) =>
          `('${n.name}', ${n[field] === undefined ? 'NULL' : `'${n[field]}'`})`,
      )
      .join(', ');
    let rows = (await adapter.execute(
      `SELECT v.n FROM (VALUES ${values}) AS v (n, t) ORDER BY v.t ${direction} NULLS LAST, v.n LIMIT ${size} OFFSET ${offset}`,
    )) as { n: string }[];
    return rows.map((r) => `${testRealm}Note/${r.n}.json`);
  }

  test('a date-time walks its one fixed form; other forms are candidates', async function (assert) {
    // A day, an offset and seconds in a date-time field (the offset's text
    // comes first on its day, its instant on the next), and minutes in a
    // date field (a midnight ties its day's instant, its text after it).
    for (let field of ['at', 'due'] as const) {
      for (let [direction, number, size] of [
        ['asc', 0, 5],
        ['asc', 1, 6],
        ['desc', 0, 5],
        ['desc', 2, 4],
        ['asc', 0, 12],
      ] as const) {
        let want = await textOrder(field, direction, number * size, size);
        statements = [];
        let { cards } = await engine.searchCards(new URL(testRealm), {
          filter: { type: noteRef },
          sort: [{ by: field, on: noteRef, direction }],
          page: { number, size },
        });
        let label = `${field} ${direction} page ${number} of ${size}`;
        assert.deepEqual(
          cards.map((c) => `${c.id}.json`),
          want,
          label,
        );
        assert.true(
          statements.some((sql) => sql.includes('walked AS MATERIALIZED')),
          `${label}: the ordered read ran`,
        );
        assert.false(
          statements.some((sql) =>
            /^\s*SELECT (h\.\*|i\.url AS url, i\.type AS type\b)/.test(sql),
          ),
          `${label}: and answered the page`,
        );
      }
    }
  });
});
