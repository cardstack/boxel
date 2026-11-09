import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

// A statement run with a signal is cancelled in Postgres when the signal
// aborts, so an abandoned search stops costing the database anything.
module(basename(import.meta.filename), function () {
  module('PgAdapter.execute with a signal', function (hooks) {
    let dbAdapter: PgAdapter;
    setupDB(hooks, {
      beforeEach: async (adapter) => {
        dbAdapter = adapter;
      },
    });

    // The statement under test holds a transaction-scoped advisory lock for as
    // long as it runs (activity tracking is off in the test database), so
    // whether another session can take the lock says whether it is running.
    const SLEEPER = 'SELECT pg_advisory_xact_lock(4242), pg_sleep(30)';
    async function sleeperRunning(): Promise<boolean> {
      let rows = (await dbAdapter.execute(
        'SELECT pg_try_advisory_xact_lock(4242) AS free',
      )) as { free: boolean }[];
      return !rows[0].free;
    }

    test('an abort cancels the running statement in Postgres', async function (assert) {
      let controller = new AbortController();
      let started = Date.now();
      let running = dbAdapter.execute(SLEEPER, { signal: controller.signal });
      running.catch(() => {});
      let deadline = Date.now() + 5_000;
      while (!(await sleeperRunning()) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.true(await sleeperRunning(), 'the statement runs');
      let reason = new Error('client went away');
      controller.abort(reason);
      await assert.rejects(running, (e: unknown) => e === reason);
      assert.ok(Date.now() - started < 10_000, 'it did not run to completion');
      assert.false(await sleeperRunning(), 'Postgres stopped it');
      let [row] = (await dbAdapter.execute('SELECT 1 AS one')) as {
        one: number;
      }[];
      assert.strictEqual(row.one, 1, 'the pool still serves statements');
    });

    test('a signal already aborted runs nothing', async function (assert) {
      let controller = new AbortController();
      controller.abort(new Error('gone'));
      await assert.rejects(
        dbAdapter.execute(SLEEPER, { signal: controller.signal }),
        /gone/,
      );
      assert.false(await sleeperRunning(), 'nothing was started');
    });
  });
});
