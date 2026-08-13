import {
  logger,
  query as runQuery,
  param,
  separatedByCommas,
  type Expression,
} from '@cardstack/runtime-common';
import {
  acquireConcurrencyGroupLock,
  type PgAdapter,
} from '@cardstack/postgres';

const log = logger('worker-manager');

// `failed`         - the job now carries this worker's failure.
// `not-ours`       - the job already has an outcome, another worker holds a
//                    live reservation on it, or the row is gone. Whoever owns
//                    the job is the authority on its index rows too, so the
//                    caller must not stamp error docs either.
// `no-reservation` - no open reservation for this worker on this job, so there
//                    is nothing to attribute the failure to. Nothing else owns
//                    the outcome either, so index error docs are still the
//                    caller's to write.
export type MarkFailedJobResult = 'failed' | 'not-ours' | 'no-reservation';

// Record a worker's failure to produce a verdict onto the job itself, and close
// the reservation it was holding.
//
// The reservation closes as `'completed'` whichever way the job goes. The
// per-job cap excludes `'interrupted'`, so recording one here would mean a job
// that wedges its worker never accumulates attempts and never gets abandoned —
// it would be reclaimed, wedge the next worker, and repeat, killing a worker
// per round. Losing the race for the job's outcome does not change what this
// worker did, which is hold the job uninterrupted and produce nothing.
//
// Pass `reservationId` whenever the caller already knows which row it means.
// Without it the row is looked up, and that lookup is scoped to `workerId` — a
// job becomes claimable the moment its lease lapses, so an unscoped lookup can
// return the reservation of whichever worker holds the job *now*.
//
// The result tells the caller whether the job's outcome — and with it the
// authority over its index rows — ended up here or somewhere else.
export async function markFailedJob(
  dbAdapter: PgAdapter,
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

  // The lock below is keyed on the concurrency group, so it has to be read
  // first. Safe to read outside the lock: a job's group is fixed when the row is
  // inserted and nothing updates it (coalescing rewrites priority, timeout and
  // args only).
  let jobRows = (await runQuery(dbAdapter, [
    `SELECT concurrency_group FROM jobs WHERE id =`,
    param(jobId),
  ] as Expression)) as { concurrency_group: string | null }[];
  if (jobRows.length === 0) {
    log.info(
      `not failing job ${jobId} for worker ${workerId}: the job row is gone. Closing stale reservation ${id}`,
    );
    await closeReservation(dbAdapter, id);
    return 'not-ours';
  }

  return await dbAdapter.withConnection(async (query) => {
    await query(['BEGIN']);
    try {
      // Hold the lock the claim path holds. Without it, deciding this job is a
      // check-then-write against a snapshot a claim can invalidate: the
      // `NOT EXISTS` below reads `job_reservations` as of statement start, and
      // blocking on the claim's row lock does not re-evaluate it, so a job
      // claimed microseconds earlier would still be rejected. Under the lock the
      // two are exclusive in both orders — claim first and this write sees the
      // new reservation, or this write first and the claim's own
      // still-unfulfilled check fails.
      await acquireConcurrencyGroupLock(query, jobRows[0].concurrency_group);

      let rejected = (await query([
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

      // Close our own reservation in the same transaction as the verdict so the
      // two can never disagree. An open row past its lease is what the stuck-job
      // watchdog reads as a wedged worker, and leaving it would strand the lease
      // for whoever owns the job.
      await query([
        `UPDATE job_reservations
         SET completed_at = NOW(), completion_reason = 'completed'
         WHERE completed_at IS NULL AND id =`,
        param(id),
      ] as Expression);

      if (rejected.length > 0) {
        await query([`NOTIFY jobs_finished`]);
      }
      await query(['COMMIT']);

      if (rejected.length === 0) {
        log.info(
          `not failing job ${jobId} for worker ${workerId}: it already has an outcome or another worker holds a live reservation. Closed stale reservation ${id} instead`,
        );
        return 'not-ours';
      }
      return 'failed';
    } catch (e: unknown) {
      try {
        await query(['ROLLBACK']);
      } catch {
        // The advisory lock is released when the transaction aborts either way,
        // so a failed rollback leaves no stale lock behind.
      }
      throw e;
    }
  });
}

// Only for the job-row-is-gone path, which has no outcome to write and so no
// reason to take the concurrency-group lock.
async function closeReservation(
  dbAdapter: PgAdapter,
  reservationId: string,
): Promise<void> {
  await runQuery(dbAdapter, [
    `UPDATE job_reservations
     SET completed_at = NOW(), completion_reason = 'completed'
     WHERE completed_at IS NULL AND id =`,
    param(reservationId),
  ] as Expression);
}
