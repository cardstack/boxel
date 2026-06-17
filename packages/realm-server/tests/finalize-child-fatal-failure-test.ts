import { module, test } from 'qunit';
import { basename } from 'path';

import type {
  JobReservationsTable,
  JobsTable,
  PgAdapter,
} from '@cardstack/postgres';
import { finalizeChildReservationAsFailure } from '../lib/finalize-child-fatal-failure.ts';
import { createTestPgAdapter, prepareTestDB } from './helpers/index.ts';

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

module(basename(import.meta.filename), function () {
  module('finalizeChildReservationAsFailure', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('closes the worker\'s open reservation with completion_reason="completed"', async function (assert) {
      // The 'completed' status is the critical invariant — the per-job
      // reservation cap in pg-queue counts only 'completed' and NULL.
      // 'interrupted' is excluded, which is why the parent-side
      // finalizeOrphanedReservations path doesn't break the respawn
      // loop on its own.
      let workerId = 'fatal-worker-1';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeChildReservationAsFailure(adapter, workerId);

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(reservation.completed_at, null, 'reservation closed');
      assert.strictEqual(
        reservation.completion_reason,
        'completed',
        'completion_reason is "completed" so the per-job cap counts this attempt',
      );
    });

    test('closes every open reservation owned by the dying worker', async function (assert) {
      let workerId = 'fatal-worker-multi';
      let jobIdA = await insertJob(adapter);
      let jobIdB = await insertJob(adapter);
      let resA = await insertReservation(adapter, jobIdA, workerId);
      let resB = await insertReservation(adapter, jobIdB, workerId);

      await finalizeChildReservationAsFailure(adapter, workerId);

      let reservationA = await fetchReservation(adapter, resA);
      let reservationB = await fetchReservation(adapter, resB);
      assert.strictEqual(reservationA.completion_reason, 'completed');
      assert.strictEqual(reservationB.completion_reason, 'completed');
    });

    test('does not touch reservations belonging to a different worker', async function (assert) {
      let dyingWorkerId = 'fatal-worker-dying';
      let liveWorkerId = 'fatal-worker-live';
      let dyingJobId = await insertJob(adapter);
      let liveJobId = await insertJob(adapter);
      let dyingRes = await insertReservation(
        adapter,
        dyingJobId,
        dyingWorkerId,
      );
      let liveRes = await insertReservation(adapter, liveJobId, liveWorkerId);

      await finalizeChildReservationAsFailure(adapter, dyingWorkerId);

      let dying = await fetchReservation(adapter, dyingRes);
      let live = await fetchReservation(adapter, liveRes);
      assert.strictEqual(
        dying.completion_reason,
        'completed',
        'dying worker reservation marked completed',
      );
      assert.strictEqual(
        live.completed_at,
        null,
        'unrelated worker reservation is left untouched',
      );
    });

    test('does not touch reservations that are already closed', async function (assert) {
      // Race-safety: if the parent's worker.on('exit') handler runs
      // before our child handler finishes, the row may already be
      // closed (with completion_reason='interrupted'). The 'completed'
      // path's `WHERE completed_at IS NULL` clause makes it a no-op in
      // that case — we don't overwrite a closed reservation.
      let workerId = 'fatal-worker-race';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      // Simulate the parent having already stamped the reservation
      // as 'interrupted'.
      await adapter.execute(
        `UPDATE job_reservations
         SET completed_at = NOW(),
             completion_reason = 'interrupted'
         WHERE id = $1`,
        { bind: [reservationId] },
      );
      let preState = await fetchReservation(adapter, reservationId);

      await finalizeChildReservationAsFailure(adapter, workerId);

      let postState = await fetchReservation(adapter, reservationId);
      assert.deepEqual(
        postState.completed_at,
        preState.completed_at,
        'completed_at unchanged when already closed',
      );
      assert.strictEqual(
        postState.completion_reason,
        'interrupted',
        'completion_reason preserved (not overwritten to "completed")',
      );
    });

    test('is idempotent on repeated calls', async function (assert) {
      let workerId = 'fatal-worker-idempotent';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeChildReservationAsFailure(adapter, workerId);
      let firstClose = (await fetchReservation(adapter, reservationId))
        .completed_at;

      await finalizeChildReservationAsFailure(adapter, workerId);
      let secondClose = (await fetchReservation(adapter, reservationId))
        .completed_at;

      assert.notEqual(firstClose, null, 'closed by first call');
      assert.deepEqual(
        secondClose,
        firstClose,
        'second call did not move completed_at (no-op via WHERE completed_at IS NULL)',
      );
    });
  });
});
