import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  VirtualNetwork,
  expressionToSql,
  normalizeQueryDefinition,
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

// An `ORDER BY` sort direction reaches SQL as a keyword, and a keyword has no
// bind form — `ORDER BY x $1` is a syntax error. So the renderer enumerates
// `asc`/`desc` rather than parameterizing, and that check is what a caller
// reaching the query engine without passing `assertQuery` meets.
//
// Such a caller exists: a query-backed field's declared `query` may spell its
// direction as an interpolation token, and `normalizeQueryDefinition`
// substitutes the value out of the card's own data before
// `RealmIndexQueryEngine` hands the result to `searchCards`. Nothing on that
// leg runs the grammar, so the renderer is the only thing standing between an
// instance attribute and the `ORDER BY` clause.

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

// Seeded in an order that is neither ascending nor descending by
// `last_modified`, so neither row-order expectation below can be satisfied by
// an ORDER BY that dropped its direction and returned rows as stored.
const SEED_ORDER = [urls[1], urls[0], urls[2]];

const lastModified = new Map([
  [urls[0], 100],
  [urls[1], 200],
  [urls[2], 300],
]);

// Titles ordered so that sorting by `title` gives yet another order — one
// that matches neither the seeding order nor either `last_modified` order.
const titles = new Map([
  [urls[0], 'b'],
  [urls[1], 'c'],
  [urls[2], 'a'],
]);

const byTitleAscending = [urls[2], urls[0], urls[1]];

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}

const entryRef = ref(`${testRealmURL}entry`, 'Entry');
const stringRef = ref('@cardstack/base/string', 'default');

// The card a query-backed field targets. Only a sort through `title` resolves
// against it; the general-sort-field cases never reach a definition at all.
const entryDef: Definition = {
  type: 'card-def',
  codeRef: entryRef,
  displayName: 'Entry',
  fields: { title: 'f0' },
  fieldDefs: {
    f0: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      fieldOrCard: stringRef,
    },
  },
};

