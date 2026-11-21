import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  expressionToSql,
  IndexQueryEngine,
  param,
  VirtualNetwork,
  type DBAdapter,
  type Expression,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import { setupDB } from './helpers/index.ts';
import { definitionLookupOf } from './helpers/definition-lookup.ts';
import { seedIndexRows } from './helpers/seed-index-rows.ts';

// A plain page reads its keys, then each key's row again for its wide
// columns. That second read is by the row's address (ctid), carried by the
// keys from the same statement, so it is a Tid Scan per row whatever the
// planner knows about the table. A lookup by (url, realm_url, type) instead
// was left to the planner, and on a small table never analyzed it took the
// realm's (realm_url, type) index and scanned every row of the realm for each
// key (47,253 buffers for a 300-row page of a 600-row realm).
//
// These tests run on a table with no statistics at all and bound the page's
// buffers by a single pass over the realm's rows (a reference statement in
// the same database) plus a fixed cost per row: the live-row filter's probe
// of the render-error index, and the row's own fetch.

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const testRealmURL = 'http://plain-page-row-address-test/';
const stringRef = ref('@cardstack/base/string', 'default');
const noteRef = ref(`${testRealmURL}note`, 'Note');
const cardDefRef = ref('@cardstack/base/card-api', 'CardDef');

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

const N = 300;
const noteURL = (n: number) => `${testRealmURL}Note/n${n}`;
const newestFirst = [{ by: 'lastModified', direction: 'desc' as const }];

interface Executed {
  sql: string;
  bind: unknown[] | undefined;
}

