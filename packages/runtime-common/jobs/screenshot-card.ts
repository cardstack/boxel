import { param, query, type Expression } from '../expression.ts';
import {
  registerQueueJobDefinition,
  type QueueCoalesceContext,
  type QueueCoalesceDecision,
  type QueuePublisher,
} from '../queue.ts';
import type {
  ScreenshotCaptureSpec,
  ScreenshotPrerenderResponse,
  DBAdapter,
} from '../index.ts';
import type {
  ScreenshotCardArgs,
  ScreenshotPersistArgs,
} from '../tasks/screenshot-card.ts';

// Timeout for a screenshot job — a wedged-worker backstop covering one render +
// settle + the capture loop. A batch captures every entry from a single settle,
// so the marginal per-entry cost (viewport resize + screenshot) is small, and
// the batch ceiling (`SCREENSHOT_MAX_CAPTURES`) is sized to finish well within
// the sync-wait budget; one flat value covers singular and batch alike, so the
// timeout does not scale with capture count. The render itself is separately
// capped at `cardRenderTimeout` (RENDER_TIMEOUT_MS, default 60s), so a slow
// render surfaces as a Render timeout regardless of this value — this is the
// backstop for a worker wedged outside the render (dispatch, result upload).
export const SCREENSHOT_CARD_JOB_TIMEOUT_SEC = 60;