function makeDefinitionLookup(): DefinitionLookup {
  const lookup: DefinitionLookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      if (
        codeRef.module === entryRef.module &&
        codeRef.name === entryRef.name
      ) {
        return entryDef;
      }
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
    param(JSON.stringify({ title: titles.get(url) })),
    `::jsonb,`,
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

    test('an unset direction renders as asc, in either spelling', function (assert) {
      // `null` is unset, not a bad direction: an interpolated direction whose
      // card field is empty arrives that way, and the client-side comparator
      // sorts it ascending too. Refusing it here would fail a query that the
      // client answers.
      for (let kind of ADAPTER_KINDS) {
        for (let direction of [undefined, null]) {
          assert.strictEqual(
            expressionToSql(kind, [
              'ORDER BY i.last_modified',
              sortDirection(direction),
            ]).text,
            'ORDER BY i.last_modified asc',
            `${kind}: ${JSON.stringify(direction)} sorts ascending`,
          );
        }
      }
    });

    test('any other direction is refused rather than rendered', function (assert) {
      // The case variants and the whitespace-padded spellings are refused
      // alongside the injection shapes: `asc`/`desc` are the only two the
      // grammar admits, so anything adjacent to them can only arrive from a
      // caller that skipped it, and rendering it would be a guess.
      for (let kind of ADAPTER_KINDS) {
        for (let direction of [
          SUBQUERY_DIRECTION,
          'asc; DROP TABLE boxel_index',
          'sideways',
          'ASC',
          'DESC',
          ' asc',
          'asc ',
          'asc nulls first',
          '',
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
        for (let url of SEED_ORDER) {
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
        let sql = orderBySql();
        assert.ok(
          new RegExp(`\\)\\s+${direction}\\s+NULLS LAST`).test(sql),
          `${direction} reaches the ORDER BY as the keyword:\n${sql}`,
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
        'the search is refused as the ORDER BY is rendered',
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
        let sql = orderBySql();
        // The call reaches the wrapped builder through a positional argument
        // list, so pin that it actually took that branch: the outer select
        // over `sub` and the inner sort alias only exist on this path.
        assert.ok(
          /\) AS sub/.test(sql),
          `${direction}: the outer select over \`sub\` was executed:\n${sql}`,
        );
        assert.ok(
          /_sort_0/.test(sql),
          `${direction}: the inner sort alias was projected:\n${sql}`,
        );
        assert.ok(
          new RegExp(`_sort_0\\s+${direction}\\s+NULLS LAST`).test(sql),
          `${direction} reaches the outer ORDER BY as the keyword:\n${sql}`,
        );
      }
    });

    // A query-backed field's declared direction, resolved out of the card's own
    // data exactly as `RealmIndexQueryEngine` resolves it before calling
    // `searchCards`. `normalizeQueryDefinition` anchors each sort entry on the
    // field's target type, so this lands on the card-field branch.
    function interpolatedSort(sortDir: unknown): Sort {
      let normalized = normalizeQueryDefinition({
        fieldDefinition: {
          type: 'linksToMany',
          isPrimitive: false,
          isComputed: false,
          fieldOrCard: entryRef,
        } as any,
        queryDefinition: {
          realms: [testRealmURL],
          sort: [{ by: 'title', direction: '$this.sortDir' }],
        },
        realmURL: new URL(testRealmURL),
        fieldName: 'items',
        resolvePathValue: () => sortDir,
        resource: { attributes: { sortDir } } as any,
      });
      return normalized!.query.sort!;
    }

    test('an interpolated direction carries the card field value to the engine unvalidated', function (assert) {
      // The premise the tests below rest on: nothing between the card field
      // and the engine constrains this value, so whatever the field holds
      // arrives verbatim.
      assert.deepEqual(
        interpolatedSort(SUBQUERY_DIRECTION)[0].direction,
        SUBQUERY_DIRECTION as 'asc',
        'the payload reaches the sort entry as written',
      );
      assert.strictEqual(
        (interpolatedSort(null)[0] as { direction?: unknown }).direction,
        null,
        'an unset field reaches it as null rather than as an absent key',
      );
    });

    test('an interpolated direction that is not a keyword never reaches the database', async function (assert) {
      await assert.rejects(
        engine.searchCards(new URL(testRealmURL), {
          sort: interpolatedSort(SUBQUERY_DIRECTION),
        }),
        /sort direction must be either 'asc' or 'desc'/,
        'the search is refused as the ORDER BY is rendered',
      );
      assert.notOk(
        executedSql.some((sql) => sql.includes('realm_user_permissions')),
        'no SQL carrying the direction was executed',
      );
      assert.strictEqual(orderBySql(), '', 'no ORDER BY was executed at all');
    });

    test('an interpolated direction still sorts when the card field is set or empty', async function (assert) {
      // An empty field must keep answering the query rather than failing it —
      // the client-side comparator sorts an unset direction ascending, so a
      // refusal here would make the two legs disagree.
      for (let [sortDir, expected] of [
        [null, byTitleAscending],
        [undefined, byTitleAscending],
        ['asc', byTitleAscending],
        ['desc', [...byTitleAscending].reverse()],
      ] as [unknown, string[]][]) {
        executedSql = [];
        let { cards } = await engine.searchCards(new URL(testRealmURL), {
          sort: interpolatedSort(sortDir),
        });
        assert.deepEqual(
          cards.map((card) => String(card.id)),
          expected,
          `${JSON.stringify(sortDir)} sorts by title as expected`,
        );
      }
    });

    test('the wrapped projection refuses a direction that bypassed the grammar', async function (assert) {
      await assert.rejects(
        wrappedSearch(engine, [
          { by: 'lastModified', direction: SUBQUERY_DIRECTION },
        ]),
        /sort direction must be either 'asc' or 'desc'/,
        'the search is refused as the ORDER BY is rendered',
      );
      assert.notOk(
        executedSql.some((sql) => sql.includes('realm_user_permissions')),
        'no SQL carrying the direction was executed',
      );
      assert.strictEqual(orderBySql(), '', 'no ORDER BY was executed at all');
    });
  });
});
