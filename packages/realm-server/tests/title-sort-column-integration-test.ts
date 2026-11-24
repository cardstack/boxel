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
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';
import { syncSeededValueStore } from './helpers/seed-index-rows.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';

// A `cardTitle` sort reads `title_sort`, a column Postgres generates from
// `search_doc ->> 'cardTitle'`, which an index holds in order. These tests
// hold the column to that expression, hold every title sort's answers to the
// order the expression gives (both directions, either missing placement,
// ties, case, accents, no title), and hold a plain A-to-Z page to an
// index-ordered read with no Sort.

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
  return definitionLookupOf((codeRef) => {
    if (codeRef.module === noteRef.module && codeRef.name === noteRef.name) {
      return noteDef;
    }
    throw new Error(
      `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
    );
  });
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

  // The order a title sort gives: the expression, the same NULLS rule and
  // tiebreakers, in the database's collation.
  async function expressionOrder(direction: 'asc' | 'desc', missing: string) {
    let rows = (await adapter.execute(
      `SELECT pristine_doc ->> 'id' AS id FROM boxel_index
        WHERE realm_url = $1 AND type = 'instance'
        ORDER BY search_doc ->> 'cardTitle' ${direction.toUpperCase()}
          NULLS ${missing === 'first' ? 'FIRST' : 'LAST'},
          url COLLATE "POSIX", type`,
      { bind: [testRealm] },
    )) as { id: string }[];
    return rows.map((r) => r.id);
  }

  test('the migration generates title_sort from the sort expression, and indexes it', async function (assert) {
    let batch = await stageNotes(adapter, virtualNetwork, Object.keys(titles));
    await batch.done();
    let migration = (await import(
      // @ts-ignore a CommonJS migration, required for its SQL
      '../../postgres/migrations/1795300001002_search-text-columns.js'
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
    // The search text columns' migration (title_sort is one of its steps):
    // down drops the column; up generates it again for the rows already there
    // and builds its index.
    await run(migration.down);
    await run(migration.up);
    let [index] = (await adapter.execute(
      `SELECT i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS def
         FROM pg_index AS i
         JOIN pg_class AS c ON c.oid = i.indexrelid
        WHERE c.relname = 'boxel_index_realm_title_sort_index'`,
    )) as { valid: boolean; def: string }[];
    assert.true(index?.valid, 'the index is built');
    assert.true(
      index?.def.includes(`(realm_url, title_sort, url COLLATE "POSIX", type)`),
      `on the column; got ${index?.def}`,
    );
    let [column] = (await adapter.execute(
      `SELECT is_generated AS generated, generation_expression AS expr
         FROM information_schema.columns
        WHERE table_name = 'boxel_index' AND column_name = 'title_sort'`,
    )) as { generated: string; expr: string }[];
    assert.strictEqual(column?.generated, 'ALWAYS', 'a generated column');
    assert.strictEqual(
      column?.expr,
      `(search_doc ->> 'cardTitle'::text)`,
      'of the expression a title sort reads',
    );
    let [{ wrong }] = (await adapter.execute(
      `SELECT count(*) FILTER (WHERE title_sort IS DISTINCT FROM search_doc ->> 'cardTitle')::int AS wrong
         FROM boxel_index WHERE realm_url = $1`,
      { bind: [testRealm] },
    )) as { wrong: number }[];
    assert.strictEqual(wrong, 0, 'and every row holds the sort text');
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
      `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified)
       SELECT b.url || '-' || g, b.file_alias || '-' || g, b.realm_url, b.generation, b.type, b.pristine_doc,
              jsonb_set(b.search_doc, '{cardTitle}', to_jsonb('Note ' || g)), b.deps, b.types, b.is_deleted, b.has_error, b.indexed_at, b.last_modified
         FROM boxel_index AS b, generate_series(1, 5000) AS g
        WHERE b.url = $1`,
      { bind: [url('banana')] },
    );
    await syncSeededValueStore(adapter, 'http://test-realm/');
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
    let explained = await adapter.execute(
      `EXPLAIN (FORMAT JSON) ${keyPass!.sql}`,
      { bind: keyPass!.bind as any },
    );
    let plan = JSON.stringify(explained);
    assert.true(
      plan.includes('boxel_index_realm_title_sort_index'),
      `the page reads the title index; got ${plan}`,
    );
    // The page's order comes off the index. The statement also reads the
    // page's 26 rows back by row address and groups them, which sorts those
    // rows by url (row 16); that sort is not the title order.
    let titleSorts: unknown[] = [];
    let walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        let n = node as Record<string, unknown>;
        if (
          /^(Incremental )?Sort$/.test(String(n['Node Type'])) &&
          JSON.stringify(n['Sort Key'] ?? []).includes('title_sort')
        ) {
          titleSorts.push(n['Sort Key']);
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(explained);
    assert.deepEqual(titleSorts, [], `and sorts nothing by title; got ${plan}`);
  });
});
