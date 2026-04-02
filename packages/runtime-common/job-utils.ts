import type { DBAdapter } from './db';
import {
  dbExpression,
  param,
  query,
  separatedByCommas,
  type Expression,
  type PgPrimitive,
} from './expression';

export const userInitiatedJobCancellationResult = Object.freeze({
  status: 418,
  message: 'User initiated job cancellation',
});

export async function forceCancelJobById(
  dbAdapter: DBAdapter,
  jobId: string,
  result: PgPrimitive = userInitiatedJobCancellationResult,
): Promise<void> {
  await query(dbAdapter, [
    `UPDATE jobs SET`,
    ...separatedByCommas([
      [`result =`, param(result)],
      [`status = 'rejected'`],
      [
        dbExpression({
          pg: `finished_at = NOW()`,
          sqlite: `finished_at = CURRENT_TIMESTAMP`,
        }),
      ],
    ]),
    `WHERE id =`,
    param(jobId),
  ] as Expression);

  await query(dbAdapter, [
    `UPDATE job_reservations SET`,
    dbExpression({
      pg: `completed_at = NOW()`,
      sqlite: `completed_at = CURRENT_TIMESTAMP`,
    }),
    `WHERE job_id =`,
    param(jobId),
    `AND completed_at IS NULL`,
  ] as Expression);

  if (dbAdapter.kind === 'pg') {
    await query(dbAdapter, [`NOTIFY jobs_finished`] as Expression);
  }
}

export async function findJobIdForReservationId(
  dbAdapter: DBAdapter,
  reservationId: string,
): Promise<string | null> {
  let [row] = (await query(dbAdapter, [
    `SELECT job_id FROM job_reservations WHERE id =`,
    param(reservationId),
  ] as Expression)) as { job_id: string }[];

  return row?.job_id ?? null;
}

export async function findRunningJobIdsForConcurrencyGroup(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<string[]> {
  let rows = (await query(dbAdapter, [
    `SELECT DISTINCT j.id FROM jobs j`,
    `INNER JOIN job_reservations jr ON jr.job_id = j.id`,
    `WHERE j.concurrency_group =`,
    param(concurrencyGroup),
    `AND j.status = 'unfulfilled'`,
    `AND jr.completed_at IS NULL`,
    `AND`,
    dbExpression({
      pg: `jr.locked_until > NOW()`,
      sqlite: `jr.locked_until > CURRENT_TIMESTAMP`,
    }),
    `ORDER BY j.id ASC`,
  ] as Expression)) as { id: string }[];
  return rows.map((row) => row.id);
}

export async function cancelRunningJobsInConcurrencyGroup(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<string[]> {
  let runningJobIds = await findRunningJobIdsForConcurrencyGroup(
    dbAdapter,
    concurrencyGroup,
  );
  for (let jobId of runningJobIds) {
    await forceCancelJobById(dbAdapter, jobId);
  }
  return runningJobIds;
}

/**
 * Cancel ALL jobs in a concurrency group — both running (active reservations)
 * and pending (unfulfilled, no active reservation).
 */
export async function cancelAllJobsInConcurrencyGroup(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<{ cancelledRunning: string[]; cancelledPending: string[] }> {
  let cancelledRunning = await cancelRunningJobsInConcurrencyGroup(
    dbAdapter,
    concurrencyGroup,
  );

  let pendingRows = (await query(dbAdapter, [
    `SELECT id FROM jobs WHERE concurrency_group =`,
    param(concurrencyGroup),
    `AND status = 'unfulfilled'`,
  ] as Expression)) as { id: string }[];

  let cancelledPending: string[] = [];
  for (let row of pendingRows) {
    await forceCancelJobById(dbAdapter, row.id);
    cancelledPending.push(row.id);
  }

  return { cancelledRunning, cancelledPending };
}
