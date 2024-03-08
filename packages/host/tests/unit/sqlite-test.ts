import sqlite3InitModule, {
  type Sqlite3Static,
  type Database,
} from '@sqlite.org/sqlite-wasm';

import { module, test } from 'qunit';

// This is a test to prove that we can run a sqlite DB in the browser as well
// as an example of how to set it up. WE can remove this test after we have
// indexing related tests that exercise an in browser db.

// SQLite oo1 API https://sqlite.org/wasm/doc/trunk/api-oo1.md

module('Unit | sqlite | smoke test', function (hooks) {
  let sqlite: Sqlite3Static;

  hooks.beforeEach(async function () {
    sqlite = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
    });
  });

  // this is a handy function to fashion a result set from the raw sqlite exec API
  function query(db: Database, sql: string) {
    let results: Record<string, any>[] = [];
    db.exec({
      sql,
      rowMode: 'object',
      callback: (row) => {
        results.push(row);
      },
    });
    return results;
  }

  test('run a sqlite db', function (assert) {
    // ":localStorage:" and ":sessionStorage:" are also a valid filename value
    // when running in the main window thread, which opens up some interesting
    // persistance options for us.
    //
    // It is possible to write to the local
    // filesystem via Origin Private Filesystem, but it requires _very_
    // restrictive response headers that would cause our host app to break
    //     "Cross-Origin-Embedder-Policy: require-corp"
    //     "Cross-Origin-Opener-Policy: same-origin"
    // https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/

    const db = new sqlite.oo1.DB({ filename: ':memory:' });

    try {
      db.exec(`
        CREATE TABLE t(a,b);
        INSERT INTO t(a,b) VALUES('abc',123),('def',456),(NULL,789),('ghi',012);
      `);
      let results = query(db, `SELECT * FROM t;`);
      assert.deepEqual(results, [
        { a: 'abc', b: 123 },
        { a: 'def', b: 456 },
        { a: null, b: 789 },
        { a: 'ghi', b: 12 },
      ]);
    } finally {
      db.close();
    }
  });
});
