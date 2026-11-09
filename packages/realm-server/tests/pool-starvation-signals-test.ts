import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Client } from 'pg';
import {
  ConnectionScheduler,
  SessionProbe,
  TrackActivitiesOffError,
  markConnectionHeld,
  postgresConfig,
  startSessionSampling,
  type SessionStats,
} from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

// The readings the realm:health line carries to tell a database pool that is
// stuck from one that is only busy: how long the longest acquisition has
// waited for a connection, and what the database's session table says about
// transactions left idle and sessions blocked on advisory locks.

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  let deadline = Date.now() + timeoutMs;
  for (;;) {
    let value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await wait(50);
  }
}

module(basename(import.meta.filename), function () {
  module('ConnectionScheduler.oldestWaitMs', function () {
    test('is the age of the longest-waiting acquisition, and 0 with none waiting', async function (assert) {
      let clock = 1000;
      let scheduler = new ConnectionScheduler({
        limit: 1,
        tenantShare: 1,
        now: () => clock,
      });
      let first = await scheduler.acquire();
      assert.strictEqual(scheduler.oldestWaitMs, 0, 'nothing waiting');

      let second = scheduler.acquire();
      clock += 10;
      let third = scheduler.acquire();
      clock += 90;
      assert.strictEqual(
        scheduler.oldestWaitMs,
        100,
        'the earlier of two waiters sets the age',
      );

      first();
      let releaseSecond = await second;
      assert.strictEqual(
        scheduler.oldestWaitMs,
        90,
        'once it is granted, the next oldest does',
      );

      releaseSecond();
      (await third)();
      assert.strictEqual(scheduler.oldestWaitMs, 0, 'the queue is empty');
      scheduler.dispose();
    });

    test('counts acquisitions nested in a held connection', async function (assert) {
      let clock = 0;
      let scheduler = new ConnectionScheduler({
        limit: 1,
        tenantShare: 1,
        now: () => clock,
      });
      let outer = await scheduler.acquire();
      let holding = markConnectionHeld();
      let nested = holding.run(() => scheduler.acquire());
      clock += 250;
      assert.strictEqual(scheduler.oldestWaitMs, 250);
      outer();
      (await nested)();
      holding.end();
      assert.strictEqual(scheduler.oldestWaitMs, 0);
      scheduler.dispose();
    });
  });

  module('startSessionSampling', function () {
    test('keeps the latest reading, and drops it once it is two intervals old', async function (assert) {
      let clock = 0;
      let reading: SessionStats = {
        idleInTransaction: 1,
        idleInTransactionMaxMs: 400_000,
        advisoryWaiters: 2,
        advisoryWaitMaxMs: 300_000,
      };
      let fail = false;
      let samples = 0;
      let sampling = startSessionSampling(
        {
          sample: async () => {
            samples++;
            if (fail) {
              throw new Error('database unreachable');
            }
            return reading;
          },
          close: async () => {},
        },
        { intervalMs: 60_000, now: () => clock },
      );
      await until(
        async () => sampling.latest(),
        (latest) => latest !== undefined,
      );
      assert.deepEqual(sampling.latest(), reading, 'the first sample');
      assert.strictEqual(samples, 1, 'taken once at start');

      fail = true;
      clock += 120_000;
      assert.deepEqual(
        sampling.latest(),
        reading,
        'still reported at two intervals old',
      );
      clock += 1;
      assert.strictEqual(
        sampling.latest(),
        undefined,
        'a reading past two intervals is not repeated',
      );
      await sampling.stop();
    });

    test('keeps the last reading through failed samples until it is two intervals old', async function (assert) {
      let reading: SessionStats = {
        idleInTransaction: 0,
        idleInTransactionMaxMs: 0,
        advisoryWaiters: 1,
        advisoryWaitMaxMs: 700_000,
      };
      // The first sample succeeds and every later one fails.
      let calls = 0;
      let sampling = startSessionSampling(
        {
          sample: async () => {
            calls++;
            if (calls === 1) {
              return reading;
            }
            throw new Error('database unreachable');
          },
          close: async () => {},
        },
        { intervalMs: 100 },
      );
      await until(
        async () => calls,
        (n) => n >= 2,
      );
      assert.deepEqual(
        sampling.latest(),
        reading,
        'a failed sample leaves the last good reading in place',
      );
      let dropped = await until(
        async () => sampling.latest(),
        (latest) => latest === undefined,
      );
      assert.strictEqual(
        dropped,
        undefined,
        'and it is dropped once two intervals pass without a good one',
      );
      await sampling.stop();
    });

    test('does not start a sample while the last is still running', async function (assert) {
      let started = 0;
      let finish!: () => void;
      let hung = new Promise<void>((resolve) => (finish = resolve));
      let sampling = startSessionSampling(
        {
          sample: async () => {
            started++;
            await hung;
            return {
              idleInTransaction: 0,
              idleInTransactionMaxMs: 0,
              advisoryWaiters: 0,
              advisoryWaitMaxMs: 0,
            };
          },
          close: async () => {},
        },
        { intervalMs: 20 },
      );
      await wait(200);
      assert.strictEqual(started, 1, 'ten intervals passed, one sample ran');
      finish();
      await sampling.stop();
    });
  });

  module('SessionProbe', function (hooks) {
    // A database of the test's own, so the only sessions the probe sees are
    // the ones each test opens.
    setupDB(hooks, { beforeEach: async () => {} });

    let clients: Client[] = [];
    let probe: SessionProbe;

    // The test database runs with `track_activities` off, which records no
    // session state. A superuser may turn it on for its own session, so the
    // probe and every session it should see connect with it on.
    function trackedConfig() {
      return { ...postgresConfig(), options: '-c track_activities=on' };
    }

    hooks.beforeEach(function () {
      probe = new SessionProbe({ config: trackedConfig() });
    });

    hooks.afterEach(async function () {
      await probe.close();
      for (let client of clients) {
        await client.end().catch(() => undefined);
      }
      clients = [];
    });

    async function connect(): Promise<Client> {
      let client = new Client(trackedConfig());
      clients.push(client);
      await client.connect();
      return client;
    }

    test('refuses to report on a server that does not track session state', async function (assert) {
      let untracked = new SessionProbe({ config: postgresConfig() });
      try {
        await untracked.sample();
        assert.true(false, 'the sample should have failed');
      } catch (e) {
        assert.true(
          e instanceof TrackActivitiesOffError,
          `rejected with ${String(e)}`,
        );
      } finally {
        await untracked.close();
      }
    });

    test('reports nothing stuck on a quiet database', async function (assert) {
      assert.deepEqual(await probe.sample(), {
        idleInTransaction: 0,
        idleInTransactionMaxMs: 0,
        advisoryWaiters: 0,
        advisoryWaitMaxMs: 0,
      });
    });

    test('reports a transaction its client has stopped driving, and for how long', async function (assert) {
      let idle = await connect();
      await idle.query('BEGIN');
      await idle.query('SELECT 1');
      await wait(300);

      let stats = await probe.sample();
      assert.strictEqual(stats.idleInTransaction, 1);
      assert.true(
        stats.idleInTransactionMaxMs >= 250,
        `idle for ${stats.idleInTransactionMaxMs}ms`,
      );

      await idle.query('COMMIT');
      assert.strictEqual(
        (await probe.sample()).idleInTransaction,
        0,
        'gone once the transaction ends',
      );
    });

    test('reports a session blocked on an advisory lock, and for how long', async function (assert) {
      let holder = await connect();
      let waiter = await connect();
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(918000002)');
      await waiter.query('BEGIN');
      let blocked = waiter.query('SELECT pg_advisory_xact_lock(918000002)');

      let stats = await until(
        () => probe.sample(),
        (s) => s.advisoryWaiters > 0 && s.advisoryWaitMaxMs >= 200,
      );
      assert.strictEqual(stats.advisoryWaiters, 1);
      assert.true(
        stats.advisoryWaitMaxMs >= 200,
        `blocked for ${stats.advisoryWaitMaxMs}ms`,
      );
      assert.strictEqual(
        stats.idleInTransaction,
        1,
        'the holder, idle in its transaction, is reported as well',
      );

      await holder.query('COMMIT');
      await blocked;
      await waiter.query('COMMIT');
      assert.strictEqual(
        (await probe.sample()).advisoryWaiters,
        0,
        'gone once the lock is granted',
      );
    });

    test('opens a fresh connection after its own is lost', async function (assert) {
      await probe.sample();
      let admin = await connect();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE application_name = 'boxel-session-probe' AND datname = current_database()`,
      );
      await wait(100);
      let failed = await probe.sample().then(
        () => false,
        () => true,
      );
      assert.true(failed, 'the sample on the lost connection fails');
      assert.deepEqual(
        await probe.sample(),
        {
          idleInTransaction: 0,
          idleInTransactionMaxMs: 0,
          advisoryWaiters: 0,
          advisoryWaitMaxMs: 0,
        },
        'and the next one reconnects',
      );
    });
  });
});
