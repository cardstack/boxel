import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { Deferred, param } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

module(basename(import.meta.filename), function () {
  module('PgAdapter.withTransaction', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
        await dbAdapter.execute(`DROP TABLE IF EXISTS tx_test`);
        await dbAdapter.execute(
          `CREATE TABLE tx_test (k text PRIMARY KEY, v int NOT NULL)`,
        );
        await dbAdapter.execute(
          `INSERT INTO tx_test (k, v) VALUES ('a', 0), ('b', 0)`,
        );
      },
    });

    async function values(): Promise<Record<string, number>> {
      let rows = (await dbAdapter.execute(
        `SELECT k, v FROM tx_test ORDER BY k`,
      )) as { k: string; v: number }[];
      return Object.fromEntries(rows.map((row) => [row.k, row.v]));
    }

    test('commits every statement the callback runs through the querier', async function (assert) {
      let result = await dbAdapter.withTransaction(async (q) => {
        await q([`UPDATE tx_test SET v = 1 WHERE k = 'a'`]);
        await q([`UPDATE tx_test SET v = 2 WHERE k = 'b'`]);
        return 'done';
      });
      assert.strictEqual(result, 'done', 'returns the callback value');
      assert.deepEqual(await values(), { a: 1, b: 2 });
    });

    test('rolls back every statement when the callback throws, and runs it once', async function (assert) {
      let runs = 0;
      await assert.rejects(
        dbAdapter.withTransaction(async (q) => {
          runs++;
          await q([`UPDATE tx_test SET v = 1 WHERE k = 'a'`]);
          throw new Error('boom');
        }),
        /boom/,
      );
      assert.strictEqual(runs, 1, 'an ordinary error is not retried');
      assert.deepEqual(
        await values(),
        { a: 0, b: 0 },
        'the update before the throw was rolled back',
      );
    });

    test('rolls back and re-runs the transaction Postgres aborts to break a deadlock', async function (assert) {
      assert.timeout(30_000);
      // Two transactions each lock one row, then wait for the other's row.
      // Postgres detects the cycle and aborts one of them with 40P01; that one
      // is rolled back and run again, and then succeeds once the other has
      // committed. The barriers are resolved by the first attempt, so a re-run
      // takes both locks without waiting on them.
      let aLocked = new Deferred<void>();
      let bLocked = new Deferred<void>();
      let runs = { first: 0, second: 0 };

      let first = dbAdapter.withTransaction(async (q) => {
        runs.first++;
        await q([`UPDATE tx_test SET v = v + 1 WHERE k =`, param('a')]);
        aLocked.fulfill();
        await bLocked.promise;
        await q([`UPDATE tx_test SET v = v + 1 WHERE k =`, param('b')]);
      });
      let second = dbAdapter.withTransaction(async (q) => {
        runs.second++;
        await q([`UPDATE tx_test SET v = v + 10 WHERE k =`, param('b')]);
        bLocked.fulfill();
        await aLocked.promise;
        await q([`UPDATE tx_test SET v = v + 10 WHERE k =`, param('a')]);
      });
      await Promise.all([first, second]);

      assert.strictEqual(
        runs.first + runs.second,
        3,
        `exactly one of the two ran again (first ran ${runs.first}, second ran ${runs.second})`,
      );
      assert.deepEqual(
        await values(),
        { a: 11, b: 11 },
        'each transaction applied its writes exactly once',
      );
    });
  });
});
