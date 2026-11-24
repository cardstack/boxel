import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  hasWarning,
  IndexQueryEngine,
  VirtualNetwork,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query-v2/query';
import { assertQuery } from '@cardstack/runtime-common/query-v2/query-check';

import { setupDB } from './helpers/index.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';
import { seedIndexRows } from './helpers/seed-index-rows.ts';

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

const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');
const cardDef: Definition = {
  type: 'card-def',
  codeRef: cardDefRef,
  displayName: 'Card',
  fields: {},
  fieldDefs: {},
};

function refsEqual(a: CodeRef, b: CodeRef): boolean {
  return (
    'module' in a && 'module' in b && a.module === b.module && a.name === b.name
  );
}

function makeDefinitionLookup(): DefinitionLookup {
  return definitionLookupOf((codeRef) => {
    if (refsEqual(codeRef, noteRef)) {
      return noteDef;
    }
    if (refsEqual(codeRef, cardDefRef)) {
      return cardDef;
    }
    throw new Error(
      `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
    );
  });
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
  await seedIndexRows(dbAdapter, vn, testRealmURL, [
    {
      url: note.url,
      searchDoc: note.searchDoc,
      types: [noteRef],
      lastModified: note.lastModified,
    },
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
        hasWarning(meta, 'total-estimated'),
        "total: 'none' reports a lower bound",
      );
      assert.false(
        'totalIsEstimate' in meta.page,
        'a caveat is a warning, not a flag on the page',
      );
      let keyPass = searchSql().find((sql) => /LIMIT 3 OFFSET 0/.test(sql));
      assert.ok(keyPass, 'the key pass reads one row past the page');
      // The page's projection may join the keys laterally in the same
      // statement and group there; the keys themselves are not grouped.
      let keys = keyPass!.split(') AS p ')[0];
      assert.notOk(
        /GROUP BY/.test(keys),
        'the key pass does not group the matches',
      );
      assert.strictEqual(countStatements(), 0, "total: 'none' counts nothing");
    });

    test('an older-spelling page naming no total counts exactly, as it always did', async function (assert) {
      let { cards, meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2 },
      });
      assert.strictEqual(cards.length, 2);
      assert.strictEqual(meta.page.total, 5, 'all five notes are counted');
      assert.notOk(hasWarning(meta, 'total-estimated'), 'the total is exact');
      assert.true(meta.page.hasMore);
      let counts = searchSql().filter((sql) => /SELECT COUNT\(\*\)/.test(sql));
      assert.strictEqual(counts.length, 1, 'one count statement ran');
      assert.false(/AS capped/.test(counts[0]), 'and it has no cap');
    });

    test('a capped total is counted by a bounded pass', async function (assert) {
      // A whole type's total is the value store's count of its live cards,
      // not a pass over boxel_index, so it needs no cap.
      let whole = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, total: 'capped' },
      });
      assert.strictEqual(whole.meta.page.total, 5, 'every note is counted');
      let storeCounts = searchSql().filter((sql) =>
        /SELECT COUNT\(\*\)/.test(sql),
      );
      assert.strictEqual(storeCounts.length, 1, 'one count statement ran');
      assert.true(
        /FROM boxel_index_values AS v WHERE/.test(storeCounts[0]),
        'a whole type is counted from the value store',
      );
      assert.true(
        storeCounts[0].includes("v.kind = 'c'"),
        "by its cards' entries",
      );
      assert.false(/AS capped/.test(storeCounts[0]), 'with no cap');

      // A filter that is more than a type, and that the search doc's index
      // does not serve, is counted over boxel_index by a pass that stops at
      // the cap.
      let { meta } = await search({
        filter: { on: noteRef, contains: { title: 'Note' } },
        sort: newestFirst,
        page: { size: 2, total: 'capped' },
      });
      assert.strictEqual(meta.page.total, 5, 'exact under the cap');
      let counts = searchSql().filter((sql) => /SELECT COUNT\(\*\)/.test(sql));
      assert.strictEqual(counts.length, 1, 'one count statement ran');
      assert.false(
        /FROM boxel_index_values AS v WHERE/.test(counts[0]),
        'not the store count',
      );
      assert.true(/AS capped/.test(counts[0]), 'and it stops at the cap');
    });

    test('an exact total counts every match', async function (assert) {
      let { meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, total: 'exact' },
      });
      assert.strictEqual(meta.page.total, 5);
      let counts = searchSql().filter((sql) => /SELECT COUNT\(\*\)/.test(sql));
      assert.false(/AS capped/.test(counts[0]), 'no cap on an exact count');
    });

    test('a capped total under the cap is exact', async function (assert) {
      let { meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 2, total: 'capped' },
      });
      assert.strictEqual(meta.page.total, 5);
      assert.notOk(hasWarning(meta, 'total-estimated'));
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
      assert.notOk(hasWarning(meta, 'total-estimated'));
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

    test('a boost over a list of values scores each candidate on the row, not through a subquery', async function (assert) {
      let { cards } = await search({
        type: noteRef,
        sort: [
          {
            blend: [
              {
                boost: { on: noteRef, in: { title: ['Note 2', 'Note 4'] } },
                weight: 1,
              },
            ],
          },
        ],
      } as unknown as Query);
      assert.deepEqual(
        cards
          .slice(0, 2)
          .map((c) => String(c.id))
          .sort(),
        [`${testRealmURL}Note/n2`, `${testRealmURL}Note/n4`],
        'the boosted notes rank first',
      );
      assert.strictEqual(cards.length, 5, 'and the others still follow');
      assert.notOk(
        searchSql().some((sql) => /AS ti WHERE/.test(sql)),
        'no per-value index subquery is built for the boost',
      );
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
