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
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// A `cardTitle` sort reads the inline `title_sort` column, which the index
// writer fills at promotion with the text the sort read before
// (`spill_text(search_doc -> 'cardTitle')`), and which an index holds in
// order. These tests hold the column to that text, hold every title sort's
// answers to the order the old expression gives (both directions, either
// missing placement, ties, case, accents, no title), and hold a plain
// A-to-Z page to an index-ordered read with no Sort.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const stringRef = ref('@cardstack/base/string', 'default');
const noteRef = ref(`${testRealm}note`, 'Note');

const noteDef: Definition = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { cardTitle: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
      // a facet by it takes the page through the facet path
      search: { facet: true },
    },
  },
};

function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (codeRef.module === noteRef.module && codeRef.name === noteRef.name) {
        return noteDef;
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
  return lookup;
}

// Ties, case, accents, digits, an empty title, a JSON null and no title at
// all. `undefined` leaves the key out of the search doc.
const titles: Record<string, string | null | undefined> = {
  a1: 'Apple',
  a2: 'Apple',
  lower: 'apple',
  banana: 'banana',
  elan: 'Élan',
  eclair: 'eclair',
  eclairCap: 'Eclair',
  zebra: 'Zebra',
  ten: '10',
  nine: '9',
  empty: '',
  jsonNull: null,
  missing: undefined,
};

const url = (name: string) => `${testRealm}Note/${name}.json`;

