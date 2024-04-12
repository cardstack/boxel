import { module, test } from 'qunit';

import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

module('Unit | sqlite | SQLiteAdapter', function () {
  test('run a sqlite db using the SQLiteAdapter', async function (assert) {
    let adapter: SQLiteAdapter | undefined;
    try {
      adapter = new SQLiteAdapter(`
        CREATE TABLE t(a,b);
        INSERT INTO t(a,b) VALUES('abc',123),('def',456),(NULL,789),('ghi',012);
      `);
      await adapter.startClient();
      await await adapter.execute(`INSERT INTO t(a,b) VALUES(?,?),(?,?);`, {
        bind: ['mango', 4, 'van gogh', 8],
      });

      let results = await adapter.execute(`SELECT * FROM t;`);
      assert.deepEqual(results, [
        { a: 'abc', b: 123 },
        { a: 'def', b: 456 },
        { a: null, b: 789 },
        { a: 'ghi', b: 12 },
        { a: 'mango', b: 4 },
        { a: 'van gogh', b: 8 },
      ]);

      results = await adapter.execute(`SELECT * FROM t WHERE a = ?`, {
        bind: ['abc'],
      });
      assert.deepEqual(results, [{ a: 'abc', b: 123 }]);
    } finally {
      if (adapter) {
        await adapter.close();
      }
    }
  });

  test('can coerce data types', async function (assert) {
    let adapter: SQLiteAdapter | undefined;
    try {
      adapter = new SQLiteAdapter(`
        CREATE TABLE t (
          json_col TEXT,
          boolean_col BOOLEAN
        );
        INSERT INTO t(json_col, boolean_col) VALUES
          (NULL, NULL),
          ('{ "foo": "bar" }', true),
          ('[1, 2, 3]', false);
      `);
      await adapter.startClient();
      let results = await adapter.execute(`SELECT * FROM t;`, {
        coerceTypes: {
          json_col: 'JSON',
          boolean_col: 'BOOLEAN',
        },
      });
      assert.deepEqual(results, [
        { json_col: null, boolean_col: null },
        { json_col: { foo: 'bar' }, boolean_col: true },
        { json_col: [1, 2, 3], boolean_col: false },
      ]);
    } finally {
      if (adapter) {
        await adapter.close();
      }
    }
  });
});