module(basename(import.meta.filename), function () {
  module('plain page rows by row address (Postgres)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;
    let executed: Executed[];
    let originalExecute: PgAdapter['execute'];

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        let vn = new VirtualNetwork();
        engine = new IndexQueryEngine(dbAdapter, makeDefinitionLookup(), vn);
        await seedIndexRows(
          dbAdapter,
          vn,
          testRealmURL,
          Array.from({ length: N }, (_, i) => ({
            url: noteURL(i + 1),
            searchDoc: {
              title: `Note ${i + 1}`,
              tags: i % 2 ? ['even'] : ['odd'],
            },
            pristineDoc: {
              id: noteURL(i + 1),
              type: 'card',
              attributes: { title: `Note ${i + 1}` },
            },
            types: [noteRef],
            lastModified: 1_000 * (i + 1),
          })),
        );
        // As many file rows again, so the realm holds more rows than the
        // page's type, as a realm does.
        await seedIndexRows(
          dbAdapter,
          vn,
          testRealmURL,
          Array.from({ length: N }, (_, i) => ({
            url: `${testRealmURL}files/f${i + 1}.txt`,
            kind: 'file' as const,
            searchDoc: { name: `f${i + 1}.txt` },
            types: [],
          })),
        );
        // No statistics: what a table never analyzed gives the planner.
        await dbAdapter.execute(
          `DELETE FROM pg_statistic WHERE starelid IN ('boxel_index'::regclass, 'prerendered_html'::regclass)`,
        );
        await dbAdapter.execute(
          `UPDATE pg_class SET reltuples = -1 WHERE oid IN ('boxel_index'::regclass, 'prerendered_html'::regclass)`,
        );
        executed = [];
        originalExecute = dbAdapter.execute.bind(dbAdapter);
        (dbAdapter as any).execute = (sql: string, opts: any) => {
          executed.push({ sql, bind: opts?.bind });
          return originalExecute(sql, opts);
        };
        // A read snapshot's transaction block (the filter-first read) runs
        // its statements on the snapshot's connection, not through
        // `execute`: record those too.
        let originalSnapshot = dbAdapter.withReadSnapshot!.bind(dbAdapter);
        (dbAdapter as any).withReadSnapshot = (
          fn: (reader: DBAdapter) => Promise<unknown>,
          opts: unknown,
        ) =>
          originalSnapshot(
            (reader) =>
              fn({
                ...reader,
                execute: reader.execute,
                withTransaction: (body: any) =>
                  reader.withTransaction((q) =>
                    body(async (expression: Expression) => {
                      let { text, values } = expressionToSql('pg', expression);
                      executed.push({ sql: text, bind: values });
                      return await q(expression);
                    }),
                  ),
              } as DBAdapter),
            opts as any,
          );
      },
    });

    async function search(q: Query) {
      executed.length = 0;
      return await engine.searchCards(new URL(testRealmURL), q);
    }

    function pageStatement(): Executed {
      let page = executed.filter(
        ({ sql }) => /FROM boxel_index/.test(sql) && /__ctid/.test(sql),
      );
      if (page.length !== 1) {
        throw new Error(
          `expected one statement reading rows by row address, found ${page.length}`,
        );
      }
      return page[0];
    }

    // The statement as an expression again, its placeholders as parameters.
    function asExpression(
      sql: string,
      bind: unknown[] | undefined,
    ): Expression {
      let parts = sql.split(/\$(\d+)/);
      let expression: Expression = [];
      parts.forEach((part, i) => {
        if (i % 2 === 0) {
          if (part) expression.push(part);
        } else {
          expression.push(param((bind ?? [])[Number(part) - 1] as any));
        }
      });
      return expression;
    }

    // EXPLAIN under the planner settings the statement ran with: the
    // filter-first read turns index and sequential scans off for its
    // statement alone.
    async function explain({ sql, bind }: Executed, settings?: string) {
      let rows = (await dbAdapter.withTransaction(async (q) => {
        if (settings) {
          await q([settings]);
        }
        return await q(asExpression(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, bind));
      })) as Record<string, unknown>[];
      let plan = rows.map((row) => String(row['QUERY PLAN'])).join('\n');
      let hit = /Buffers: shared hit=(\d+)(?: read=(\d+))?/.exec(plan);
      return {
        plan,
        buffers: Number(hit?.[1] ?? 0) + Number(hit?.[2] ?? 0),
      };
    }

    // One pass over the realm's rows of the page's kind and their renderings:
    // what main's one-statement read of this page costs.
    async function onePassBuffers(): Promise<number> {
      return (
        await explain({
          sql: `SELECT i.url, i.pristine_doc, i.search_doc, ph.deps FROM boxel_index AS i LEFT JOIN prerendered_html AS ph ON ph.url = i.url AND ph.realm_url = i.realm_url AND ph.type = i.type WHERE i.realm_url = $1 AND i.type = 'instance' AND i.is_deleted IS NOT TRUE ORDER BY i.last_modified DESC LIMIT ${N + 1}`,
          bind: [testRealmURL],
        })
      ).buffers;
    }

    test("a plain page reads each row by its address, within one pass's buffers plus a fixed cost per row, with no statistics", async function (assert) {
      let { cards, meta } = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: N, total: 'none' },
      });
      assert.strictEqual(cards.length, N, 'every note is on the page');
      assert.strictEqual(String(cards[0].id), noteURL(N), 'newest first');
      assert.strictEqual(String(cards[N - 1].id), noteURL(1));
      assert.false(meta.page.hasMore);

      let page = pageStatement();
      assert.true(
        /i\.ctid = p\.__ctid/.test(page.sql),
        'the page reads each key’s row by its address',
      );
      let { plan, buffers } = await explain(page);
      assert.true(
        /Tid Scan on boxel_index/.test(plan),
        'a Tid Scan per row, though the table has no statistics',
      );
      assert.false(
        /Index Scan using boxel_index_realm_url_type_index on boxel_index i_1/.test(
          plan,
        ),
        "no row is looked up through the realm's (realm_url, type) index",
      );
      // Per row: the row's own fetch and the live-row filter's probe for a
      // render error, which with no statistics may go through either render-
      // error index; the instance-errors partial index (counts-only search)
      // reads one more page per probe than the (url, realm_url, ...) one.
      let bound = 1.5 * (await onePassBuffers()) + 3 * N;
      assert.true(
        buffers <= bound,
        `the page read ${buffers} buffers, within ${bound}`,
      );
    });

    test('a filter-first page reads its matches and its rows by their addresses, with no statistics', async function (assert) {
      // An `in` of text values tests the search doc by containment, which
      // its GIN index serves, so the page is read filter-first.
      let titles = Array.from(
        { length: 20 },
        (_, i) => `Note ${N - 1 - 2 * i}`,
      );
      let { cards } = await search({
        filter: { on: noteRef, in: { title: titles } },
        sort: newestFirst,
        page: { size: 10, total: 'exact' },
      });
      assert.strictEqual(cards.length, 10);
      assert.strictEqual(
        String(cards[0].id),
        noteURL(N - 1),
        'the newest of the named notes first',
      );
      let page = pageStatement();
      assert.true(
        /i\.ctid = m\.__ctid/.test(page.sql),
        'its matches are read again by their addresses',
      );
      let { plan } = await explain(
        page,
        `SELECT set_config('enable_seqscan', 'off', true), set_config('enable_indexscan', 'off', true)`,
      );
      assert.true(
        /Tid Scan on boxel_index/.test(plan),
        'each row is a Tid Scan, though the table has no statistics',
      );
      assert.false(
        /Index Scan using boxel_index_realm_url_type_index on boxel_index i_1/.test(
          plan,
        ),
        "no row is looked up through the realm's (realm_url, type) index",
      );
    });

    test('a row updated between two requests is on the second page once, with its committed values', async function (assert) {
      let first = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 10, total: 'none' },
      });
      assert.strictEqual(String(first.cards[2].id), noteURL(N - 2));
      // An update writes a new version of the row elsewhere in the heap: the
      // address the first request read it at no longer names it.
      await originalExecute(
        `UPDATE boxel_index SET pristine_doc = $1::jsonb, search_doc = $2::jsonb WHERE url = $3 AND type = 'instance'`,
        {
          bind: [
            JSON.stringify({
              id: noteURL(N - 2),
              type: 'card',
              attributes: { title: 'Renamed' },
            }),
            JSON.stringify({ title: 'Renamed', tags: ['odd'] }),
            noteURL(N - 2),
          ],
        } as any,
      );
      let second = await search({
        filter: { type: noteRef },
        sort: newestFirst,
        page: { size: 10, total: 'none' },
      });
      let ids = second.cards.map((c) => String(c.id));
      assert.strictEqual(
        ids.filter((id) => id === noteURL(N - 2)).length,
        1,
        'the updated row is on the page once',
      );
      assert.true(
        JSON.stringify(second.cards[2]).includes('Renamed'),
        'with its committed values',
      );
      assert.deepEqual(
        ids,
        first.cards.map((c) => String(c.id)),
        'and the page is otherwise the same',
      );
    });
  });
});
