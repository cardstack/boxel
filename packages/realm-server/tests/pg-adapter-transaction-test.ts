import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { PgAdapter } from '@cardstack/postgres';
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

  // A search inside its read snapshot holds a pool connection while it waits
  // on a definition lookup another caller started and the lookup cache
  // coalesced it onto. When every connection is held by such a search and the
  // lookup still needs one, nothing gives a connection back unless the pool
  // recognizes the wait.
  module('read snapshots joined to shared work', function (hooks) {
    setupDB(hooks, { beforeEach: async () => {} });

    function smallPool(max: number): PgAdapter {
      let previous = process.env.PG_POOL_MAX;
      process.env.PG_POOL_MAX = String(max);
      try {
        return new PgAdapter();
      } finally {
        if (previous === undefined) {
          delete process.env.PG_POOL_MAX;
        } else {
          process.env.PG_POOL_MAX = previous;
        }
      }
    }

    test('a pool full of snapshots waiting on a lookup that needs a connection still answers', async function (assert) {
      assert.timeout(20_000);
      const POOL = 3;
      let adapter = smallPool(POOL);
      try {
        let resume!: () => void;
        let gate = new Promise<void>((resolve) => (resume = resolve));
        // The coalesced lookup, started outside any snapshot.
        let lookup = adapter.withSharedWork(async () => {
          await gate;
          let [row] = await adapter.execute('SELECT 41 + 1 AS answer');
          return Number(row.answer);
        });
        let opened = 0;
        let searches = Array.from({ length: POOL }, () =>
          adapter.withReadSnapshot(async (reader) => {
            // the generation probe: the snapshot's first statement pins it
            await reader.execute('SELECT 1');
            opened++;
            let answer = await adapter.waitingOnSharedWork(() => lookup);
            let [row] = await reader.execute(`SELECT ${answer} AS answer`);
            return Number(row.answer);
          }),
        );
        let start = Date.now();
        while (opened < POOL && Date.now() - start < 5_000) {
          await new Promise((r) => setTimeout(r, 5));
        }
        assert.strictEqual(opened, POOL, 'every connection is a snapshot');
        assert.strictEqual(adapter.connectionStats.holds, POOL);
        resume();
        let answers = await Promise.race([
          Promise.all(searches),
          new Promise<'wedged'>((r) => setTimeout(() => r('wedged'), 5_000)),
        ]);
        assert.deepEqual(
          answers,
          Array(POOL).fill(42),
          'every search answered once the lookup got a connection',
        );
        assert.strictEqual(adapter.connectionStats.inUse, 0);
      } finally {
        await adapter.close();
      }
    });

    test('a read snapshot ends its session when left idle past the timeout', async function (assert) {
      let previous = process.env.PG_READ_SNAPSHOT_IDLE_TIMEOUT_MS;
      process.env.PG_READ_SNAPSHOT_IDLE_TIMEOUT_MS = '1234';
      let adapter = new PgAdapter();
      try {
        let setting = await adapter.withReadSnapshot(async (reader) => {
          let [row] = await reader.execute(
            'SHOW idle_in_transaction_session_timeout',
          );
          return row.idle_in_transaction_session_timeout;
        });
        assert.strictEqual(setting, '1234ms');
      } finally {
        if (previous === undefined) {
          delete process.env.PG_READ_SNAPSHOT_IDLE_TIMEOUT_MS;
        } else {
          process.env.PG_READ_SNAPSHOT_IDLE_TIMEOUT_MS = previous;
        }
        await adapter.close();
      }
    });
  });
});
