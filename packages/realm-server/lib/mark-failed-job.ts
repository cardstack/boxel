import {
  logger,
  query as runQuery,
  param,
  separatedByCommas,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

import { finalizeReservationById } from './finalize-orphan-reservations.ts';

const log = logger('worker-manager');

// Record a worker's failure to produce a verdict onto the job itself, and
// close the reservation it was holding.
//
// The reservation closes as `'completed'` rather than `'interrupted'`: the
// worker had uninterrupted access to the job and still produced nothing, which
// is a genuine attempt and should count toward the per-job cap. That is the
// distinction from the SIGTERM / child-exit paths in
// `finalize-orphan-reservations.ts`, where the worker never got a clean shot.
//
// Pass `reservationId` whenever the caller already knows which row it means.
// Without it the row is looked up, and that lookup is scoped to `workerId` —
// a job becomes claimable the moment its lease lapses, so an unscoped lookup
// can return the reservation of whichever worker holds the job *now*.
export async function markFailedJob(
  dbAdapter: DBAdapter,
  {
    workerId,
    jobId,
    reservationId,
    message,
  }: {
    workerId: string | undefined;
    jobId: string;
    message: string;
    reservationId?: string;
  },
): Promise<void> {
  log.info(`marking job ${jobId} as failed for worker ${workerId}`);
  let id: string;
  if (reservationId) {
    id = reservationId;
  } else {
    if (!workerId) {
      log.error(
        `Cannot determine job_reservation id for failed job ${jobId}: neither a reservation id nor a worker id was supplied`,
      );
      return;
    }
    let rows = (await runQuery(dbAdapter, [
      `SELECT id FROM job_reservations
       WHERE completed_at IS NULL AND job_id =`,
      param(jobId),
      `AND worker_id =`,
      param(workerId),
      `ORDER BY id DESC LIMIT 1`,
    ] as Expression)) as { id: string }[];
    if (rows.length === 0) {
      log.error(
        `Cannot determine job_reservation id for failed job ${jobId} of worker ${workerId}`,
      );
      return;
    }
    id = String(rows[0].id);
  }

  // Decline to decide a job that another worker is actively running. Writing
  // an outcome here would make that worker's finalize find a job which
  // already has one and drop the verdict it is about to produce — and its
  // reservation would be closed out from under it besides. Releasing our own
  // row is the whole job here: an open reservation past its lease is what the
  // stuck-job watchdog reads as a wedged worker.
  let live = (await runQuery(dbAdapter, [
    `SELECT 1 FROM job_reservations
     WHERE completed_at IS NULL AND locked_until > NOW()
       AND job_id =`,
    param(jobId),
    `AND id !=`,
    param(id),
    `LIMIT 1`,
  ] as Expression)) as unknown[];
  if (live.length > 0) {
    log.info(
      `not failing job ${jobId} for worker ${workerId}: another worker holds a live reservation, releasing stale reservation ${id} instead`,
    );
    await finalizeReservationById(dbAdapter, id);
    return;
  }

  await runQuery(dbAdapter, [
    `UPDATE jobs SET `,
    ...separatedByCommas([
      [
        `result =`,
        param({
          status: 500,
          message: `Worker manager detected fatal error in worker ${workerId} for job ${jobId} with job_reservation id ${id}: ${message}`,
        }),
      ],
      [`status = 'rejected'`],
      [`finished_at = NOW()`],
    ]),
    'WHERE id =',
    param(jobId),
  ] as Expression);
  await runQuery(dbAdapter, [
    `UPDATE job_reservations
     SET completed_at = NOW(), completion_reason = 'completed'
     WHERE id =`,
    param(id),
  ] as Expression);
  await runQuery(dbAdapter, [`NOTIFY jobs_finished`] as Expression);
}
