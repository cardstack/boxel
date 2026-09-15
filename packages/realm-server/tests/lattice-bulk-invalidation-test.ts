import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import { IndexWriter, VirtualNetwork } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
module('Lattice | bulk invalidation', function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    templateDatabase: process.env.LATTICE_TEST_TEMPLATE_DB,
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  test('a large invalidation hides every source and HTML row without exceeding the driver bind limit', async function (assert) {
    assert.timeout(180000);
    const realm = 'https://lattice-bulk.example/';
    const count = 7001;
    // Seven thousand tombstones require more than 65,535 binds in the
    // unbounded implementation. Seed real Postgres rows without rendering.
    for (const table of ['boxel_index', 'prerendered_html']) {
      await db.execute(
        `INSERT INTO ${table}
          (url, file_alias, type, realm_url, generation, is_deleted)
         SELECT $1 || n || '.json', $1 || n, 'instance', $1, 0, false
         FROM generate_series(0, $2::integer - 1) n`,
        { bind: [realm, count] },
      );
    }
    const batch = await new IndexWriter(db).createBatch(
      new URL(realm),
      new VirtualNetwork(),
      undefined,
      { splitPrerenderHtml: false },
    );
    await batch.invalidate(
      Array.from({ length: count }, (_, i) => new URL(`${realm}${i}.json`)),
    );
    await batch.done();
    for (const table of ['boxel_index', 'prerendered_html']) {
      const [row] = await db.execute(
        `SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE is_deleted)::integer AS deleted
         FROM ${table} WHERE realm_url = $1`,
        { bind: [realm] },
      );
      assert.deepEqual(row, { total: count, deleted: count }, table);
    }
  });
});
