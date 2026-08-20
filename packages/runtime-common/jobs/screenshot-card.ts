import { param, query, type Expression } from '../expression.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  type QueuePublisher,
} from '../queue.ts';
import type { ScreenshotPrerenderResponse, DBAdapter } from '../index.ts';
import type {
  ScreenshotCardArgs,
  ScreenshotPersistArgs,
} from '../tasks/screenshot-card.ts';

export const SCREENSHOT_CARD_JOB_TIMEOUT_SEC = 60;

// Concurrent requests for one capture fold onto one job: the per-realm
// concurrency group serializes execution but does not dedupe, so without
// this two simultaneous misses for the same spec would each run a full
// render (the store's dedupe-on-write only saves the second upload, not the
// Chrome work). A twin must match the whole capture identity — card, format,
// render identity, and persist target — since joining hands the incoming
// caller the twin's result verbatim. Queued and in-flight twins both join;
// an in-flight join just registers a late waiter on the running job.
function chooseScreenshotCardCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let incomingArgs = parseScreenshotCardArgs(incoming.args);
  if (!incomingArgs) {
    return { type: 'insert' };
  }
  let twin = [...candidates, ...inFlightCandidates].find((candidate) => {
    if (candidate.jobType !== incoming.jobType) {
      return false;
    }
    let candidateArgs = parseScreenshotCardArgs(candidate.args);
    return (
      candidateArgs !== undefined &&
      candidateArgs.cardId === incomingArgs.cardId &&
      candidateArgs.format === incomingArgs.format &&
      candidateArgs.runAs === incomingArgs.runAs &&
      samePersist(candidateArgs.persist, incomingArgs.persist)
    );
  });
  if (!twin) {
    return { type: 'insert' };
  }
  return { type: 'join', jobId: twin.id };
}

function parseScreenshotCardArgs(
  args: unknown,
): ScreenshotCardArgs | undefined {
  let obj: unknown = args;
  if (typeof args === 'string') {
    try {
      obj = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return undefined;
  }
  let { cardId, format, runAs } = obj as Record<string, unknown>;
  if (
    typeof cardId !== 'string' ||
    typeof format !== 'string' ||
    typeof runAs !== 'string'
  ) {
    return undefined;
  }
  return obj as ScreenshotCardArgs;
}

// Field-by-field rather than JSON.stringify: one side round-trips through
// jsonb, which does not preserve key order.
function samePersist(
  a: ScreenshotPersistArgs | null | undefined,
  b: ScreenshotPersistArgs | null | undefined,
): boolean {
  if (!a || !b) {
    return !a && !b;
  }
  return (
    a.realmURL === b.realmURL &&
    a.sourceURL === b.sourceURL &&
    a.captureSpecHash === b.captureSpecHash &&
    a.sourceGeneration === b.sourceGeneration &&
    a.lane === b.lane
  );
}

registerQueueJobDefinition({
  jobType: 'screenshot-card',
  coalesce: chooseScreenshotCardCoalesceDecision,
});

// How long a GET `_screenshot/` request holds its connection waiting for an
// on-demand capture before answering 503 + Retry-After. A cost-posture
// bound, not a transport one (the realm-server ALB's idle timeout is far
// above this): sync-wait callers are humans, agents, and scripts that honor
// Retry-After — HTML and crawlers live on the never-waiting `name=` path —
// so the hold is a courtesy and the Retry-After is the contract.
export const SCREENSHOT_SYNC_WAIT_BUDGET_MS = 25_000;

// The stand-in capture estimate while the jobs table holds no recent
// screenshot history to average.
const DEFAULT_CAPTURE_ESTIMATE_MS = 10_000;
const CAPTURE_DURATION_LOOKBACK_HOURS = 1;

export interface ScreenshotQueueEstimate {
  pending: number;
  avgCaptureMs: number;
  // queue depth × average capture time: what a new arrival would wait
  // behind the realm's serialized screenshot lane before its own capture
  // even starts.
  estimatedWaitMs: number;
}

// The fail-fast congestion pre-check for a capture-triggering request:
// when the realm's serialized screenshot lane is already deep enough that a
// new arrival's wait would blow the sync budget, the caller answers 503 +
// Retry-After immediately instead of holding a doomed connection against
// the queue. The jobs-table SQL is Postgres-shaped; on any other adapter
// (an in-memory test realm) the estimate is zero, which simply skips the
// pre-check.
export async function estimateScreenshotQueueWait(
  dbAdapter: DBAdapter,
  concurrencyGroup: string,
): Promise<ScreenshotQueueEstimate> {
  if (dbAdapter.kind !== 'pg') {
    return { pending: 0, avgCaptureMs: 0, estimatedWaitMs: 0 };
  }
  let [pendingRows, durationRows] = await Promise.all([
    query(dbAdapter, [
      `SELECT COUNT(*) AS pending FROM jobs WHERE status = 'unfulfilled' AND concurrency_group =`,
      param(concurrencyGroup),
    ] as Expression) as Promise<{ pending: number | string }[]>,
    // Execution time is reservation-claim → job-finish (there is no
    // started_at column); resolved captures only, bounded lookback so the
    // estimate tracks current conditions.
    query(dbAdapter, [
      `SELECT AVG(EXTRACT(EPOCH FROM (j.finished_at - jr.created_at)) * 1000) AS avg_ms
       FROM jobs j
       JOIN job_reservations jr ON jr.job_id = j.id AND jr.completed_at IS NOT NULL
       WHERE j.job_type = 'screenshot-card'
         AND j.status = 'resolved'
         AND j.finished_at > NOW() - INTERVAL '${CAPTURE_DURATION_LOOKBACK_HOURS} hours'`,
    ] as Expression) as Promise<{ avg_ms: number | string | null }[]>,
  ]);
  let pending = Number(pendingRows[0]?.pending ?? 0);
  let avgRaw = durationRows[0]?.avg_ms;
  let avgCaptureMs =
    avgRaw == null ? DEFAULT_CAPTURE_ESTIMATE_MS : Number(avgRaw);
  return {
    pending,
    avgCaptureMs,
    estimatedWaitMs: pending * avgCaptureMs,
  };
}

export async function enqueueScreenshotCardJob(
  args: ScreenshotCardArgs,
  queue: QueuePublisher,
  _dbAdapter: DBAdapter,
  priority: number,
  opts?: { concurrencyGroup?: string },
) {
  let job = await queue.publish<ScreenshotPrerenderResponse>({
    jobType: 'screenshot-card',
    concurrencyGroup: opts?.concurrencyGroup ?? `screenshot:${args.realmURL}`,
    timeout: SCREENSHOT_CARD_JOB_TIMEOUT_SEC,
    priority,
    args,
  });
  return job;
}
