import QUnit from 'qunit';
const { module, test } = QUnit;
import { PgAdapter } from '@cardstack/postgres';
import {
  acquireRoomLock,
  acquireRoomLockWithWait,
  releaseRoomLock,
} from '../lib/queries.ts';
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

  test('room lock serializes processing within a room', async (assert) => {
    assert.expect(5);
    let roomId = '!room:example';
    let firstEventId = 'event-pending-lock';

    let acquired = await acquireRoomLock(
      pgAdapter,
      roomId,
      'instance-a',
      firstEventId,
    );
    assert.true(acquired, 'first acquisition should succeed');

    let rows = await pgAdapter.execute(
      'SELECT event_id_being_processed, completed_at FROM ai_bot_event_processing WHERE room_id = $1',
      { bind: [roomId] },
    );
    assert.strictEqual(rows.length, 1, 'lock row should be inserted');
    assert.strictEqual(
      rows[0].event_id_being_processed,
      firstEventId,
      'event id should be recorded for the pending lock',
    );
    assert.strictEqual(
      rows[0].completed_at,
      null,
      'lock row should be pending',
    );

    let concurrentAcquire = await acquireRoomLock(
      pgAdapter,
      roomId,
      'instance-b',
      'event-forced-concurrent',
    );
    assert.false(
      concurrentAcquire,
      'second acquisition should fail while pending',
    );

    await releaseRoomLock(pgAdapter, roomId);
  });

  test('lock can be reacquired for the same room after completion', async (assert) => {
    assert.expect(6);
    let roomId = '!room:example';
    let firstEventId = 'event-complete-lock';
    let secondEventId = 'event-next-lock';

    await acquireRoomLock(pgAdapter, roomId, 'instance-a', firstEventId);
    await releaseRoomLock(pgAdapter, roomId);

    let completedRows = await pgAdapter.execute(
      'SELECT completed_at FROM ai_bot_event_processing WHERE room_id = $1',
      { bind: [roomId] },
    );
    assert.strictEqual(
      completedRows.length,
      1,
      'completed lock row should still exist',
    );
    assert.ok(
      completedRows[0].completed_at,
      'completed_at should be populated after release',
    );

    let reacquire = await acquireRoomLock(
      pgAdapter,
      roomId,
      'instance-b',
      secondEventId,
    );
    assert.true(reacquire, 'room lock should be reusable after completion');

    let activeRows = await pgAdapter.execute(
      'SELECT event_id_being_processed, completed_at FROM ai_bot_event_processing WHERE room_id = $1',
      { bind: [roomId] },
    );
    assert.strictEqual(
      activeRows[0].event_id_being_processed,
      secondEventId,
      'lock reuse should update the active event id',
    );
    assert.strictEqual(
      activeRows[0].completed_at,
      null,
      'reacquired lock should be pending again',
    );

    let differentRoomAcquire = await acquireRoomLock(
      pgAdapter,
      '!different:example',
      'instance-c',
      'event-different-room',
    );
    assert.true(
      differentRoomAcquire,
      'locks in different rooms should not block each other',
    );

    await releaseRoomLock(pgAdapter, roomId);
    await releaseRoomLock(pgAdapter, '!different:example');
  });
  test('a contended room is waited for, not abandoned', async (assert) => {
    assert.expect(3);
    let roomId = '!room:waits';

    await acquireRoomLock(pgAdapter, roomId, 'instance-a', 'event-in-flight');

    // A user message arriving mid-turn. Giving up here would lose it outright:
    // nothing revisits the room's events once the turn in front finishes.
    let waiting = acquireRoomLockWithWait(
      pgAdapter,
      roomId,
      'instance-a',
      'event-arrived-mid-turn',
      { timeoutMs: 30_000 },
    );

    let settledEarly = await Promise.race([
      waiting.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 250)),
    ]);
    assert.strictEqual(
      settledEarly,
      'pending',
      'the waiter should still be waiting while the turn holds the room',
    );

    await releaseRoomLock(pgAdapter, roomId);
    assert.true(await waiting, 'the waiter takes the room once it is free');

    let rows = await pgAdapter.execute(
      'SELECT event_id_being_processed FROM ai_bot_event_processing WHERE room_id = $1',
      { bind: [roomId] },
    );
    assert.strictEqual(
      rows[0].event_id_being_processed,
      'event-arrived-mid-turn',
      'the waiting event becomes the one being processed',
    );

    await releaseRoomLock(pgAdapter, roomId);
  });

  test('waiting gives up when the room is never released', async (assert) => {
    assert.expect(1);
    let roomId = '!room:wedged';

    await acquireRoomLock(pgAdapter, roomId, 'instance-a', 'event-wedged');

    assert.false(
      await acquireRoomLockWithWait(
        pgAdapter,
        roomId,
        'instance-b',
        'event-gives-up',
        { timeoutMs: 750 },
      ),
      'a holder that never releases eventually times the waiter out',
    );

    await releaseRoomLock(pgAdapter, roomId);
  });
});
