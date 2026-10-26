import * as Sentry from '@sentry/node';
import {
  logger,
  query as runQuery,
  param,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

const log = logger('worker-manager');

// The reason to close a dead child's open reservations with, from how it
// exited. Nothing in the worker-manager sends a child SIGKILL except its own
// shutdown's straggler phase, so a SIGKILL outside a shutdown came from
// outside the manager — in practice the kernel's out-of-memory killer.
export function orphanedReservationReason(
  signal: NodeJS.Signals | null,
  managerIsShuttingDown: boolean,
): 'killed' | 'interrupted' {
  return signal === 'SIGKILL' && !managerIsShuttingDown
    ? 'killed'
    : 'interrupted';
}

// Free any reservations belonging to a worker that exited unexpectedly so the
// next worker can claim the job immediately, rather than waiting for the
// 7200s lease (locked_until) to age out. Without this, a worker dying via
// SIGKILL / OOM / crash leaves its in-flight reservation with completed_at
// NULL, blocking redelivery for up to two hours per attempt.
//
// Deliberately does NOT mark the job rejected. Two reasons:
//
//   1. Race avoidance. Once we set completed_at on the orphan reservation,
//      the job is immediately claimable by another worker. A separate
//      "mark rejected" step that ran afterward would race against that new
//      worker and could flip the job to 'rejected' under their feet,
//      causing their successful completion write to be dropped by the
//      `status !== 'unfulfilled'` guard in pg-queue's finalize path.
//
//   2. Redundancy with the per-job reservation cap. PgQueueRunner already
//      abandons jobs that have hit MAX_RESERVATION_COUNT_PER_JOB on the
//      next claim attempt with a clear "abandoned after N failed attempts"
//      diagnostic. So a deterministic-crash job dies cleanly via the cap
//      without needing this path to short-circuit it; a transient-crash
//      job gets the retry the cap allows.
//
// `reason` records *why* the reservation closed so the cap query can
// distinguish operational interruptions (child crash, manager SIGTERM)
// from genuine completed attempts. A child that exits while still holding
// a reservation never finished the work, so most call sites pass
// `'interrupted'`, which the cap doesn't count. The exception is a child
// SIGKILLed outside a graceful shutdown, closed as `'killed'`, which the
// cap does count: that is how the kernel's out-of-memory killer ends a
// worker, and a job that exhausts the container's memory does it again on
// every retry, taking down whichever worker on that task the kernel picks.
// The pg-queue's own success/failure finalize path sets `'completed'`
// separately; this function never owns that case.
export async function finalizeOrphanedReservations(
  dbAdapter: DBAdapter,
  workerId: string | undefined,
  reason: 'interrupted' | 'killed' | 'timeout-expired' = 'interrupted',
): Promise<void> {
  if (!workerId) {
    return;
  }

  try {
    await runQuery(dbAdapter, [
      `UPDATE job_reservations
       SET completed_at = NOW(), completion_reason =`,
      param(reason),
      `WHERE worker_id =`,
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
}