// Concurrent requests for one capture fold onto one job: the per-realm
// concurrency group serializes execution but does not dedupe, so without
// this two simultaneous misses for the same spec would each run a full
// render (the store's dedupe-on-write only saves the second upload, not the
// Chrome work). A twin must match the whole capture identity — card, format,
// render identity, captureSpec, and persist target — since joining hands the
// incoming caller the twin's result verbatim. Queued and in-flight twins
// both join; an in-flight join just registers a late waiter on the running
// job.
//
// Only persist-carrying jobs coalesce — both surfaces publish them: the GET
// `_screenshot/` lane always, `POST /_screenshot-card` whenever the instance
// is indexed and the server has a store. A persist target pins the source
// generation, so a joined caller can never be handed a capture of a
// different revision. A `persist: null` job (unindexed card, or a server
// with no MediaCache) is a render-now request whose identity carries no
// freshness axis — an in-flight twin could be up to a reservation-lease old
// and of a pre-edit card — so those always insert. The persist identity's
// `captureSpecHash` covers captureSpec overrides (viewport / scale /
// fullPage / clip), so same-spec custom captures coalesce like canonical
// ones; the `sameCaptureSpec` compare below is belt-and-braces against a
// producer whose hash and spec disagree, since joining hands the incoming
// caller the twin's render verbatim. The `runAs` equality keeps joins
// within one render identity: the GET lane renders as the realm owner and
// the POST lane as the requester, so cross-surface twins never join even
// when their persist targets match.
export function chooseScreenshotCardCoalesceDecision(
  context: QueueCoalesceContext,
): QueueCoalesceDecision {
  let { incoming, candidates, inFlightCandidates } = context;
  let incomingArgs = parseScreenshotCardArgs(incoming.args);
  if (!incomingArgs || !incomingArgs.persist) {
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
      sameCaptureSpec(candidateArgs.captureSpec, incomingArgs.captureSpec) &&
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
// jsonb, which does not preserve key order. Producers normalize specs via
// `parseScreenshotCaptureSpec` (defaults elided), so a default-valued field
// never appears on one side only.
function sameCaptureSpec(
  a: ScreenshotCaptureSpec | null | undefined,
  b: ScreenshotCaptureSpec | null | undefined,
): boolean {
  if (!a || !b) {
    return !a && !b;
  }
  return (
    (a.viewport?.width ?? null) === (b.viewport?.width ?? null) &&
    (a.viewport?.height ?? null) === (b.viewport?.height ?? null) &&
    (a.deviceScaleFactor ?? null) === (b.deviceScaleFactor ?? null) &&
    (a.fullPage ?? false) === (b.fullPage ?? false) &&
    (a.clip?.x ?? null) === (b.clip?.x ?? null) &&
    (a.clip?.y ?? null) === (b.clip?.y ?? null) &&
    (a.clip?.width ?? null) === (b.clip?.width ?? null) &&
    (a.clip?.height ?? null) === (b.clip?.height ?? null)
  );
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
  // True when a queued or in-flight job already carries this exact capture
  // identity — persist target AND `runAs`, the full coalesce key: the
  // incoming request would coalesce onto it and cost no new Chrome work, so
  // the caller skips the congestion pre-check rather than 503-ing a request
  // the lane is about to satisfy for free.
  hasTwin: boolean;
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
  // The capture identity about to be requested: the persist target plus the
  // `runAs` the caller would render under. When a queued or in-flight job
  // already matches all of it, the request coalesces rather than rendering,
  // so `hasTwin` lets the caller bypass the congestion gate. `runAs` must be
  // part of the match because the coalesce join requires it — a persist-only
  // match would report jobs the caller cannot actually join (a POST job runs
  // as its requester, a GET job as the realm owner) and wave a
  // gate-skipping request into a lane that then renders anyway.
  twinOf?: {
    sourceURL: string;
    captureSpecHash: string;
    sourceGeneration: number;
    runAs: string;
  },
): Promise<ScreenshotQueueEstimate> {
  if (dbAdapter.kind !== 'pg') {
    return { pending: 0, avgCaptureMs: 0, estimatedWaitMs: 0, hasTwin: false };
  }
  let [pendingRows, durationRows, twinRows] = await Promise.all([
    query(dbAdapter, [
      `SELECT COUNT(*) AS pending FROM jobs
        WHERE status = 'unfulfilled'
          AND job_type = 'screenshot-card'
          AND concurrency_group =`,
      param(concurrencyGroup),
    ] as Expression) as Promise<{ pending: number | string }[]>,
    // Execution time is reservation-claim → job-finish (there is no
    // started_at column). Aggregate per job and measure from the last
    // (winning) claim: a lease-lapsed retry leaves an earlier abandoned
    // reservation whose completed_at is also set, and its row spans the
    // whole expired lease — averaging that in would drag the estimate toward
    // the lease duration and 503 a healthy queue. Realm-scoped to match the
    // per-realm `pending` count, resolved captures only, bounded lookback.
    query(dbAdapter, [
      `SELECT AVG(ms) AS avg_ms FROM (
         SELECT EXTRACT(EPOCH FROM (j.finished_at - MAX(jr.created_at))) * 1000 AS ms
           FROM jobs j
           JOIN job_reservations jr ON jr.job_id = j.id AND jr.completed_at IS NOT NULL
          WHERE j.job_type = 'screenshot-card'
            AND j.status = 'resolved'
            AND j.finished_at > NOW() - INTERVAL '${CAPTURE_DURATION_LOOKBACK_HOURS} hours'
            AND j.concurrency_group =`,
      param(concurrencyGroup),
      `GROUP BY j.id, j.finished_at
       ) t`,
    ] as Expression) as Promise<{ avg_ms: number | string | null }[]>,
    twinOf
      ? (query(dbAdapter, [
          // A pending/in-flight job carrying the same persist target and
          // `runAs` (jsonb extraction, so the compares are text —
          // sourceGeneration binds as a string to match). Mirrors the
          // coalesce join's key exactly: both surfaces publish
          // persist-carrying jobs, and only a same-`runAs` job is one the
          // caller would join.
          `SELECT EXISTS (
             SELECT 1 FROM jobs
              WHERE status = 'unfulfilled'
                AND job_type = 'screenshot-card'
                AND concurrency_group =`,
          param(concurrencyGroup),
          `AND args->'persist'->>'sourceURL' =`,
          param(twinOf.sourceURL),
          `AND args->'persist'->>'captureSpecHash' =`,
          param(twinOf.captureSpecHash),
          `AND args->'persist'->>'sourceGeneration' =`,
          param(String(twinOf.sourceGeneration)),
          `AND args->>'runAs' =`,
          param(twinOf.runAs),
          `) AS has_twin`,
        ] as Expression) as Promise<{ has_twin: boolean }[]>)
      : Promise.resolve([{ has_twin: false }]),
  ]);
  let pending = Number(pendingRows[0]?.pending ?? 0);
  let avgRaw = durationRows[0]?.avg_ms;
  let avgCaptureMs =
    avgRaw == null ? DEFAULT_CAPTURE_ESTIMATE_MS : Number(avgRaw);
  return {
    pending,
    avgCaptureMs,
    estimatedWaitMs: pending * avgCaptureMs,
    hasTwin: Boolean(twinRows[0]?.has_twin),
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
