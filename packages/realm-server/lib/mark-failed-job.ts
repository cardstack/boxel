import {
  logger,
  query as runQuery,
  param,
  separatedByCommas,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

const log = logger('worker-manager');

// `failed`         - the job now carries this worker's failure.
// `not-ours`       - the job already has an outcome, or another worker holds a
//                    live reservation on it. That worker is the authority on
//                    the job AND on its index rows, so the caller must not
//                    stamp error docs either.
// `no-reservation` - no open reservation for this worker on this job, so there
//                    is nothing to attribute the failure to. Nothing else owns
//                    the outcome either, so index error docs are still the
//                    caller's to write.
export type MarkFailedJobResult = 'failed' | 'not-ours' | 'no-reservation';

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
//
// The result tells the caller whether the job's outcome — and with it the
// authority over its index rows — ended up here or somewhere else.
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
): Promise<MarkFailedJobResult> {
  let id: string;
  if (reservationId) {
    id = reservationId;
  } else {
    if (!workerId) {
      log.error(
        `Cannot determine job_reservation id for failed job ${jobId}: neither a reservation id nor a worker id was supplied`,
      );
      return 'no-reservation';
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
      return 'no-reservation';
    }
    id = String(rows[0].id);
  }

  // Reject only a job that is still undecided and that no other worker is
  // holding, tested in the same statement that writes the outcome. A lapsed
  // lease makes the job claimable, so a separate check-then-write leaves a
  // window for a fresh attempt to start in between — and writing an outcome
  // over it makes that worker's finalize find a job which already has one and
  // drop the verdict it is about to produce.
  let rejected = (await runQuery(dbAdapter, [
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
    `WHERE status = 'unfulfilled' AND id =`,
    param(jobId),
    `AND NOT EXISTS (
       SELECT 1 FROM job_reservations r
        WHERE r.job_id = jobs.id
          AND r.completed_at IS NULL
          AND r.locked_until > NOW()
          AND r.id <>`,
    param(id),
    `)
     RETURNING id`,
  ] as Expression)) as { id: string }[];

  // Close our own reservation either way. An open row past its lease is what
  // the stuck-job watchdog reads as a wedged worker, and leaving it would
  // strand the lease for whoever owns the job.
  //
  // `'completed'` either way too, and that matters: the cap excludes
  // `'interrupted'`, so recording one here would mean a job that wedges its
  // worker never accumulates attempts and never gets abandoned — it would be
  // reclaimed, wedge the next worker, and repeat, killing a worker per round.
  // Losing the race for the job's outcome doesn't change what this worker did,
  // which is hold the job uninterrupted and produce nothing.
  await runQuery(dbAdapter, [
    `UPDATE job_reservations
     SET completed_at = NOW(), completion_reason = 'completed'
     WHERE completed_at IS NULL AND id =`,
    param(id),
  ] as Expression);

  if (rejected.length === 0) {
    log.info(
      `not failing job ${jobId} for worker ${workerId}: it already has an outcome or another worker holds a live reservation. Closed stale reservation ${id} instead`,
    );
    return 'not-ours';
  }

  await runQuery(dbAdapter, [`NOTIFY jobs_finished`] as Expression);
  return 'failed';
}
