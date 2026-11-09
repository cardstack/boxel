import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { hasVectorIndex, spacesOfSql } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

// A near search refuses a target from another vector space by asking which
// spaces the field's vectors are stored in. It asks of the realm searched,
// through the realm-led indexes; asked of every realm, it read every vector
// of the field (1.5 s over 237k vectors).
module(basename(import.meta.filename), function () {
  module('the vector-space lookup', function (hooks) {
    let dbAdapter: PgAdapter;
    let vectorsAvailable = false;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        vectorsAvailable = await hasVectorIndex(adapter);
        if (!vectorsAvailable) {
          return;
        }
        await dbAdapter.execute(`
          INSERT INTO boxel_index_vectors (realm_url, url, type, field_path, item_id, dims, embedding, space)
          SELECT 'http://realm-' || (n % 50) || '/', 'http://realm-' || (n % 50) || '/c' || n, 'instance',
                 'v', '', 3, '[1,2,3]'::vector, 'space-' || (n % 50)
          FROM generate_series(1, 20000) AS n
        `);
        await dbAdapter.execute('ANALYZE boxel_index_vectors');
      },
    });

    test('answers the spaces of the realm searched, through an index', async function (assert) {
      if (!vectorsAvailable) {
        assert.ok(true, 'skipped: this Postgres has no pgvector');
      } else {
        let bind = ['http://realm-7/', 'v', 3];
        let rows = (await dbAdapter.execute(spacesOfSql, { bind })) as {
          space: string;
        }[];
        assert.deepEqual(
          rows.map((r) => r.space),
          ['space-7'],
          "only that realm's spaces",
        );
        let plan = JSON.stringify(
          await dbAdapter.execute(`EXPLAIN (FORMAT JSON) ${spacesOfSql}`, {
            bind,
          }),
        );
        assert.notOk(
          plan.includes('Seq Scan'),
          `no sequential scan; got ${plan}`,
        );
        assert.ok(plan.includes('"Index Name"'), 'read through an index');
      }
    });
  });
});
