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

      let outcome = await markFailedJob(adapter, {
        workerId: 'wedged-worker',
        jobId: String(jobId),
        reservationId: String(reservationId),
        message: 'worker went unresponsive',
      });

      assert.strictEqual(outcome, 'failed', 'the job outcome landed here');
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

    test('closes its own reservation instead of deciding a job another worker holds', async function (assert) {
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

      let outcome = await markFailedJob(adapter, {
        workerId: 'crashed-worker',
        jobId: String(jobId),
        reservationId: String(staleId),
        message: 'FATAL ERROR',
      });

      assert.strictEqual(
        outcome,
        'not-ours',
        'the caller is told the outcome landed elsewhere',
      );
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
        'completed',
        'still counted against the per-job cap — this worker held the job ' +
          'uninterrupted and produced nothing, so a job that wedges every ' +
          'worker it touches must still run out of attempts',
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
      // Both rows are open with lapsed leases, so nothing here is a live
      // competitor and the ownership guard has no say — the only thing that
      // picks the right row is the worker scope. Ours is inserted first so it
      // holds the lower id, exactly the row an unscoped `ORDER BY id DESC`
      // lookup would skip past.
      let jobId = await insertJob(adapter);
      let ours = await insertReservation(adapter, jobId, 'crashed-worker', -60);
      let theirs = await insertReservation(
        adapter,
        jobId,
        'unrelated-worker',
        -30,
      );

      let outcome = await markFailedJob(adapter, {
        workerId: 'crashed-worker',
        jobId: String(jobId),
        message: 'FATAL ERROR',
      });

      assert.strictEqual(outcome, 'failed', 'the job was failed');
      let mine = await fetchReservation(adapter, ours);
      let other = await fetchReservation(adapter, theirs);
      assert.notEqual(
        mine.completed_at,
        null,
        "the failing worker's own reservation is the one that closed",
      );
      assert.strictEqual(
        other.completed_at,
        null,
        "another worker's reservation was never a candidate, newer id or not",
      );
    });

    test('does not overwrite a job another worker already resolved', async function (assert) {
      // The headline defect: a wedged worker's orphan row must not turn a job
      // that already succeeded into a 500. Nothing else holds the job here —
      // the competing attempt has finished and gone — so only the
      // `status = 'unfulfilled'` half of the guard stands between a resolved
      // job and a fabricated failure.
      let jobId = await insertJob(adapter);
      let reservationId = await insertReservation(
        adapter,
        jobId,
        'wedged-worker',
        -60,
      );
      await adapter.execute(
        `UPDATE jobs SET status='resolved', finished_at=NOW(),
           result='{"stats":{"filesIndexed":7}}'::jsonb
         WHERE id=$1`,
        { bind: [jobId] },
      );

      let outcome = await markFailedJob(adapter, {
        workerId: 'wedged-worker',
        jobId: String(jobId),
        reservationId: String(reservationId),
        message: 'worker went unresponsive',
      });

      assert.strictEqual(outcome, 'not-ours', 'the job was already decided');
      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(job.status, 'resolved', 'the success is preserved');
      assert.deepEqual(
        job.result,
        { stats: { filesIndexed: 7 } },
        'and so is the result it succeeded with',
      );

      let reservation = await fetchReservation(adapter, reservationId);
      assert.notEqual(
        reservation.completed_at,
        null,
        'the orphan is still closed so it stops reading as stuck',
      );
    });

    test('does nothing when the worker owns no open reservation on the job', async function (assert) {
      let jobId = await insertJob(adapter);
      await insertReservation(adapter, jobId, 'some-other-worker', -60);

      let outcome = await markFailedJob(adapter, {
        workerId: 'worker-with-no-reservation',
        jobId: String(jobId),
        message: 'FATAL ERROR',
      });

      assert.strictEqual(
        outcome,
        'no-reservation',
        'distinguished from `not-ours` so the caller still writes index error docs',
      );
      let job = await fetchJob(adapter, jobId);
      assert.strictEqual(
        job.status,
        'unfulfilled',
        'no reservation to attribute the failure to, so the job is untouched',
      );
    });
  });
});
