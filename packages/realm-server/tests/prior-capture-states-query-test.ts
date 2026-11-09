import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  expressionToSql,
  priorCaptureStatesQuery,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// Every render visit reads its card's prior capture state from
// `prerendered_html` by URL or by file alias. Written as one OR across the two
// columns it scanned the whole table per visit; each branch now has an index.
module(basename(import.meta.filename), function () {
  module('priorCaptureStatesQuery', function (hooks) {
    let dbAdapter: PgAdapter;
    const realm = new URL('http://realm-a/');

    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        // Enough rows, across realms, that a scan is never the cheap plan.
        await dbAdapter.execute(`
          INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation)
          SELECT 'http://realm-' || (n % 20) || '/card-' || n || '.json',
                 'http://realm-' || (n % 20) || '/card-' || n,
                 'http://realm-' || (n % 20) || '/',
                 t.type, 1
          FROM generate_series(1, 20000) AS n
          CROSS JOIN (VALUES ('instance'), ('file')) AS t(type)
        `);
        await dbAdapter.execute(`
          INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation, captures)
          VALUES
            ('http://realm-a/pet.json', 'http://realm-a/pet', 'http://realm-a/', 'instance', 1, '{"by":"url"}'::jsonb),
            ('http://realm-a/pet.json', 'http://realm-a/pet.json', 'http://realm-a/', 'file', 1, '{"by":"file"}'::jsonb),
            ('http://realm-b/pet.json', 'http://realm-a/pet', 'http://realm-b/', 'instance', 1, NULL)
        `);
        await dbAdapter.execute('ANALYZE prerendered_html');
      },
    });

    function sqlFor(url: string, inRealm = realm) {
      return expressionToSql(
        'pg',
        priorCaptureStatesQuery(inRealm, new URL(url)),
      );
    }

    test('answers the rows keyed by the URL or aliased to it, in the realm', async function (assert) {
      let byAlias = sqlFor('http://realm-a/pet');
      let rows = (await dbAdapter.execute(byAlias.text, {
        bind: byAlias.values,
      })) as { type: string; captures: unknown }[];
      assert.deepEqual(
        rows.map((r) => [r.type, r.captures]),
        [['instance', { by: 'url' }]],
        'the instance row aliased to the URL, and nothing of another realm',
      );
      let byURL = sqlFor('http://realm-a/pet.json');
      let both = (await dbAdapter.execute(byURL.text, {
        bind: byURL.values,
      })) as { type: string }[];
      assert.deepEqual([...new Set(both.map((r) => r.type))].sort(), [
        'file',
        'instance',
      ]);
    });

    test('each branch is answered by an index, never a scan of the table', async function (assert) {
      // A realm holding thousands of the table's rows, where reading the
      // realm's rows and filtering them would cost a scan of its own.
      let { text, values } = sqlFor(
        'http://realm-3/card-3',
        new URL('http://realm-3/'),
      );
      let plan = JSON.stringify(
        await dbAdapter.execute(`EXPLAIN (FORMAT JSON) ${text}`, {
          bind: values,
        }),
      );
      assert.notOk(
        plan.includes('Seq Scan'),
        `no sequential scan; got ${plan}`,
      );
      assert.ok(
        plan.includes('prerendered_html_realm_file_alias_index'),
        'the alias branch uses the new index',
      );
    });
  });
});
