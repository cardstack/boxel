import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type {
  JobReservationsTable,
  JobsTable,
  PgAdapter,
} from '@cardstack/postgres';
import { markFailedJob } from '../lib/mark-failed-job.ts';
import { createTestPgAdapter, prepareTestDB } from './helpers/index.ts';

async function insertJob(adapter: PgAdapter): Promise<JobsTable['id']> {
  let rows = (await adapter.execute(
    `INSERT INTO jobs (job_type, args, status, timeout)
     VALUES ('from-scratch-index', '{}'::jsonb, 'unfulfilled', 7200)
     RETURNING id`,
  )) as unknown as Pick<JobsTable, 'id'>[];
  return rows[0].id;
}

async function insertReservation(
  adapter: PgAdapter,
  jobId: JobsTable['id'],
  workerId: string,
  leaseOffsetSeconds: number,
): Promise<JobReservationsTable['id']> {
  let rows = (await adapter.execute(
    `INSERT INTO job_reservations (job_id, worker_id, locked_until)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
     RETURNING id`,
    { bind: [jobId, workerId, leaseOffsetSeconds] },
  )) as unknown as Pick<JobReservationsTable, 'id'>[];
  return rows[0].id;
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

module(basename(import.meta.filename), function () {
  module('markFailedJob', function (hooks) {
    let adapter: PgAdapter;

    hooks.beforeEach(async function () {
      prepareTestDB();
      adapter = await createTestPgAdapter();
    });

    hooks.afterEach(async function () {
      await adapter.close();
    });

    test('rejects the job and closes the reservation as a genuine attempt', async function (assert) {
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(
        adapter,
        jobId,
        'wedged-worker',
        -60,
      );

      await markFailedJob(adapter, {
        workerId: 'wedged-worker',
        jobId: String(jobId),
        reservationId: String(reservationId),
        message: 'worker went unresponsive',
      });

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'rejected', 'job is rejected');
      assert.true(
        String((job.result as { message?: string })?.message).includes(
          'worker went unresponsive',
        ),
        'the supplied message rides on the job result',
      );

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(reservation.completed_at, null, 'reservation closed');
      assert.strictEqual(
        reservation.completion_reason,
        'completed',
        'counts toward the per-job cap — the worker had a clean shot and produced nothing',
      );
    });

    test('releases its own reservation instead of deciding a job another worker holds', async function (assert) {
      // The lease lapsed, so the job was claimable and another worker took it.
      // Rejecting it here would make that worker's finalize find a job that
      // already has an outcome and drop the verdict it is about to produce.
      let jobId = await insertJob(adapter);
      let staleId = await insertReservation(
        adapter,
        jobId,
        'crashed-worker',
        -60,
      );
      let liveId = await insertReservation(
        adapter,
        jobId,
        'running-worker',
        600,
      );

      await markFailedJob(adapter, {
        workerId: 'crashed-worker',
        jobId: String(jobId),
        reservationId: String(staleId),
        message: 'FATAL ERROR',
      });

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(
        job.status,
        'unfulfilled',
        'the job is left for the worker running it',
      );

      let stale = await fetchReservation(adapter, staleId);
      assert.notEqual(
        stale.completed_at,
        null,
        'the stale reservation is still closed, so it stops reading as stuck',
      );
      assert.strictEqual(
        stale.completion_reason,
        'interrupted',
        'released rather than counted — this attempt lost a race it did not cause',
      );

      let live = await fetchReservation(adapter, liveId);
      assert.strictEqual(
        live.completed_at,
        null,
        "the running worker's reservation is untouched",
      );
    });

    test('decides the job when the only other reservation is expired', async function (assert) {
      // Nobody is holding the job, so its outcome really is the caller's to
      // write. An expired sibling must not read as a competitor, or a
      // genuinely wedged job would stay pending forever.
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'earlier-worker', -600);
      let reservationId = await insertReservation(
        adapter,
        jobId,
        'wedged-worker',
        -60,
      );

      await markFailedJob(adapter, {
        workerId: 'wedged-worker',
        jobId: String(jobId),
        reservationId: String(reservationId),
        message: 'worker went unresponsive',
      });

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'rejected', 'job is rejected');
    });

    test('looks up the reservation scoped to the failing worker', async function (assert) {
      // Without the worker scope this lookup can return the reservation of
      // whichever worker holds the job now, and closing that row rejects the
      // job under a healthy attempt.
      let jobId = await insertJob(adapter);
      let staleId = await insertReservation(
        adapter,
        jobId,
        'crashed-worker',
        -60,
      );
      let liveId = await insertReservation(
        adapter,
        jobId,
        'running-worker',
        600,
      );

      await markFailedJob(adapter, {
        workerId: 'crashed-worker',
        jobId: String(jobId),
        message: 'FATAL ERROR',
      });

      let stale = await fetchReservation(adapter, staleId);
      let live = await fetchReservation(adapter, liveId);
      assert.notEqual(
        stale.completed_at,
        null,
        "the crashed worker's own reservation is the one that closed",
      );
      assert.strictEqual(
        live.completed_at,
        null,
        "the other worker's reservation was never a candidate",
      );

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'unfulfilled', 'job left alone');
    });

    test('does nothing when the worker owns no open reservation on the job', async function (assert) {
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'some-other-worker', -60);

      await markFailedJob(adapter, {
        workerId: 'worker-with-no-reservation',
        jobId: String(jobId),
        message: 'FATAL ERROR',
      });

      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(
        job.status,
        'unfulfilled',
        'no reservation to attribute the failure to, so the job is untouched',
      );
    });
  });
});
