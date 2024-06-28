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
        WHERE table_schema = 'public'
        AND table_name = 'boxel_index'
      `);
      let columns = result.map((r) => r.column_name);
      assert.deepEqual(columns, [
        'url',
        'file_alias',
        'type',
        'realm_version',
        'realm_url',
        'pristine_doc',
        'search_doc',
        'error_doc',
        'deps',
        'types',
        'isolated_html',
        'indexed_at',
        'is_deleted',
        'source',
        'transpiled_code',
        'last_modified',
        'embedded_html',
      ]);
    }
    {
      let result = await adapter.execute(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'realm_versions'
      `);
      let columns = result.map((r) => r.column_name);
      assert.deepEqual(columns, ['realm_url', 'current_version']);
    }
    {
      let result = await adapter.execute(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
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
