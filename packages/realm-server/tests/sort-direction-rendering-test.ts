import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  expressionToSql,
  param,
  query,
  sortDirection,
  type DBAdapter,
  type Definition,
  type DefinitionLookup,
  type ResolvedCodeRef,
  type Sort,
} from '@cardstack/runtime-common';

import { setupDB } from './helpers/index.ts';

// An `ORDER BY` sort direction is the one part of a compiled query that
// reaches SQL as a keyword rather than as a value: `ORDER BY x $1` orders by a
// parameter's value, so there is nothing to bind a direction to. Two
// independent barriers hold it to `asc`/`desc` — the query grammar
// (`assertQuery`) rejects every other spelling on the way in, and
// `expressionToSql` renders only those two keywords. These tests pin the
// second barrier, the one a caller that reaches the query engine without
// passing through the grammar still meets.

const ADAPTER_KINDS: DBAdapter['kind'][] = ['pg', 'sqlite'];

// A direction whose tail is a correlated subquery: rendered verbatim it turns
// row ordering into a boolean oracle over an unrelated table.
const SUBQUERY_DIRECTION =
  'asc, (SELECT CASE WHEN (SELECT count(*) FROM realm_user_permissions)>0 THEN 1 ELSE 2 END)';

const testRealmURL = 'http://sort-direction-test/';

const urls = [
  `${testRealmURL}Entry/oldest`,
  `${testRealmURL}Entry/middle`,
  `${testRealmURL}Entry/newest`,
];

// `last_modified` values chosen so the seeding order, the ascending order, and
// the descending order are three different orders — an ORDER BY that silently
// dropped its direction would still satisfy one of them.
const lastModified = new Map([
  [urls[0], 100],
  [urls[1], 200],
  [urls[2], 300],
]);

// Nothing below filters on a type, so no definition is ever looked up; the
// stub exists to satisfy the engine's constructor.
function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
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

async function seedEntry(dbAdapter: PgAdapter, url: string) {
  await query(dbAdapter, [
    `INSERT INTO boxel_index (url, file_alias, realm_url, generation, type, pristine_doc, search_doc, deps, types, is_deleted, has_error, last_modified, indexed_at) VALUES (`,
    param(url),
    `,`,
    param(url),
    `,`,
    param(testRealmURL),
    `,`,
    param(1),
    `,`,
    param('instance'),
    `,`,
    param(JSON.stringify({ id: url, type: 'card' })),
    `::jsonb,`,
    `'{}'::jsonb,`,
    `'[]'::jsonb,`,
    `'[]'::jsonb,`,
    param(false),
    `,`,
    param(false),
    `,`,
    param(lastModified.get(url)!),
    `,`,
    param(Date.now()),
    `)`,
  ]);
}

// The outer-wrapped projection — the one that exposes each sort value as an
// inner aliased column and applies the ORDER BY against those aliases — is
// reached only through `_search`'s `conditionalLiveDoc` branch, which no
// public entry point selects, so the tests below drive `_search` directly.
// The inner projection supplies what that branch requires of its caller: the
// live serialization aliased `pristine_doc_fallback` and the markup aliased
// `html`.
const WRAPPED_PROJECTION =
  'SELECT i.url AS url, ANY_VALUE(i.type) as type, ANY_VALUE(i.pristine_doc) as pristine_doc_fallback, ANY_VALUE(ph.isolated_html) as html';

function wrappedSearch(engine: IndexQueryEngine, sort: unknown) {
  return (
    engine as unknown as {
      _search(
        realmURL: URL,
        query: { sort: unknown },
        opts: Record<string, never>,
        selectClauseExpression: string[],
        entryType: 'instance',
        conditionalLiveDoc: boolean,
      ): Promise<{ results: { url?: unknown }[] }>;
    }
  )._search(
    new URL(testRealmURL),
    { sort },
    {},
    [WRAPPED_PROJECTION],
    'instance',
    true,
  );
}

