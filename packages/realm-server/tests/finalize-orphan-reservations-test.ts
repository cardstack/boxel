import { module, test } from 'qunit';
import { basename } from 'path';

import type {
  JobReservationsTable,
  JobsTable,
  PgAdapter,
} from '@cardstack/postgres';
import { finalizeOrphanedReservations } from '../lib/finalize-orphan-reservations';
import { createTestPgAdapter, prepareTestDB } from './helpers';

async function insertJob(
  adapter: PgAdapter,
  jobType = 'from-scratch-index',
): Promise<JobsTable['id']> {
  let result = (await adapter.execute(
    `INSERT INTO jobs (job_type, args, status, timeout)
     VALUES ($1, '{}'::jsonb, 'unfulfilled', 7200)
     RETURNING id`,
    { bind: [jobType] },
  )) as unknown as Pick<JobsTable, 'id'>[];
  return result[0].id;
}

async function insertReservation(
  adapter: PgAdapter,
  jobId: JobsTable['id'],
  workerId: string,
): Promise<JobReservationsTable['id']> {
  let result = (await adapter.execute(
    `INSERT INTO job_reservations (job_id, worker_id, locked_until)
     VALUES ($1, $2, NOW() + INTERVAL '7200 seconds')
     RETURNING id`,
    { bind: [jobId, workerId] },
  )) as unknown as Pick<JobReservationsTable, 'id'>[];
  return result[0].id;
}

async function fetchJob(
  adapter: PgAdapter,
  jobId: JobsTable['id'],
): Promise<JobsTable> {
  let rows = (await adapter.execute(`SELECT * FROM jobs WHERE id = $1`, {
    bind: [jobId],
  })) as unknown as JobsTable[];
  return rows[0];
}

async function fetchReservation(
  adapter: PgAdapter,
  reservationId: JobReservationsTable['id'],
): Promise<JobReservationsTable> {
  let rows = (await adapter.execute(
    `SELECT * FROM job_reservations WHERE id = $1`,
    { bind: [reservationId] },
  )) as unknown as JobReservationsTable[];
  return rows[0];
}

module(basename(__filename), function () {
  module('finalizeOrphanedReservations', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('closes every open reservation owned by the dying worker', async function (assert) {
      let workerId = 'orphan-worker-1';
      let jobIdA = await insertJob(adapter);
      let jobIdB = await insertJob(adapter);
      let resA = await insertReservation(adapter, jobIdA, workerId);
      let resB = await insertReservation(adapter, jobIdB, workerId);

      await finalizeOrphanedReservations(adapter, workerId);

      let reservationA = await fetchReservation(adapter, resA);
      let reservationB = await fetchReservation(adapter, resB);
      assert.notEqual(reservationA.completed_at, null, 'res A is closed');
      assert.notEqual(reservationB.completed_at, null, 'res B is closed');
      assert.strictEqual(
        reservationA.completion_reason,
        'interrupted',
        'res A is marked interrupted (default reason)',
      );
      assert.strictEqual(
        reservationB.completion_reason,
        'interrupted',
        'res B is marked interrupted (default reason)',
      );

      // Job rows are intentionally left 'unfulfilled' so the next worker
      // can re-claim them; abandonment after retry exhaustion is the
      // separate cap-of-N path in pg-queue.
      let jobA = await fetchJob(adapter, jobIdA);
      let jobB = await fetchJob(adapter, jobIdB);
      assert.strictEqual(jobA.status, 'unfulfilled');
      assert.strictEqual(jobB.status, 'unfulfilled');
    });

    test('records the supplied reason on the closed reservation', async function (assert) {
      let workerId = 'orphan-worker-reason';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeOrphanedReservations(adapter, workerId, 'timeout-expired');

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(reservation.completed_at, null, 'reservation closed');
      assert.strictEqual(
        reservation.completion_reason,
        'timeout-expired',
        'completion_reason reflects the caller-supplied reason',
      );
    });

    test('does not touch reservations belonging to a different worker', async function (assert) {
      let dyingWorkerId = 'orphan-worker-2';
      let liveWorkerId = 'live-worker-2';
      let dyingJobId = await insertJob(adapter);
      let liveJobId = await insertJob(adapter);
      let dyingRes = await insertReservation(
        adapter,
        dyingJobId,
        dyingWorkerId,
      );
      let liveRes = await insertReservation(adapter, liveJobId, liveWorkerId);

      await finalizeOrphanedReservations(adapter, dyingWorkerId);

      let dying = await fetchReservation(adapter, dyingRes);
      let live = await fetchReservation(adapter, liveRes);
      assert.notEqual(dying.completed_at, null, 'dying reservation closed');
      assert.strictEqual(
        live.completed_at,
        null,
        'unrelated worker reservation is left untouched',
      );
    });

    test('is a no-op when workerId is undefined', async function (assert) {
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(
        adapter,
        jobId,
        'some-worker',
      );

      await finalizeOrphanedReservations(adapter, undefined);

      let reservation = await fetchReservation(adapter, reservationId);
      assert.strictEqual(
        reservation.completed_at,
        null,
        'reservation untouched when workerId is undefined',
      );
    });

    test('is idempotent on a reservation already closed', async function (assert) {
      // Smoke: call twice in a row; the second call must not throw and
      // must leave the row in the same final closed state.
      let workerId = 'orphan-worker-3';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeOrphanedReservations(adapter, workerId);
      let firstClose = (await fetchReservation(adapter, reservationId))
        .completed_at;

      await finalizeOrphanedReservations(adapter, workerId);
      let secondClose = (await fetchReservation(adapter, reservationId))
        .completed_at;

      assert.notEqual(firstClose, null, 'closed by first call');
      assert.deepEqual(
        secondClose,
        firstClose,
        'second call did not move completed_at',
      );
    });
  });
});