async function stageNotes(
  adapter: PgAdapter,
  virtualNetwork: VirtualNetwork,
  names: string[],
) {
  let noteKey = internalKeyFor(noteRef, undefined, virtualNetwork);
  let batch = await new IndexWriter(adapter).createBatch(
    new URL(testRealm),
    virtualNetwork,
    undefined,
    { splitPrerenderHtml: false },
  );
  for (let name of names) {
    let cardURL = new URL(url(name));
    let title = titles[name];
    await batch.updateEntry(cardURL, {
      type: 'instance',
      resource: {
        id: rri(cardURL.href),
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: rri(noteRef.module), name: 'Note' } },
      },
      lastModified: Date.now(),
      resourceCreatedAt: Date.now(),
      searchData: title === undefined ? {} : { cardTitle: title },
      deps: new Set(),
      displayNames: ['Note'],
      types: [noteKey],
      isolatedHtml: `<div>${name}</div>`,
    });
  }
  return batch;
}

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let engine: IndexQueryEngine;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    engine = new IndexQueryEngine(
      adapter,
      makeDefinitionLookup(),
      virtualNetwork,
    );
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  async function ids(query: Query, opts = {}) {
    let { cards } = await engine.searchCards(new URL(testRealm), query, opts);
    return cards.map((card) => String(card.id));
  }

  // The order the sort gave before the column: the old expression, the same
  // NULLS rule and tiebreakers, in the database's collation.
  async function expressionOrder(direction: 'asc' | 'desc', missing: string) {
    let rows = (await adapter.execute(
      `SELECT pristine_doc ->> 'id' AS id FROM boxel_index
        WHERE realm_url = $1 AND type = 'instance'
        ORDER BY spill_text(search_doc -> 'cardTitle') ${direction.toUpperCase()}
          NULLS ${missing === 'first' ? 'FIRST' : 'LAST'},
          url COLLATE "POSIX", type`,
      { bind: [testRealm] },
    )) as { id: string }[];
    return rows.map((r) => r.id);
  }

  test('the index writer fills title_sort with the text a title sort reads', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    await batch.done();
    let rows = (await adapter.execute(
      `SELECT url, title_sort, spill_text(search_doc -> 'cardTitle') AS expr
         FROM boxel_index WHERE realm_url = $1 ORDER BY url`,
      { bind: [testRealm] },
    )) as { url: string; title_sort: string | null; expr: string | null }[];
    assert.strictEqual(rows.length, Object.keys(titles).length);
    for (let row of rows) {
      assert.strictEqual(row.title_sort, row.expr, `${row.url}`);
    }
    let byUrl = new Map(rows.map((r) => [r.url, r.title_sort]));
    assert.strictEqual(byUrl.get(url('elan')), 'Élan');
    assert.strictEqual(byUrl.get(url('empty')), '', 'an empty title is text');
    assert.strictEqual(byUrl.get(url('jsonNull')), null);
    assert.strictEqual(byUrl.get(url('missing')), null);
  });

  test('a rewritten title rewrites title_sort', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, ['a1']);
    await batch.done();
    titles.a1 = 'Avocado';
    try {
      let again = await stageNotes(adapter, virtualNetwork, ['a1']);
      await again.done();
    } finally {
      titles.a1 = 'Apple';
    }
    let [row] = (await adapter.execute(
      `SELECT title_sort FROM boxel_index WHERE url = $1`,
      { bind: [url('a1')] },
    )) as { title_sort: string }[];
    assert.strictEqual(row.title_sort, 'Avocado');
  });

  test('the migration backfills rows indexed before the column, past one batch', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    await batch.done();
    // More rows than one backfill batch (1,000), some with no title.
    await adapter.execute(
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified)
       SELECT b.url || '-' || g, b.file_alias || '-' || g, b.realm_url, b.generation, b.type, b.pristine_doc,
              CASE WHEN g % 7 = 0 THEN b.search_doc - 'cardTitle'
                   ELSE jsonb_set(b.search_doc, '{cardTitle}', to_jsonb('Note ' || g)) END,
              b.deps, b.types, b.is_deleted, b.has_error, b.indexed_at, b.last_modified
         FROM boxel_index AS b, generate_series(1, 2500) AS g
        WHERE b.url = $1`,
      { bind: [url('banana')] },
    );
    let migration = (await import(
      // @ts-ignore a CommonJS migration, required for its SQL
      '../../postgres/migrations/1794351846317_add-boxel-index-title-sort.js'
    )) as { up: Function; down: Function };
    let run = async (step: Function) => {
      let statements: string[] = [];
      step({
        noTransaction() {},
        sql: (sql: string) => statements.push(sql),
      });
      for (let sql of statements) {
        await adapter.execute(sql);
      }
    };
    // Down drops the column, as a database from before it had none; up adds
    // it back and backfills every row.
    await run(migration.down);
    await run(migration.up);
    let [counts] = (await adapter.execute(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE title_sort IS DISTINCT FROM spill_text(search_doc -> 'cardTitle'))::int AS wrong,
              count(title_sort)::int AS titled
         FROM boxel_index WHERE realm_url = $1`,
      { bind: [testRealm] },
    )) as { rows: number; wrong: number; titled: number }[];
    assert.strictEqual(counts.rows, Object.keys(titles).length + 2500);
    assert.strictEqual(counts.wrong, 0, 'every row holds the sort text');
    assert.true(counts.titled > 2000, 'the titled rows are filled');
    let [index] = (await adapter.execute(
      `SELECT i.indisvalid AS valid FROM pg_index AS i
         JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname = 'boxel_index_realm_title_sort_index'`,
    )) as { valid: boolean }[];
    assert.true(index?.valid, 'and the index is built');
  });

  test('title sorts answer as the expression did, on every path', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    await batch.done();
    for (let direction of ['asc', 'desc'] as const) {
      for (let missing of ['last', 'first']) {
        let expected = await expressionOrder(direction, missing);
        let sort = [
          {
            by: 'cardTitle',
            on: noteRef,
            direction,
            ...(missing === 'first' ? { missing: 'first' as const } : {}),
          },
        ];
        let label = `${direction}, missing ${missing}`;
        assert.deepEqual(
          await ids({ filter: { type: noteRef }, sort }),
          expected,
          `unpaged: ${label}`,
        );
        assert.deepEqual(
          await ids({ filter: { type: noteRef }, sort, page: { size: 25 } }),
          expected,
          `a plain page: ${label}`,
        );
        let paged: string[] = [];
        for (let number = 0; number < 5; number++) {
          paged.push(
            ...(await ids({
              filter: { type: noteRef },
              sort,
              page: { size: 3, number },
            })),
          );
        }
        assert.deepEqual(paged, expected, `page by page: ${label}`);
        assert.deepEqual(
          await ids({
            filter: { type: noteRef },
            sort,
            page: { size: 25 },
            facets: [{ by: 'cardTitle' }],
          }),
          expected,
          `a page with facets: ${label}`,
        );
      }
    }
  });

  test("a staged read sorts the pass's own rows by title", async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    let staged = await ids(
      {
        filter: { type: noteRef },
        sort: [{ by: 'cardTitle', on: noteRef }],
        page: { size: 25 },
      },
      { pendingStagingId: batch.stagingId },
    );
    await batch.done();
    assert.deepEqual(staged, await expressionOrder('asc', 'last'));
  });

  test('an A-to-Z page is read off the title index, with no Sort', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    await batch.done();
    // Enough notes that reading every match and sorting it costs more than
    // walking the index for a page.
    await adapter.execute(
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified, title_sort)
       SELECT b.url || '-' || g, b.file_alias || '-' || g, b.realm_url, b.generation, b.type, b.pristine_doc,
              jsonb_set(b.search_doc, '{cardTitle}', to_jsonb('Note ' || g)), b.deps, b.types, b.is_deleted, b.has_error, b.indexed_at, b.last_modified,
              'Note ' || g
         FROM boxel_index AS b, generate_series(1, 5000) AS g
        WHERE b.url = $1`,
      { bind: [url('banana')] },
    );
    await adapter.execute(`ANALYZE boxel_index`);

    let captured: { sql: string; bind: unknown[] }[] = [];
    let originalExecute = adapter.execute.bind(adapter);
    (adapter as any).execute = (sql: string, opts: any) => {
      captured.push({ sql, bind: opts?.bind ?? [] });
      return originalExecute(sql, opts);
    };
    let result: string[];
    try {
      result = await ids({
        filter: { type: noteRef },
        sort: [{ by: 'cardTitle', on: noteRef }],
        page: { size: 25 },
      });
    } finally {
      (adapter as any).execute = originalExecute;
    }
    assert.deepEqual(
      result,
      (await expressionOrder('asc', 'last')).slice(0, 25),
      'the page is the first 25 in the old order',
    );
    let keyPass = captured.find((c) => /LIMIT 26 OFFSET 0/.test(c.sql));
    assert.ok(keyPass, 'the page is a plain ordered LIMIT');
    assert.true(
      /ORDER BY title_sort ASC NULLS LAST/i.test(keyPass!.sql),
      `it orders by the column; got ${keyPass?.sql}`,
    );
    let plan = JSON.stringify(
      await adapter.execute(`EXPLAIN (FORMAT JSON) ${keyPass!.sql}`, {
        bind: keyPass!.bind as any,
      }),
    );
    assert.true(
      plan.includes('boxel_index_realm_title_sort_index'),
      `the page reads the title index; got ${plan}`,
    );
    assert.false(
      /"Node Type":"(Incremental )?Sort"/.test(plan),
      `and sorts nothing; got ${plan}`,
    );
  });
});