module(basename(import.meta.filename), function () {
  module('sort direction rendering', function () {
    test('a direction renders as a bare keyword, binding nothing', function (assert) {
      for (let kind of ADAPTER_KINDS) {
        for (let direction of ['asc', 'desc']) {
          let { text, values } = expressionToSql(kind, [
            'ORDER BY i.last_modified',
            sortDirection(direction),
            'NULLS LAST',
          ]);
          assert.strictEqual(
            text,
            `ORDER BY i.last_modified ${direction} NULLS LAST`,
            `${kind}: ${direction} renders as the keyword`,
          );
          assert.deepEqual(values, [], `${kind}: ${direction} binds nothing`);
        }
      }
    });

    test('an absent direction renders as asc, the grammar default', function (assert) {
      for (let kind of ADAPTER_KINDS) {
        assert.strictEqual(
          expressionToSql(kind, [
            'ORDER BY i.last_modified',
            sortDirection(undefined),
          ]).text,
          'ORDER BY i.last_modified asc',
          `${kind}: an omitted direction sorts ascending`,
        );
      }
    });

    test('any other direction is refused rather than rendered', function (assert) {
      // `ASC` is refused alongside the injection shapes: the grammar admits
      // the two lowercase spellings, so an uppercase one can only arrive from
      // a caller that skipped it.
      for (let kind of ADAPTER_KINDS) {
        for (let direction of [
          SUBQUERY_DIRECTION,
          'asc; DROP TABLE boxel_index',
          'sideways',
          'ASC',
          '',
          // `null` is refused rather than read as absent: the grammar refuses
          // it too, so only an omitted direction defaults to `asc`.
          null as unknown as string,
        ]) {
          assert.throws(
            () =>
              expressionToSql(kind, [
                'ORDER BY i.last_modified',
                sortDirection(direction),
              ]),
            /sort direction must be either 'asc' or 'desc'/,
            `${kind}: ${JSON.stringify(direction)} is refused`,
          );
        }
      }
    });
  });

  module('sort direction rendering (Postgres integration)', function (hooks) {
    let dbAdapter: PgAdapter;
    let engine: IndexQueryEngine;
    let executedSql: string[];

    setupDB(hooks, {
      beforeEach: async (_dbAdapter) => {
        dbAdapter = _dbAdapter;
        executedSql = [];
        // Capture every SQL string the engine executes, so a test can assert
        // what did — and did not — reach the database.
        let originalExecute = dbAdapter.execute.bind(dbAdapter);
        (dbAdapter as any).execute = (sql: string, opts: any) => {
          executedSql.push(sql);
          return originalExecute(sql, opts);
        };

        engine = new IndexQueryEngine(
          dbAdapter,
          makeDefinitionLookup(),
          new VirtualNetwork(),
        );
        for (let url of urls) {
          await seedEntry(dbAdapter, url);
        }
      },
    });

    function orderBySql(): string {
      return executedSql.filter((sql) => /ORDER BY/.test(sql)).join('\n');
    }

    test('the engine orders by a general sort field in both directions', async function (assert) {
      for (let direction of ['asc', 'desc'] as const) {
        let expected = direction === 'asc' ? urls : [...urls].reverse();
        executedSql = [];
        let { cards } = await engine.searchCards(new URL(testRealmURL), {
          sort: [{ by: 'lastModified', direction }],
        });
        assert.deepEqual(
          cards.map((card) => String(card.id)),
          expected,
          `${direction} orders the rows by last_modified`,
        );
        assert.ok(
          new RegExp(`\\)\\s+${direction}\\s+NULLS LAST`).test(orderBySql()),
          `${direction} reaches the ORDER BY as the keyword`,
        );
      }
    });

    test('a direction that bypassed the grammar never reaches the database', async function (assert) {
      await assert.rejects(
        engine.searchCards(new URL(testRealmURL), {
          // The cast stands in for a caller that reached the engine without
          // passing through `assertQuery` — a direct engine consumer, or a
          // grammar that stopped constraining this value.
          sort: [
            { by: 'lastModified', direction: SUBQUERY_DIRECTION },
          ] as unknown as Sort,
        }),
        /sort direction must be either 'asc' or 'desc'/,
        'the search is refused while the query is still being compiled',
      );
      assert.notOk(
        executedSql.some((sql) => sql.includes('realm_user_permissions')),
        'no SQL carrying the direction was executed',
      );
      assert.strictEqual(orderBySql(), '', 'no ORDER BY was executed at all');
    });

    test('the wrapped projection orders by its inner sort alias in both directions', async function (assert) {
      for (let direction of ['asc', 'desc'] as const) {
        let expected = direction === 'asc' ? urls : [...urls].reverse();
        executedSql = [];
        let { results } = await wrappedSearch(engine, [
          { by: 'lastModified', direction },
        ]);
        assert.deepEqual(
          results.map((row) => String(row.url)),
          expected,
          `${direction} orders the rows by the inner sort alias`,
        );
        assert.ok(
          new RegExp(`_sort_0\\s+${direction}\\s+NULLS LAST`).test(
            orderBySql(),
          ),
          `${direction} reaches the outer ORDER BY as the keyword`,
        );
      }
    });

    test('the wrapped projection refuses a direction that bypassed the grammar', async function (assert) {
      await assert.rejects(
        wrappedSearch(engine, [
          { by: 'lastModified', direction: SUBQUERY_DIRECTION },
        ]),
        /sort direction must be either 'asc' or 'desc'/,
        'the search is refused while the query is still being compiled',
      );
      assert.notOk(
        executedSql.some((sql) => sql.includes('realm_user_permissions')),
        'no SQL carrying the direction was executed',
      );
      assert.strictEqual(orderBySql(), '', 'no ORDER BY was executed at all');
    });
  });
});
