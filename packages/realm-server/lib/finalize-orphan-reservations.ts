import * as Sentry from '@sentry/node';
import {
  logger,
  query as runQuery,
  param,
  separatedByCommas,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

const log = logger('worker-manager');

interface OrphanReservationContext {
  workerId: string | undefined;
  jobId?: string;
}

// Finalize any reservations belonging to a worker that exited unexpectedly so
// the next worker can claim the job immediately, rather than waiting for the
// 7200s lease (locked_until) to age out. Without this, a worker dying via
// SIGKILL / OOM / crash leaves its in-flight reservation with completed_at
// NULL, blocking redelivery for up to two hours per attempt.
//
// Two concerns, executed independently with their own try/catch so a DB blip
// in either path does not prevent the caller from spawning a replacement
// worker:
//
//   1. Belt-and-suspenders bulk update: clear completed_at for every open
//      reservation owned by this worker. Catches the case where the worker
//      took a job but the IPC `status|start` message did not reach the
//      manager, so we have no jobId to target.
//
//   2. Job-level rejection: if we know the jobId from the most recent
//      `status|start` IPC, mark the corresponding jobs row as 'rejected' with
//      a diagnostic message in result. This wakes any waiters via the
//      jobs_finished NOTIFY and gives operators a useful trail.
export async function finalizeOrphanedReservations(
  dbAdapter: DBAdapter,
  { workerId, jobId }: OrphanReservationContext,
): Promise<void> {
  if (!workerId) {
    return;
  }

  try {
    await runQuery(dbAdapter, [
      `UPDATE job_reservations SET completed_at = NOW() WHERE worker_id =`,
      param(workerId),
      `AND completed_at IS NULL`,
    ] as Expression);
  } catch (e) {
    Sentry.captureException(e);
    log.error(
      `worker: failed to finalize orphan reservations for worker ${workerId}`,
      e,
    );
  }

  if (!jobId) {
    return;
  }

  try {
    await markRejectedJob(dbAdapter, {
      workerId,
      jobId,
      message: 'worker exited unexpectedly',
    });
  } catch (e) {
    Sentry.captureException(e);
    log.error(
      `worker: failed to mark job ${jobId} rejected for worker ${workerId}`,
      e,
    );
  }
}

// Mirrors the row updates that markFailedJob in worker-manager.ts performs,
// but resolves the reservation by worker_id + job_id rather than a known
// reservationId, and is idempotent against an already-completed reservation
// (the bulk UPDATE above may have completed it first).
async function markRejectedJob(
  dbAdapter: DBAdapter,
  {
    workerId,
    jobId,
    message,
  }: { workerId: string; jobId: string; message: string },
): Promise<void> {
  let reservations = (await runQuery(dbAdapter, [
    `SELECT id FROM job_reservations WHERE job_id =`,
    param(jobId),
    `AND worker_id =`,
    param(workerId),
    `ORDER BY id DESC LIMIT 1`,
  ] as Expression)) as { id: string }[];

  if (reservations.length === 0) {
    log.info(
      `no reservation found for job ${jobId} of worker ${workerId} during exit finalize`,
    );
    return;
  }

  let reservationId = reservations[0].id;

  await runQuery(dbAdapter, [
    `UPDATE jobs SET `,
    ...separatedByCommas([
      [
        `result =`,
        param({
          status: 500,
          message: `Worker manager detected fatal error in worker ${workerId} for job ${jobId} with job_reservation id ${reservationId}: ${message}`,
        }),
      ],
      [`status = 'rejected'`],
      [`finished_at = NOW()`],
    ]),
    'WHERE id =',
    param(jobId),
    `AND status <> 'resolved' AND status <> 'rejected'`,
  ] as Expression);

  // Idempotent: if the bulk UPDATE in finalizeOrphanedReservations already
  // closed this reservation, the WHERE filter makes this a no-op.
  await runQuery(dbAdapter, [
    `UPDATE job_reservations SET completed_at = NOW() WHERE id =`,
    param(reservationId),
    `AND completed_at IS NULL`,
  ] as Expression);

  await runQuery(dbAdapter, [`NOTIFY jobs_finished`] as Expression);
}
