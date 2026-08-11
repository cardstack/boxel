import {
  logger,
  param,
  type PgPrimitive,
  type Querier,
} from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';

import type { JobReservationsTable, JobsTable } from './job-tables.ts';

const log = logger('queue');

// How many extra times the finalize transaction is retried after Postgres
// aborts it with a serialization failure. By the time it runs, the handler
// has already done the work, so its verdict reaches `jobs` only if this
// transaction commits: dropping it discards completed work AND leaves the
// reservation open for the worker-manager watchdog to read as a wedged
// worker. Retrying is cheap — five single-row statements — and the
// conflicting writer is another worker's claim or finalize, which clears in
// milliseconds.
export const FINALIZE_CONFLICT_RETRIES = 3;

// Stagger between finalize retries. Two workers that conflicted once will
// otherwise retry in lockstep and conflict again.
const FINALIZE_RETRY_BACKOFF_MS = 25;

// Why a finalize declined to write the handler's verdict. Each of these
// means another actor already owns the job's outcome, so the verdict is
// dropped on purpose — but the reservation still has to be closed, or its
// open row outlives the lease and reads as a stuck job.
export type FinalizeSupersededCause =
  | 'the job already has a recorded outcome'
  | 'the reservation row is gone or already closed'
  | 'the lease expired and the job was reserved again';

export type FinalizeOutcome =
  | { type: 'committed' }
  | { type: 'superseded'; cause: FinalizeSupersededCause }
  // Serialization failure. The verdict is still valid; only the transaction
  // that would record it failed, so this is safe to retry.
  | { type: 'conflict' };

// Postgres aborts a transaction with one of these when it cannot be
// serialized against a concurrent one. Both are the database asking for the
// same transaction again, not a verdict on whether it should have succeeded:
// `40001` serialization_failure, `40P01` deadlock_detected.
function isRetryableTransactionError(e: any): boolean {
  return e?.code === '40001' || e?.code === '40P01';
}

// Record the handler's verdict, retrying the transaction through
// serialization failures. `jobs` and `job_reservations` are hot tables that
// every worker's claim transaction predicate-reads at SERIALIZABLE, so a
// conflict here is ordinary contention and says nothing about whether the
// verdict is correct.
export async function finalizeJobVerdict(
  query: Querier,
  workerId: string,
  jobToRun: JobsTable,
  jobReservationId: number,
  newStatus: string,
  result: PgPrimitive,
): Promise<FinalizeOutcome> {
  let outcome: FinalizeOutcome = { type: 'conflict' };
  for (let attempt = 0; attempt <= FINALIZE_CONFLICT_RETRIES; attempt++) {
    outcome = await attemptJobFinalize(
      query,
      jobToRun,
      jobReservationId,
      newStatus,
      result,
    );
    if (outcome.type === 'superseded') {
      log.warn(
        `%s: discarding the '%s' verdict for job %s (type=%s) because %s`,
        workerId,
        newStatus,
        jobToRun.id,
        jobToRun.job_type,
        outcome.cause,
      );
      return outcome;
    }
    if (outcome.type === 'committed') {
      return outcome;
    }
    if (attempt < FINALIZE_CONFLICT_RETRIES) {
      await new Promise((r) =>
        setTimeout(r, FINALIZE_RETRY_BACKOFF_MS * (attempt + 1)),
      );
    }
  }
  // Out of retries with the verdict still unrecorded. Unlike the superseded
  // cases, nothing else owns this job's outcome — the work is simply lost,
  // and the job goes back in the queue for another attempt.
  let message =
    `${workerId}: could not record the '${newStatus}' verdict for job ` +
    `${jobToRun.id} (type=${jobToRun.job_type}) — the finalize transaction hit a ` +
    `serialization failure ${FINALIZE_CONFLICT_RETRIES + 1} times`;
  log.error(message);
  Sentry.captureMessage(message);
  return outcome;
}

