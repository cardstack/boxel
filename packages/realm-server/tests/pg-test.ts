import { module, test } from 'qunit';
import { prepareTestDB } from './helpers';
import PgAdapter from '../pg-adapter';

module('Postgres', function (hooks) {
  hooks.beforeEach(async function () {
    prepareTestDB();
  });

  test('it can connect to the DB and run migrations', async function (assert) {
    let adapter = new PgAdapter();
    await adapter.startClient();

    {
      let result = await adapter.execute(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' -- Replace 'public' with the schema name if it's different
        AND table_name = 'indexed_cards'
      `);
      let columns = result.map((r) => r.column_name);
      assert.deepEqual(columns, [
        'card_url',
        'realm_version',
        'realm_url',
        'pristine_doc',
        'search_doc',
        'error_doc',
        'deps',
        'types',
        'embedded_html',
        'isolated_html',
        'indexed_at',
        'is_deleted',
      ]);
    }
    {
      let result = await adapter.execute(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' -- Replace 'public' with the schema name if it's different
        AND table_name = 'realm_versions'
      `);
      let columns = result.map((r) => r.column_name);
      assert.deepEqual(columns, ['realm_url', 'current_version']);
    }
    {
      let result = await adapter.execute(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' -- Replace 'public' with the schema name if it's different
        AND table_name = 'jobs'
      `);
      let columns = result.map((r) => r.column_name);
      assert.deepEqual(columns, [
        'id',
        'category',
        'args',
        'status',
        'created_at',
        'finished_at',
        'queue',
        'result',
      ]);
    }
  });
});
