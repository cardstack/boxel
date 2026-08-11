import {
  query as runQuery,
  param,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

export interface StuckReservation {
  id: string;
  jobId: string;
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
// A row here says the worker should be recycled. It does not say the job is
// this worker's to fail — the job became claimable the instant the lease
// lapsed, so another worker may already own it. That question belongs to
// `markFailedJob`, which settles it in the same statement that writes the
// outcome; deciding it out here would only produce a snapshot that goes stale
// before the write lands.
export async function findStuckReservations(
  dbAdapter: DBAdapter,
  workerId: string,
  gracePeriodSeconds = 30,
): Promise<StuckReservation[]> {
  let rows = (await runQuery(dbAdapter, [
    `SELECT jr.id, jr.job_id
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
  ] as Expression)) as { id: string; job_id: string }[];

  return rows.map(({ id, job_id: jobId }) => ({
    id: String(id),
    jobId: String(jobId),
  }));
}
