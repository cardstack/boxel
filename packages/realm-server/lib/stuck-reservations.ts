import {
  query as runQuery,
  param,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

export interface StuckReservation {
  id: string;
  jobId: string;
  // Another worker holds a live reservation on this job right now, so this
  // row is a stale orphan and the job's outcome is no longer ours to decide.
  reclaimed: boolean;
}

// Reservations owned by `workerId` whose lease has aged out without the worker
// recording a verdict. Once pg-queue closes its own reservation on every
// finalize path — including the ones that decline to write a verdict — the
// only way a row reaches this state is a child that never returned from its
// handler, which is what makes recycling the worker the right response.
//
// The grace period past `locked_until` keeps a worker that is finalizing right
// now out of the result: the lease boundary is not synchronized with the
// finalize transaction, so a job that runs to the very edge of its lease would
// otherwise be reaped while its COMMIT is in flight.
//
// `reclaimed` exists because a stale orphan and a live attempt can coexist:
// the job became claimable the moment the lease lapsed, so another worker may
// already own it. Rejecting the job in that case would make the running
// worker's finalize find a row that is no longer 'unfulfilled' and discard a
// completion it was about to record — the same race
// `finalizeOrphanedReservations` declines to run. Only a reservation that is
// both open and unexpired counts as a live competitor; an expired or closed
// sibling has no claim on the outcome.
export async function findStuckReservations(
  dbAdapter: DBAdapter,
  workerId: string,
  gracePeriodSeconds = 30,
): Promise<StuckReservation[]> {
  let rows = (await runQuery(dbAdapter, [
    `SELECT jr.id, jr.job_id,
       EXISTS (
         SELECT 1 FROM job_reservations live
          WHERE live.job_id = jr.job_id
            AND live.id > jr.id
            AND live.completed_at IS NULL
            AND live.locked_until > NOW()
       ) AS reclaimed
     FROM job_reservations jr
     WHERE jr.worker_id =`,
    param(workerId),
    `AND jr.completed_at IS NULL
     AND jr.locked_until < NOW() - (`,
    param(gracePeriodSeconds),
    `|| ' seconds')::interval
     AND NOT EXISTS (`,
    // Skip stale reservations if this worker has already retried the job with
    // a newer reservation.
    `  SELECT 1 FROM job_reservations newer
        WHERE newer.worker_id = jr.worker_id
          AND newer.job_id = jr.job_id
          AND newer.id > jr.id
     )
     ORDER BY jr.id`,
  ] as Expression)) as { id: string; job_id: string; reclaimed: boolean }[];

  return rows.map(({ id, job_id: jobId, reclaimed }) => ({
    id: String(id),
    jobId: String(jobId),
    reclaimed,
  }));
}
