import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { query, type Expression } from '@cardstack/runtime-common';
import {
  indexCandidateExpressions,
  indexURLCandidates,
} from '../lib/index-url-utils.ts';
import { setupDB } from './helpers/index.ts';

// Stored the way a deployed realm stores its rows: under https.
const REALM = 'https://published.example.test/';

function instanceQuery(requestURL: string): Expression {
  return [
    `SELECT url FROM boxel_index WHERE type = 'instance' AND`,
    ...indexCandidateExpressions(indexURLCandidates(new URL(requestURL))),
  ];
}

function moduleQuery(requestURL: string): Expression {
  return [
    `SELECT url FROM modules WHERE`,
    ...indexCandidateExpressions(
      indexURLCandidates(new URL(requestURL)),
      undefined,
      { hashedURL: true },
    ),
  ];
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
      await dbAdapter.execute(
        `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url)
         VALUES ($1, $2, 'instance', 1, $3)`,
        { bind: [`${REALM}page.json`, `${REALM}page`, REALM] },
      );
      await dbAdapter.execute(
        `INSERT INTO modules (url, file_alias, definitions, deps, created_at, resolved_realm_url, cache_scope, auth_user_id)
         VALUES ($1, $2, '{}', '[]', $3, $4, 'public', '')`,
        {
          bind: [`${REALM}lib/util.ts`, `${REALM}lib/util`, Date.now(), REALM],
        },
      );
    },
  });

  test('an http request URL finds an instance stored under https', async function (assert) {
    let rows = await query(
      dbAdapter,
      instanceQuery('http://published.example.test/page'),
    );
    assert.deepEqual(
      rows.map((r) => r.url),
      [`${REALM}page.json`],
      'matched through the extensionless alias',
    );
  });

  test('a module is found by its alias and by its URL, under either scheme', async function (assert) {
    for (let requestURL of [
      'https://published.example.test/lib/util',
      'http://published.example.test/lib/util',
      'http://published.example.test/lib/util.ts',
    ]) {
      let rows = await query(dbAdapter, moduleQuery(requestURL));
      assert.deepEqual(
        rows.map((r) => r.url),
        [`${REALM}lib/util.ts`],
        `${requestURL} finds the module`,
      );
    }
    let rows = await query(
      dbAdapter,
      moduleQuery('https://published.example.test/lib/other'),
    );
    assert.deepEqual(rows, [], 'another path finds nothing');
  });

  // These lookups run for every page and every extensionless module request
  // on a published realm, and both tables hold rows for every realm, so each
  // condition must be one an index can serve. Asserted with sequential scans
  // disabled, because on one seeded row the planner would choose one whatever
  // indexes exist: disabling it asks whether there is an index to walk. Only
  // the candidate conditions are explained: with the callers' `type` filter
  // the planner could walk the index on `type` and filter afterwards, which
  // says nothing about the conditions. `SET LOCAL` reverts with the
  // transaction, and `withConnection` rolls back on a throw, so the pooled
  // connection is returned clean either way.
  test('each lookup has an index to walk', async function (assert) {
    let explain = (table: string, requestURL: string, hashedURL = false) =>
      dbAdapter.withConnection(async (q) => {
        await q(['BEGIN']);
        await q(['SET LOCAL enable_seqscan = off']);
        let rows = await q([
          `EXPLAIN (FORMAT JSON) SELECT 1 FROM ${table} WHERE`,
          ...indexCandidateExpressions(
            indexURLCandidates(new URL(requestURL)),
            undefined,
            { hashedURL },
          ),
        ]);
        await q(['COMMIT']);
        return JSON.stringify(rows);
      });

    let instancePlan = await explain(
      'boxel_index',
      'http://published.example.test/page',
    );
    assert.notOk(
      instancePlan.includes('"Node Type":"Seq Scan"'),
      `the boxel_index lookup should not scan the table; got: ${instancePlan}`,
    );

    let modulePlan = await explain(
      'modules',
      'http://published.example.test/lib/util',
      true,
    );
    assert.notOk(
      modulePlan.includes('"Node Type":"Seq Scan"'),
      `the modules lookup should not scan the table; got: ${modulePlan}`,
    );
  });
});
