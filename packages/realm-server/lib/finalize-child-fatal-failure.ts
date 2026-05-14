import * as Sentry from '@sentry/node';
import {
  logger,
  query as runQuery,
  param,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

const log = logger('worker-fatal');

// Sibling to `finalizeOrphanedReservations`. Runs from the CHILD worker
// process when it's about to exit via an unhandled rejection or
// uncaught exception — the worker had uninterrupted access to a job
// and crashed without pg-queue's own catch path running.
//
// That counts as a real failed attempt for the per-job reservation cap,
// so we close with `completion_reason = 'completed'`. The cap query
// (pg-queue.ts) counts only 'completed' and NULL; without this path a
// deterministic-crash job loops forever because the parent's
// `worker.on('exit')` stamps the reservation as 'interrupted', which
// the cap explicitly excludes.
//
// Best-effort: if the DB connection is also damaged at fatal-exit
// time, we accept that the parent will stamp 'interrupted' and the
// loop will continue. That's the existing behavior — this function is
// strictly additive when it does succeed.
export async function finalizeChildReservationAsFailure(
  dbAdapter: DBAdapter,
  workerId: string,
): Promise<void> {
  try {
    await runQuery(dbAdapter, [
      `UPDATE job_reservations
       SET completed_at = NOW(),
           completion_reason = 'completed'
       WHERE worker_id =`,
      param(workerId),
      `AND completed_at IS NULL`,
    ] as Expression);
  } catch (e) {
    try {
      Sentry.captureException(e);
    } catch {
      // Sentry can be unavailable in some environments; swallow.
    }
    log.error(
      `worker-fatal: failed to finalize reservation as completed for ${workerId}: ${(e as Error)?.message}`,
    );
  }
}
