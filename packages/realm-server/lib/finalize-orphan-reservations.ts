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

// Whether a child's stderr is V8 reporting that its heap ran out. V8 prints
// this and aborts the process, so no handler in the child runs: the parent
// sees only the text and then the exit.
export function isHeapExhaustion(stderr: string): boolean {
  return (
    stderr.includes('JavaScript heap out of memory') ||
    stderr.includes('Reached heap limit')
  );
}

// Whether the attempt under reservation `r` staged a row no earlier attempt of
// its job had: its staging (`job:<job>.<reservation>`, see `jobStagingId`)
// holds a URL and type that no other staging of the job holds. A resumed
// attempt starts by copying earlier attempts' rows into its own staging, and
// those keep their rows too, so a copied row always has a match and only a
// file this attempt visited counts. An attempt that ran its heap out without
// one (a pass that dies in discovery, before its first visit) would resume
// from nothing and die the same way again, so it is closed as
// `'heap-exhausted-without-progress'` and counts toward the ordinary cap.
const STAGED_PROGRESS = ['boxel_index_pending', 'prerendered_html_pending']
  .map(
    (table) => `EXISTS (
      SELECT 1 FROM ${table} AS mine
      WHERE mine.job_id = r.job_id
        AND mine.staging_id = 'job:' || r.job_id || '.' || r.id
        AND NOT EXISTS (
          SELECT 1 FROM ${table} AS earlier
          WHERE earlier.job_id = mine.job_id
            AND earlier.url = mine.url
            AND earlier.type = mine.type
            AND earlier.staging_id <> mine.staging_id
        )
    )`,
  )
  .join(' OR ');

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
  reason:
    | 'interrupted'
    | 'killed'
    | 'heap-exhausted'
    | 'timeout-expired' = 'interrupted',
): Promise<void> {
  if (!workerId) {
    return;
  }

  try {
    await runQuery(dbAdapter, [
      `UPDATE job_reservations AS r
       SET completed_at = NOW(), completion_reason =`,
      ...(reason === 'heap-exhausted'
        ? [
            `CASE WHEN ${STAGED_PROGRESS} THEN 'heap-exhausted' ELSE 'heap-exhausted-without-progress' END`,
          ]
        : [param(reason)]),
      `WHERE r.worker_id =`,
      param(workerId),
      `AND r.completed_at IS NULL`,
    ] as Expression);
  } catch (e) {
    Sentry.captureException(e);
    log.error(
      `worker: failed to finalize orphan reservations for worker ${workerId}`,
      e,
    );
  }
}
