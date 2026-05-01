import { module, test } from 'qunit';
import { basename } from 'path';

import type {
  JobReservationsTable,
  JobsTable,
  PgAdapter,
} from '@cardstack/postgres';
import { finalizeOrphanedReservations } from '../lib/finalize-orphan-reservations';
import { createTestPgAdapter, prepareTestDB } from './helpers';

// `JobsTable.result` is typed `PgPrimitive`, but we know `markRejectedJob`
// always writes the `{status, message}` shape, so narrow at the use site.
type RejectedJobResult = { status?: number; message?: string };

async function insertJob(
  adapter: PgAdapter,
  jobType = 'from-scratch-index',
): Promise<string> {
  let result = (await adapter.execute(
    `INSERT INTO jobs (job_type, args, status, timeout)
     VALUES ($1, '{}'::jsonb, 'unfulfilled', 7200)
     RETURNING id`,
    { bind: [jobType] },
  )) as { id: string }[];
  return result[0].id;
}

async function insertReservation(
  adapter: PgAdapter,
  jobId: string,
  workerId: string,
): Promise<string> {
  let result = (await adapter.execute(
    `INSERT INTO job_reservations (job_id, worker_id, locked_until)
     VALUES ($1, $2, NOW() + INTERVAL '7200 seconds')
     RETURNING id`,
    { bind: [jobId, workerId] },
  )) as { id: string }[];
  return result[0].id;
}

async function fetchJob(adapter: PgAdapter, jobId: string): Promise<JobsTable> {
  let rows = (await adapter.execute(`SELECT * FROM jobs WHERE id = $1`, {
    bind: [jobId],
  })) as unknown as JobsTable[];
  return rows[0];
}

async function fetchReservation(
  adapter: PgAdapter,
  reservationId: string,
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

    test('finalizes the orphan reservation and rejects the job when jobId is known', async function (assert) {
      let workerId = 'orphan-worker-1';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeOrphanedReservations(adapter, { workerId, jobId });

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(
        reservation.completed_at,
        null,
        'reservation completed_at is set',
      );

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'rejected', 'job marked as rejected');
      assert.notEqual(job.finished_at, null, 'job finished_at populated');
      let result = job.result as RejectedJobResult | null;
      assert.ok(
        result?.message?.includes('worker exited unexpectedly'),
        `job.result.message contains the diagnostic, got: ${result?.message}`,
      );
      assert.strictEqual(result?.status, 500, 'job.result.status is 500');
    });

    test('bulk-closes all open reservations for the worker even when jobId is unknown', async function (assert) {
      let workerId = 'orphan-worker-2';
      let jobIdA = await insertJob(adapter);
      let jobIdB = await insertJob(adapter);
      let resA = await insertReservation(adapter, jobIdA, workerId);
      let resB = await insertReservation(adapter, jobIdB, workerId);

      await finalizeOrphanedReservations(adapter, {
        workerId,
        jobId: undefined,
      });

      let reservationA = await fetchReservation(adapter, resA);
      let reservationB = await fetchReservation(adapter, resB);
      assert.notEqual(
        reservationA.completed_at,
        null,
        'reservation A is closed by bulk update',
      );
      assert.notEqual(
        reservationB.completed_at,
        null,
        'reservation B is closed by bulk update',
      );

      // jobs themselves remain unfulfilled since we do not know which one to
      // mark — the queue runner will retry them on the next pass.
      let jobA = await fetchJob(adapter, jobIdA);
      let jobB = await fetchJob(adapter, jobIdB);
      assert.strictEqual(jobA.status, 'unfulfilled');
      assert.strictEqual(jobB.status, 'unfulfilled');
    });

    test('does not touch reservations belonging to a different worker', async function (assert) {
      let dyingWorkerId = 'orphan-worker-3';
      let liveWorkerId = 'live-worker-3';
      let dyingJobId = await insertJob(adapter);
      let liveJobId = await insertJob(adapter);
      let dyingRes = await insertReservation(
        adapter,
        dyingJobId,
        dyingWorkerId,
      );
      let liveRes = await insertReservation(adapter, liveJobId, liveWorkerId);

      await finalizeOrphanedReservations(adapter, {
        workerId: dyingWorkerId,
        jobId: dyingJobId,
      });

      let dying = await fetchReservation(adapter, dyingRes);
      let live = await fetchReservation(adapter, liveRes);
      assert.notEqual(dying.completed_at, null, 'dying reservation closed');
      assert.strictEqual(
        live.completed_at,
        null,
        'unrelated worker reservation is left untouched',
      );

      let liveJob = await fetchJob(adapter, liveJobId);
      assert.strictEqual(
        liveJob.status,
        'unfulfilled',
        'unrelated job is left unfulfilled',
      );
    });

    test('is a no-op when workerId is undefined', async function (assert) {
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(
        adapter,
        jobId,
        'some-worker',
      );

      await finalizeOrphanedReservations(adapter, {
        workerId: undefined,
        jobId,
      });

      let reservation = await fetchReservation(adapter, reservationId);
      assert.strictEqual(
        reservation.completed_at,
        null,
        'reservation untouched when workerId is undefined',
      );
      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'unfulfilled');
    });

    test('is idempotent on a reservation already closed by the bulk update', async function (assert) {
      // Smoke test: call twice in a row; the second call must not throw and
      // must leave the rows in the same final state.
      let workerId = 'orphan-worker-4';
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(adapter, jobId, workerId);

      await finalizeOrphanedReservations(adapter, { workerId, jobId });
      await finalizeOrphanedReservations(adapter, { workerId, jobId });

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(reservation.completed_at, null);
      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'rejected');
    });
  });
});
