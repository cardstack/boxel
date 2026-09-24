import type { DBAdapter } from './db.ts';
import {
  dbAdapterQuerier,
  dbExpression,
  param,
  query,
  separatedByCommas,
  type Expression,
  type PgPrimitive,
  type Querier,
} from './expression.ts';
import { laneFamilyPredicate } from './jobs/lane-family.ts';

export const userInitiatedJobCancellationResult = Object.freeze({
  status: 418,
  message: 'User initiated job cancellation',
});

export async function forceCancelJobById(
  dbAdapter: DBAdapter,
  jobId: string,
  result: PgPrimitive = userInitiatedJobCancellationResult,
  querier?: Querier,
): Promise<void> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  await q([
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

  await q([
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
    await q([`NOTIFY jobs_finished`] as Expression);
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

// The running jobs of every lane in `laneFamily` — its exclusive work and each
// of its writer lanes. A realm's index and prerender-html lanes are families,
// named by `indexingConcurrencyGroup` and `prerenderHtmlConcurrencyGroup`, so
// stopping a realm's work stops all of it rather than one lane's.
export async function findRunningJobIdsInLaneFamily(
  dbAdapter: DBAdapter,
  laneFamily: string,
  querier?: Querier,
): Promise<string[]> {
  let q = querier ?? dbAdapterQuerier(dbAdapter);
  let rows = (await q([
    `SELECT DISTINCT j.id FROM jobs j`,
    `INNER JOIN job_reservations jr ON jr.job_id = j.id`,
    `WHERE`,
    ...laneFamilyPredicate(laneFamily, 'j'),
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

export async function cancelRunningJobsInLaneFamily(
  dbAdapter: DBAdapter,
  laneFamily: string,
  querier?: Querier,
): Promise<string[]> {
  let runningJobIds = await findRunningJobIdsInLaneFamily(
    dbAdapter,
    laneFamily,
    querier,
  );
  for (let jobId of runningJobIds) {
    await forceCancelJobById(
      dbAdapter,
      jobId,
      userInitiatedJobCancellationResult,
      querier,
    );
  }
  return runningJobIds;
}

/**
 * Cancel ALL jobs in a lane family — both running (active reservations) and
 * pending (unfulfilled, no active reservation), in every lane of the family.
 */
export async function cancelAllJobsInLaneFamily(
  dbAdapter: DBAdapter,
  laneFamily: string,
): Promise<{ cancelledRunning: string[]; cancelledPending: string[] }> {
  let cancelledRunning = await cancelRunningJobsInLaneFamily(
    dbAdapter,
    laneFamily,
  );

  let pendingRows = (await query(dbAdapter, [
    `SELECT id FROM jobs WHERE`,
    ...laneFamilyPredicate(laneFamily),
    `AND status = 'unfulfilled'`,
  ] as Expression)) as { id: string }[];

  let cancelledPending: string[] = [];
  for (let row of pendingRows) {
    await forceCancelJobById(dbAdapter, row.id);
    cancelledPending.push(row.id);
  }

  return { cancelledRunning, cancelledPending };
}
