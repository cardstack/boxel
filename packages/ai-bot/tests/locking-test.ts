import { module, test } from 'qunit';
import { PgAdapter } from '@cardstack/postgres';
import { acquireLock, releaseLock } from '../lib/queries';
import { Client } from 'pg';

function prepareTestDB() {
  let name = `test_ai_bot_${Math.floor(Math.random() * 1_000_000_000)}`;
  process.env.PGDATABASE = name;
  return name;
}

module('AI Bot Locking', (hooks) => {
  let pgAdapter!: PgAdapter;
  let previousDatabase: string | undefined;
  let currentDatabase: string | undefined;

  hooks.beforeEach(async () => {
    previousDatabase = process.env.PGDATABASE;
    currentDatabase = prepareTestDB();
    pgAdapter = new PgAdapter({ autoMigrate: true, migrationLogging: false });
  });

  hooks.afterEach(async () => {
    if (pgAdapter && !pgAdapter.isClosed) {
      await pgAdapter.close();
    }
    if (currentDatabase) {
      let adminClient = new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT ?? '5432'),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: 'postgres',
      });
      try {
        await adminClient.connect();
        await adminClient.query(`DROP DATABASE IF EXISTS "${currentDatabase}"`);
      } finally {
        await adminClient.end();
      }
    }
    process.env.PGDATABASE = previousDatabase;
    currentDatabase = undefined;
    previousDatabase = undefined;
  });

  test('acquireLock creates a pending lock row and blocks concurrent acquisition', async (assert) => {
    assert.expect(4);
    let eventId = 'event-pending-lock';

    let acquired = await acquireLock(pgAdapter, eventId, 'instance-a');
    assert.true(acquired, 'first acquisition should succeed');

    let rows = await pgAdapter.execute(
      'SELECT completed_at FROM ai_bot_event_processing WHERE event_id_being_processed = $1',
      { bind: [eventId] },
    );
    assert.strictEqual(rows.length, 1, 'lock row should be inserted');
    assert.strictEqual(
      rows[0].completed_at,
      null,
      'lock row should be pending',
    );

    let concurrentAcquire = await acquireLock(pgAdapter, eventId, 'instance-b');
    assert.false(
      concurrentAcquire,
      'second acquisition should fail while pending',
    );

    await releaseLock(pgAdapter, eventId);
  });

  test('releaseLock timestamps the row and prevents replayed events', async (assert) => {
    assert.expect(4);
    let eventId = 'event-complete-lock';

    await acquireLock(pgAdapter, eventId, 'instance-a');
    await releaseLock(pgAdapter, eventId);

    let rows = await pgAdapter.execute(
      'SELECT completed_at FROM ai_bot_event_processing WHERE event_id_being_processed = $1',
      { bind: [eventId] },
    );
    assert.strictEqual(rows.length, 1, 'completed lock row should still exist');
    assert.ok(
      rows[0].completed_at,
      'completed_at should be populated after release',
    );

    let replayAcquire = await acquireLock(pgAdapter, eventId, 'instance-b');
    assert.false(
      replayAcquire,
      'replayed events should be ignored once completed',
    );

    let freshAcquire = await acquireLock(
      pgAdapter,
      'different-event',
      'instance-c',
    );
    assert.true(freshAcquire, 'new events should still acquire a lock');
    await releaseLock(pgAdapter, 'different-event');
  });
});
