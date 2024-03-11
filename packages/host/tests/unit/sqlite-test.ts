import {
  sqlite3Worker1Promiser,
  type SQLiteWorker,
} from '@sqlite.org/sqlite-wasm';

import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

// This is a test to prove that we can run a sqlite DB in the browser as well as
// an example of how to set it up. We can remove this test after we have
// indexing related tests that exercise an in browser db and feel comfortable
// with the operation of the browser DB.

module('Unit | sqlite | smoke test', function (hooks) {
  let sqlite: typeof SQLiteWorker;

  hooks.beforeEach(async function () {
    let ready = new Deferred<typeof SQLiteWorker>();
    const _promiser = sqlite3Worker1Promiser({
      onready: () => ready.fulfill(_promiser),
    });
    sqlite = await ready.promise;
    let response = await sqlite('config-get', {});
    console.log('Running SQLite3 version', response.result.version.libVersion);
  });

  // this is a handy function to fashion a result set from the raw sqlite exec API
  async function query(dbId: string, sql: string, bind?: any[]) {
    let results: Record<string, any>[] = [];
    await sqlite('exec', {
      dbId,
      sql,
      bind,
      // Nested execs are not possible with this async interface--we can't call
      // into the exec in this callback due to the way we communicate to the
      // worker thread via postMessage. if we need nesting do it all in the SQL
      callback: ({ columnNames, row }) => {
        let rowObject: Record<string, any> = {};
        // row === undefined indicates that the end of the result set has been reached
        if (row) {
          for (let [index, col] of columnNames.entries()) {
            rowObject[col] = row[index];
          }
          results.push(rowObject);
        }
      },
    });
    return results;
  }

  test('run a sqlite db', async function (assert) {
    let response = await sqlite('open', {
      // It is possible to write to the local
      // filesystem via Origin Private Filesystem, but it requires _very_
      // restrictive response headers that would cause our host app to break
      //     "Cross-Origin-Embedder-Policy: require-corp"
      //     "Cross-Origin-Opener-Policy: same-origin"
      // https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/

      // Otherwise, local storage and session storage are off limits to the
      // worker (they are available in the synchronous interface), so only
      // ephemeral memory storage is available
      filename: ':memory:',
    });
    const { dbId } = response;
    try {
      await sqlite('exec', {
        dbId,
        sql: `
        CREATE TABLE t(a,b);
        INSERT INTO t(a,b) VALUES('abc',123),('def',456),(NULL,789),('ghi',012);
      `,
      });
      await sqlite('exec', {
        dbId,
        sql: `
        INSERT INTO t(a,b) VALUES(?,?),(?,?);
      `,
        bind: ['mango', 4, 'van gogh', 8],
      });
      let results = await query(dbId, `SELECT * FROM t;`);
      assert.deepEqual(results, [
        { a: 'abc', b: 123 },
        { a: 'def', b: 456 },
        { a: null, b: 789 },
        { a: 'ghi', b: 12 },
        { a: 'mango', b: 4 },
        { a: 'van gogh', b: 8 },
      ]);

      results = await query(dbId, `SELECT * FROM t WHERE a = ?`, ['abc']);
      assert.deepEqual(results, [{ a: 'abc', b: 123 }]);
    } finally {
      await sqlite('close', { dbId });
    }
  });
});
