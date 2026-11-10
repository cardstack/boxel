import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  assertQuery,
  internalKeyFor,
  param,
  query,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// A plain page (no relevance sort, no fanned-out condition) is an ordered
// LIMIT: a key pass with no GROUP BY that reads one row past the page, then
// the page's wide columns by key. `page.total` decides how much is counted.
// These tests seed rows straight into boxel_index and capture the SQL the
// engine runs, so a page that comes back right can't hide the grouped, fully
// counted shape returning.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const testRealmURL = 'http://plain-page-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const noteRef = ref(`${testRealmURL}note`, 'Note');

const noteDef: Definition = {
  type: 'card-def',
  codeRef: noteRef,
  displayName: 'Note',
  fields: { title: 'f0', tags: 'f1' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
    f1: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (refsEqual(codeRef, noteRef)) {
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

// Five notes, n1 oldest to n5 newest.
const notes = [1, 2, 3, 4, 5].map((n) => ({
  url: `${testRealmURL}Note/n${n}`,
  lastModified: 1_000 * n,
  searchDoc: { title: `Note ${n}`, tags: n % 2 ? ['odd'] : ['even'] },
}));

async function seedNote(
  dbAdapter: PgAdapter,
  vn: VirtualNetwork,
  note: (typeof notes)[number],
) {
  let typeKey = internalKeyFor(noteRef, undefined, vn);
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, indexed_at, last_modified) VALUES (`,
    param(note.url),
    `,`,
    param(note.url),
    `,`,
    param(testRealmURL),
    `,`,
    param(1),
    `,`,
    param('instance'),
    `,`,
    param(JSON.stringify({ id: note.url, type: 'card' })),
    `::jsonb,`,
    param(JSON.stringify(note.searchDoc)),
    `::jsonb,`,
    `'[]'::jsonb,`,
    param(JSON.stringify([typeKey])),
    `::jsonb,`,
    param(false),
    `,`,
    param(false),
    `,`,
    param(Date.now()),
    `,`,
    param(note.lastModified),
    `)`,
  ]);
}

module(basename(import.meta.filename), function () {
  module('plain page (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;
    let executedSql: string[];

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        for (let note of notes) {
          await seedNote(dbAdapter, vn, note);
        }
        executedSql = [];
        let originalExecute = dbAdapter.execute.bind(dbAdapter);
        (dbAdapter as any).execute = (sql: string, opts: any) => {
          executedSql.push(sql);
          return originalExecute(sql, opts);
        };
      },
    });

    async function search(q: Query) {
      executedSql.length = 0;
      return await engine.searchCards(new URL(testRealmURL), q);
    }

    function searchSql(): string[] {
      return executedSql.filter((sql) => /FROM boxel_index/.test(sql));
    }

    function countStatements(): number {
      return searchSql().filter((sql) => /SELECT COUNT\(\*\)/.test(sql)).length;
    }

    const newestFirst = [{ by: 'lastModified', direction: 'desc' as const }];

    test('a newest-first page is an ordered LIMIT with no grouping', async function (assert) {
      let { cards, meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, total: 'none' },
      });
      assert.deepEqual(
        cards.map((c) => String(c.id)),
        [`${testRealmURL}Note/n5`, `${testRealmURL}Note/n4`],
        'the two newest notes, newest first',
      );
      assert.true(meta.page.hasMore, 'more notes follow');
      assert.true(
        meta.page.totalIsEstimate,
        "total: 'none' reports a lower bound",
      );
      let keyPass = searchSql().find((sql) => /LIMIT 3 OFFSET 0/.test(sql));
      assert.ok(keyPass, 'the key pass reads one row past the page');
      assert.notOk(
        /GROUP BY/.test(keyPass!),
        'the key pass does not group the matches',
      );
      assert.strictEqual(countStatements(), 0, "total: 'none' counts nothing");
    });

    test('the default total counts every match exactly', async function (assert) {
      let { cards, meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2 },
      });
      assert.strictEqual(cards.length, 2);
      assert.strictEqual(meta.page.total, 5, 'all five notes are counted');
      assert.notOk(meta.page.totalIsEstimate, 'the default total is exact');
      assert.true(meta.page.hasMore);
      assert.strictEqual(countStatements(), 1, 'one count statement ran');
    });

    test('a capped total under the cap is exact', async function (assert) {
      let { meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, total: 'capped' },
      });
      assert.strictEqual(meta.page.total, 5);
      assert.notOk(meta.page.totalIsEstimate);
    });

    test('the last page is counted from its own rows', async function (assert) {
      let { cards, meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, number: 2, total: 'none' },
      });
      assert.deepEqual(
        cards.map((c) => String(c.id)),
        [`${testRealmURL}Note/n1`],
        'the oldest note is alone on the last page',
      );
      assert.false(meta.page.hasMore, 'nothing follows the last page');
      assert.strictEqual(meta.page.total, 5, 'and the total is exact');
      assert.notOk(meta.page.totalIsEstimate);
      assert.strictEqual(countStatements(), 0, 'without a count statement');
    });

    test('a page returns the same rows in the same order as the full result', async function (assert) {
      let all = await search({ filter: { type: noteRef }, sort: newestFirst });
      let pages: string[] = [];
      for (let number = 0; number < 3; number++) {
        let { cards } = await search({
          filter: { type: noteRef },
          sort: newestFirst,
          page: { size: 2, number, total: 'none' },
        });
        pages.push(...cards.map((c) => String(c.id)));
      }
      assert.deepEqual(
        pages,
        all.cards.map((c) => String(c.id)),
        'paging through matches the unpaged order',
      );
    });

    test('a plural-field filter still pages correctly', async function (assert) {
      let { cards, meta } = await search({
        filter: { on: noteRef, eq: { tags: 'odd' } },
        sort: newestFirst,
        page: { size: 2 },
      });
      assert.deepEqual(
        cards.map((c) => String(c.id)),
        [`${testRealmURL}Note/n5`, `${testRealmURL}Note/n3`],
        'the newest odd notes',
      );
      assert.strictEqual(meta.page.total, 3, 'three notes are odd');
    });

    test('the query validator accepts the total modes and refuses others', async function (assert) {
      for (let total of ['exact', 'capped', 'none']) {
        assert.ok(
          (() => {
            assertQuery({ page: { size: 2, total } });
            return true;
          })(),
          `total: '${total}' is accepted`,
        );
      }
      assert.throws(
        () => assertQuery({ page: { size: 2, total: 'some' } }),
        /total is one of exact, capped, none/,
        'an unknown mode is refused',
      );
    });
  });
});