// One attempt at the finalize transaction. Leaves the reservation open on
// every path so its fate is the caller's single decision.
export async function attemptJobFinalize(
  query: Querier,
  jobToRun: JobsTable,
  jobReservationId: number,
  newStatus: string,
  result: PgPrimitive,
): Promise<FinalizeOutcome> {
  try {
    await query(['BEGIN']);
    await query(['SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);
    let jobRows = (await query([
      'SELECT status FROM jobs WHERE id = ',
      param(jobToRun.id),
    ])) as Pick<JobsTable, 'status'>[];
    if (jobRows.length === 0 || jobRows[0].status !== 'unfulfilled') {
      await query(['ROLLBACK']);
      return {
        type: 'superseded',
        cause: 'the job already has a recorded outcome',
      };
    }
    let reservationRows = (await query([
      'SELECT *, locked_until < NOW() as expired FROM job_reservations WHERE id = ',
      param(jobReservationId),
    ])) as unknown as (JobReservationsTable & { expired: boolean })[];
    if (reservationRows.length === 0 || reservationRows[0].completed_at) {
      await query(['ROLLBACK']);
      return {
        type: 'superseded',
        cause: 'the reservation row is gone or already closed',
      };
    }
    if (reservationRows[0].expired) {
      // Our lease ran out while the handler was working, so the job became
      // claimable. Yield only to a reservation that is actually holding it
      // right now: an expired or closed sibling has no claim on the
      // outcome, and treating one as a competitor would throw away this
      // verdict on every retry of every job — the second attempt at a job
      // always has a sibling row.
      let [{ live }] = (await query([
        `SELECT COUNT(*)::int as live FROM job_reservations
           WHERE completed_at IS NULL AND locked_until > NOW()
             AND job_id = `,
        param(jobToRun.id),
        'AND id != ',
        param(jobReservationId),
      ])) as unknown as { live: number }[];
      if (live > 0) {
        await query(['ROLLBACK']);
        return {
          type: 'superseded',
          cause: 'the lease expired and the job was reserved again',
        };
      }
    }
    await query([
      `UPDATE jobs SET result=`,
      param(result),
      ', status=',
      param(newStatus),
      `, finished_at=now() WHERE id = `,
      param(jobToRun.id),
    ]);
    await query([
      `UPDATE job_reservations
           SET completed_at = now(), completion_reason = 'completed'
           WHERE id = `,
      param(jobReservationId),
    ]);
    // NOTIFY takes effect when the transaction actually commits. If it
    // doesn't commit, no notification goes out.
    await query([`NOTIFY jobs_finished`]);
    await query(['COMMIT']);
    return { type: 'committed' };
  } catch (e: any) {
    if (isRetryableTransactionError(e)) {
      await query(['ROLLBACK']);
      return { type: 'conflict' };
    }
    throw e;
  }
}

// Close a reservation whose finalize did not commit, so the lease is handed
// back now instead of aging out. Runs as a bare statement rather than inside
// the finalize transaction: that transaction is already rolled back, and a
// single-row UPDATE by primary key at the default isolation level is the
// least contended write available — which matters most in exactly the case
// that brought us here, repeated serialization failures.
//
// The reason decides whether the per-job cap counts this attempt, which is
// what stops a job retrying forever. The cap counts `'completed'` and still-
// open rows; `'interrupted'` is excluded. So the question is only ever "would
// running this job again plausibly go better?":
//
//   - Lease lapsed and the job was reserved again: no. The handler now runs
//     under the same deadline it just overran, so a job that deterministically
//     outlasts its lease would loop forever. This counts.
//   - Serialization failures exhausted the retries: yes. The work itself
//     succeeded and only the bookkeeping transaction failed, so the next
//     attempt is very likely to record a verdict. Burning an attempt here
//     would abandon a job with nothing wrong with it.
//   - The job already has an outcome, or the reservation is already closed:
//     moot. The job is terminal and will never be claimed again, so the reason
//     is bookkeeping only.
export async function releaseJobReservation(
  query: Querier,
  workerId: string,
  jobId: JobsTable['id'],
  jobReservationId: number,
  outcome: FinalizeOutcome,
): Promise<void> {
  let countsAsAttempt =
    outcome.type === 'superseded' &&
    outcome.cause === 'the lease expired and the job was reserved again';
  let reason = countsAsAttempt ? 'completed' : 'interrupted';
  try {
    await query([
      `UPDATE job_reservations
       SET completed_at = NOW(), completion_reason = `,
      param(reason),
      `WHERE completed_at IS NULL AND id = `,
      param(jobReservationId),
    ]);
    // The job may be claimable again now. Wake the runners rather than
    // leaving it for the poll interval.
    await query([`NOTIFY jobs`]);
  } catch (e: any) {
    // The lease still expires on its own, so the reservation is not stuck
    // forever — just for as long as the lease has left to run. Worth
    // reporting, not worth failing the work loop over.
    log.error(
      `%s: could not release reservation %s for job %s: %s`,
      workerId,
      jobReservationId,
      jobId,
      e?.message ?? e,
    );
    Sentry.captureException(e);
  }
}
