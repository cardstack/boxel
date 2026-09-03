import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { PgAdapter } from '@cardstack/postgres';
import { setupDB } from './helpers/index.ts';

// A Postgres connection can die under a healthy process — a failover, a
// restart, an administrator terminating the backend. `pg` reports that as an
// `error` event on the client, and an `error` event with no listener is an
// uncaught exception, so a pool that has already discarded the bad connection
// and is ready to reconnect loses the process instead.
//
// Termination is the reachable way to produce that event on demand: it is the
// same `57P01` a failover delivers, and it arrives at the same place.

// Collect what reaches the process during `fn`, rather than letting it land on
// whatever the suite happens to be running. An `uncaughtException` listener
// also keeps the process alive, which is what lets the assertion run at all.
async function processLevelErrors(fn: () => Promise<void>): Promise<string[]> {
  let seen: string[] = [];
  let onUncaught = (e: Error) => seen.push(`uncaughtException: ${e.message}`);
  let onRejection = (e: unknown) =>
    seen.push(`unhandledRejection: ${String(e)}`);
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  try {
    await fn();
    // Both events are delivered on a later turn than the socket read that
    // produced them, so give them one to arrive.
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onRejection);
  }
  return seen;
}

module(basename(import.meta.filename), function (hooks) {
  let dbAdapter: PgAdapter;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      dbAdapter = adapter;
    },
  });

  test('a checked-out connection dying reaches its caller, not the process', async function (assert) {
    let rejection: string | undefined;

    let escaped = await processLevelErrors(async () => {
      await dbAdapter.withConnection(async (query) => {
        let [row] = await query([`SELECT pg_backend_pid() AS pid`]);
        let pid = Number(row.pid);

        // Kill this pinned connection from another one while a query is in
        // flight on it, so the failure has to arrive as an error on a client
        // the pool is not currently listening to.
        let killed = dbAdapter.execute(`SELECT pg_terminate_backend(${pid})`);
        try {
          await query([`SELECT pg_sleep(3)`]);
        } catch (e: any) {
          rejection = e.message;
        }
        await killed;
      });
    });

    assert.ok(
      rejection,
      `the in-flight query rejects, got ${JSON.stringify(rejection)}`,
    );
    assert.deepEqual(
      escaped,
      [],
      'nothing reaches the process as an uncaught exception',
    );
  });

  test('an idle pooled connection dying reaches the pool, not the process', async function (assert) {
    let escaped = await processLevelErrors(async () => {
      // The kill has to come from a connection that is not the one being
      // killed. A pool hands back the client it released most recently, so
      // terminating the pid an `execute` just reported, with another
      // `execute`, terminates the connection carrying the request. Pinning
      // one connection for the kill leaves the reported pid idle.
      await dbAdapter.withConnection(async (query) => {
        let [row] = await dbAdapter.execute(`SELECT pg_backend_pid() AS pid`);
        await query([`SELECT pg_terminate_backend(${Number(row.pid)})`]);
      });
    });

    assert.deepEqual(
      escaped,
      [],
      'nothing reaches the process as an uncaught exception',
    );
    let [row] = await dbAdapter.execute(`SELECT 1 AS ok`);
    assert.strictEqual(
      Number(row.ok),
      1,
      'the pool is still usable afterwards',
    );
  });
});
