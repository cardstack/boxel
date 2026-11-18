import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { EventEmitter } from 'events';
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

  // The scheduler counts a turn from its grant to its release, so a checkout
  // that never gets a working connection, or loses it, must give its turn
  // back or every waiter queues behind a connection Postgres no longer has.
  // These run against a stand-in pool so the failures are exact.
  module('PgAdapter checkout when connections fail', function () {
    class StubClient extends EventEmitter {
      processID = 1;
      lost = false;
      releasedWith: unknown[] = [];
      queries: string[] = [];
      async query(q: string | { text: string }) {
        this.queries.push(typeof q === 'string' ? q : q.text);
        await new Promise((r) => setTimeout(r, 1));
        if (this.lost) {
          throw new Error('Client has encountered a connection error');
        }
        return { rows: [{ answer: 42 }] };
      }
      release(err?: unknown) {
        this.releasedWith.push(err);
      }
      lose() {
        this.lost = true;
        this.emit(
          'error',
          new Error(
            'terminating connection due to idle-in-transaction timeout',
          ),
        );
      }
    }

    function stubbedAdapter(env: Record<string, string>): {
      adapter: PgAdapter;
      pool: { failuresLeft: number; clients: StubClient[] };
    } {
      let previous = Object.fromEntries(
        Object.keys(env).map((k) => [k, process.env[k]]),
      );
      Object.assign(process.env, env);
      let adapter: PgAdapter;
      try {
        adapter = new PgAdapter();
      } finally {
        for (let [k, v] of Object.entries(previous)) {
          if (v === undefined) {
            delete process.env[k];
          } else {
            process.env[k] = v;
          }
        }
      }
      let pool = {
        failuresLeft: 0,
        clients: [] as StubClient[],
        async connect() {
          await new Promise((r) => setTimeout(r, 1));
          if (pool.failuresLeft > 0) {
            pool.failuresLeft--;
            throw Object.assign(
              new Error(
                'remaining connection slots are reserved for roles with the SUPERUSER attribute',
              ),
              { code: '53300' },
            );
          }
          let client = new StubClient();
          pool.clients.push(client);
          return client;
        },
        async end() {},
      };
      (adapter as unknown as { pool: unknown }).pool = pool;
      return { adapter, pool };
    }

    function idle(adapter: PgAdapter) {
      let { inUse, holds, waiting } = adapter.connectionStats;
      return { inUse, holds, waiting };
    }

    test('a refused connect gives its turn back and the callers queued behind it proceed', async function (assert) {
      let { adapter, pool } = stubbedAdapter({ PG_POOL_MAX: '2' });
      try {
        const REFUSALS = 5;
        pool.failuresLeft = REFUSALS;
        let calls: Promise<unknown>[] = [];
        for (let i = 0; i < 6; i++) {
          calls.push(adapter.execute('SELECT 1'));
          calls.push(
            adapter.withConnection(async (query) => {
              await query(['SELECT 1']);
              // nested work while holding, as a lock section does
              return await adapter.execute('SELECT 2');
            }),
          );
          calls.push(adapter.withConnection((query) => query(['SELECT 3'])));
        }
        let settled = await Promise.race([
          Promise.allSettled(calls),
          new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 5_000)),
        ]);
        assert.notStrictEqual(
          settled,
          'stuck',
          `callers stuck: ${JSON.stringify(idle(adapter))}`,
        );
        let refused = (settled === 'stuck' ? [] : settled).filter(
          (s) => s.status === 'rejected',
        );
        assert.strictEqual(
          refused.length,
          REFUSALS,
          'each refusal fails only the caller it was for',
        );
        for (let s of refused) {
          assert.strictEqual(
            ((s as PromiseRejectedResult).reason as { code?: string }).code,
            '53300',
          );
        }
        assert.deepEqual(idle(adapter), { inUse: 0, holds: 0, waiting: 0 });
        assert.true(
          pool.clients.every((c) => c.releasedWith.length === 1),
          'every client that connected went back to the pool once',
        );
      } finally {
        await adapter.close();
      }
    });

    test('a held connection that dies gives its turn back to the callers waiting for one', async function (assert) {
      // One connection and no overflow: while the hold has it, nothing
      // else runs until the hold's connection comes back.
      let { adapter, pool } = stubbedAdapter({
        PG_POOL_MAX: '1',
        PG_POOL_OVERFLOW: '0',
      });
      try {
        let resume!: () => void;
        let gate = new Promise<void>((r) => (resume = r));
        let opened = new Deferred<void>();
        let hold = adapter.withConnection(async (query) => {
          await query(['SELECT 1']);
          opened.fulfill();
          // a hold waiting on work outside the database, idle until Postgres
          // ends the session
          await gate;
          return await query(['SELECT 2']);
        });
        await opened.promise;
        let waiter = adapter.execute('SELECT 1');
        await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(idle(adapter), { inUse: 1, holds: 1, waiting: 1 });

        pool.clients[0].lose();
        let answered = await Promise.race([
          waiter,
          new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 2_000)),
        ]);
        assert.deepEqual(
          answered,
          [{ answer: 42 }],
          'the waiter got a connection of its own',
        );
        assert.true(
          pool.clients[0].releasedWith[0] instanceof Error,
          'the dead client went back to the pool to be discarded',
        );

        resume();
        await assert.rejects(hold, /connection error/);
        assert.deepEqual(idle(adapter), { inUse: 0, holds: 0, waiting: 0 });
        assert.strictEqual(
          pool.clients[0].releasedWith.length,
          1,
          "the hold's own release does not release the client again",
        );
        assert.notOk(
          pool.clients[0].queries.includes('ROLLBACK'),
          'no ROLLBACK is sent on a connection Postgres already ended',
        );
      } finally {
        await adapter.close();
      }
    });

    test('a held connection that dies while the hold waits on its own nested work lets that work run', async function (assert) {
      // With no overflow, nested work waiting on its own hold's connection is
      // waiting on a connection nothing will give back.
      let { adapter, pool } = stubbedAdapter({
        PG_POOL_MAX: '1',
        PG_POOL_OVERFLOW: '0',
      });
      try {
        let nestedRan = false;
        let opened = new Deferred<void>();
        let hold = adapter.withConnection(async (query) => {
          await query(['SELECT 1']);
          opened.fulfill();
          // nested work that needs a turn of its own, as a lock section's
          // write does
          await adapter.execute('SELECT 2');
          nestedRan = true;
          return await query(['SELECT 3']);
        });
        await opened.promise;
        await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(idle(adapter), { inUse: 1, holds: 1, waiting: 1 });

        pool.clients[0].lose();
        let settled = await Promise.race([
          hold.then(
            () => 'resolved',
            (e: Error) => e.message,
          ),
          new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 2_000)),
        ]);
        assert.true(nestedRan, "the hold's nested work got a connection");
        assert.strictEqual(
          settled,
          'Client has encountered a connection error',
          "the hold's own next statement fails",
        );
        assert.deepEqual(idle(adapter), { inUse: 0, holds: 0, waiting: 0 });
      } finally {
        await adapter.close();
      }
    });

    test('a hold whose connection died waits its turn behind earlier callers', async function (assert) {
      // Nested work is served ahead of everything because its hold pins a
      // connection until it finishes; a hold whose connection is gone pins
      // nothing.
      let { adapter, pool } = stubbedAdapter({
        PG_POOL_MAX: '1',
        PG_POOL_OVERFLOW: '0',
      });
      try {
        let order: string[] = [];
        let resume!: () => void;
        let gate = new Promise<void>((r) => (resume = r));
        let opened = new Deferred<void>();
        let hold = adapter.withConnection(async (query) => {
          await query(['SELECT 1']);
          opened.fulfill();
          await gate;
          await adapter.execute('SELECT 2');
          order.push('dead hold');
          return await query(['SELECT 3']);
        });
        await opened.promise;
        let callers = [1, 2].map((n) =>
          adapter.execute('SELECT 1').then(() => {
            order.push(`caller ${n}`);
          }),
        );
        await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(idle(adapter), { inUse: 1, holds: 1, waiting: 2 });

        pool.clients[0].lose();
        // caller 1 has the connection now; the dead hold asks for one after
        // caller 2 did
        resume();
        await Promise.allSettled([hold, ...callers]);
        assert.deepEqual(order, ['caller 1', 'caller 2', 'dead hold']);
      } finally {
        await adapter.close();
      }
    });
  });

  // The stand-in pool above assumes `pg` reports a checked-out connection's
  // death as an `error` event on the client even when no query is running.
  // This holds it to that against Postgres itself.
  module('PgAdapter when Postgres ends a held connection', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    test("the hold's turn comes back while the hold is still open", async function (assert) {
      let { holds: holdsBefore, inUse: inUseBefore } =
        dbAdapter.connectionStats;
      let resume!: () => void;
      let gate = new Promise<void>((r) => (resume = r));
      let opened = new Deferred<void>();
      let hold = dbAdapter.withConnection(async (query) => {
        // Set for this session only, which Postgres then ends.
        await query([`SET idle_in_transaction_session_timeout = '200ms'`]);
        await query(['BEGIN']);
        await query(['SELECT 1']);
        opened.fulfill();
        await gate;
        return await query(['SELECT 2']);
      });
      try {
        await opened.promise;
        assert.strictEqual(dbAdapter.connectionStats.holds, holdsBefore + 1);

        let deadline = Date.now() + 5_000;
        while (
          dbAdapter.connectionStats.holds > holdsBefore &&
          Date.now() < deadline
        ) {
          await new Promise((r) => setTimeout(r, 25));
        }
        assert.deepEqual(
          {
            holds: dbAdapter.connectionStats.holds,
            inUse: dbAdapter.connectionStats.inUse,
          },
          { holds: holdsBefore, inUse: inUseBefore },
          'the dead connection stopped counting before the hold finished',
        );
      } finally {
        resume();
      }
      await assert.rejects(hold, /not queryable/);
      assert.deepEqual(
        await dbAdapter.execute('SELECT 1 AS one'),
        [{ one: 1 }],
        'the pool still serves',
      );
    });
  });
});
