// Per-capture stage telemetry for the screenshot pipeline.
//
// One JSON-object log line per event on the `boxel:screenshot-perf` channel —
// the same emit convention as `boxel:client-perf`: the whole line is one JSON
// object with an explicit `channel` field so Loki's `| json` parse reads it,
// and every duration is a flat top-level `*Ms` field so LogQL can `unwrap`
// any stage directly (nested objects would flatten into per-key labels).
//
// Two event types cover the pipeline's processes:
//
//   - `request` — emitted by a serving surface (the GET `_screenshot/` DSL
//     route in `realm.ts`, or `POST /_screenshot-card`) when a
//     capture-relevant request completes: what the caller experienced
//     (ledger hit / rendered / 503 / 403) and where its wall-clock went.
//     Plain uncaptured-miss 404s and request-shape 400s do not emit — they
//     are addressing noise, not capture work.
//
//   - `capture` — emitted by the worker's `screenshot-card` task when a job
//     finishes: queue wait, the prerender stage breakdown, and the persist
//     leg. The same record is persisted onto the capture's
//     `media_cache_ledger.diagnostics` row, so a completed capture's
//     breakdown is readable by SQL as well as by Loki.
//
// Correlation: the two event types join on `jobId` — `reservationId` is
// capture-side detail (only the worker knows the reservation, so `request`
// events carry null; it reaches the prerender server as
// `jobId.reservationId`);
// `correlationId` (the surface request's `x-boxel-logging-correlation-id`)
// joins both back to the realm-server's `realm:requests` lines; and
// `prerenderRequestId` joins the capture to the prerender server's and
// manager's own request logs — three processes, one story.

import { logger } from './log.ts';
import type { MediaCacheLane } from './media-cache.ts';

export type ScreenshotRequestSurface = 'get-dsl' | 'post';

export type ScreenshotRequestOutcome =
  // Ledger hit: served with zero Chrome work.
  | 'hit'
  // The capture job completed within the sync wait and the result served.
  | 'rendered'
  // Fail-fast 503 from the queue-depth pre-check; no job was enqueued.
  | 'congested'
  // The sync wait expired (503 + Retry-After); the job keeps running and
  // persists its capture, so the caller's retry is a ledger hit.
  | 'timeout'
  // 403: the realm's `allowArbitraryScreenshots` gate is closed.
  | 'gated'
  // No capture could be served within the wait: the job resolved without a
  // usable capture, or the job (or the serve work after it) threw.
  | 'error';

export type ScreenshotPersistOutcome =
  // A new object was written to the store.
  | 'uploaded'
  // The store already held an object under the content key (dedupe-on-write
  // hit): the ledger row was written but no bytes moved.
  | 'deduped'
  // Nothing to persist: the job carried no persist target, the worker has no
  // store configured, or the capture failed.
  | 'skipped'
  // The persist threw; the capture still returned to its caller.
  | 'failed';

// Fields shared by both event types: the capture identity (the ledger key,
// nullable where a surface or job has no resolvable persist target) and the
// cross-process correlation ids.
interface ScreenshotPerfBase {
  // Which serving surface the work belongs to: for `request` events the
  // surface that answered; for `capture` events the surface that enqueued
  // the job.
  surface: ScreenshotRequestSurface;
  realmURL: string;
  sourceURL: string;
  captureSpecHash: string | null;
  sourceGeneration: number | null;
  lane: MediaCacheLane | null;
  correlationId: string | null;
  jobId: number | null;
  reservationId: number | null;
  // Wall-clock of the whole event: request receipt → response for `request`
  // events, job claim → job return for `capture` events. The stage fields
  // measured inside that window sum to at most this, with the remainder
  // unattributed overhead. A `capture` event's `queueWaitMs` is the one
  // exception: it clocks enqueue → claim, which is before the job-claim start
  // of `totalMs`, so it sits outside this sum rather than within it.
  totalMs: number;
}

export interface ScreenshotRequestPerfEvent extends ScreenshotPerfBase {
  eventType: 'request';
  outcome: ScreenshotRequestOutcome;
  // Whether the congestion pre-check found a queued/in-flight twin this
  // request would coalesce onto (null when the pre-check didn't run).
  hasTwin: boolean | null;
  // The narrow index read resolving the instance's live generation.
  generationLookupMs?: number;
  // The `media_cache_ledger` lookup for the canonical capture identity.
  ledgerLookupMs?: number;
  // GET only: reading the realm's `allowArbitraryScreenshots` config.
  gateMs?: number;
  // The fail-fast congestion pre-check query.
  precheckMs?: number;
  // Publishing the job (including coalesce evaluation).
  enqueueMs?: number;
  // Enqueue → job completion or sync-wait expiry.
  jobWaitMs?: number;
  // Streaming the capture (or, on POST, draining it to base64).
  serveMs?: number;
}

export interface ScreenshotCapturePerfEvent extends ScreenshotPerfBase {
  eventType: 'capture';
  status: 'ready' | 'error' | 'unusable';
  runAs: string;
  format: string;
  // The prerender HTTP request id (`x-boxel-prerender-request-id`), joining
  // this capture to the prerender server's and manager's logs. Null for an
  // in-process prerenderer.
  prerenderRequestId: string | null;
  // Enqueue → reservation claim, from the queue's own clock via `JobInfo`.
  queueWaitMs?: number;
  // Realm/user permission fetches before the render.
  permissionsMs?: number;
  // Task-observed wall of the whole prerender call (includes transport for
  // the remote prerenderer).
  prerenderMs?: number;
  // Page acquire inside the pool, and its components.
  launchMs?: number;
  semaphoreMs?: number;
  admissionMs?: number;
  tabQueueMs?: number;
  tabStartupMs?: number;
  tabProbeMs?: number;
  // True when the pool handed back a warm tab already bound to this realm's
  // affinity; false is the cold-start tax.
  tabReused?: boolean;
  // Server-observed render wall (navigation → capture bytes), and its
  // components as measured inside the render.
  renderMs?: number;
  navMs?: number;
  settleMs?: number;
  imagePaintMs?: number;
  screenshotMs?: number;
  // base64 → bytes decode ahead of the persist.
  decodeMs?: number;
  // The `putMedia` call (content hash + object write + ledger upsert).
  persistMs?: number;
  persistOutcome: ScreenshotPersistOutcome;
}

export type ScreenshotPerfEvent =
  | ScreenshotRequestPerfEvent
  | ScreenshotCapturePerfEvent;

export const SCREENSHOT_PERF_CHANNEL = 'boxel:screenshot-perf';

// Test seam, mirroring `emitSearchTiming`'s sink: when set, events go to the
// sink instead of the logger so tests can assert on records without scraping
// stdout.
let screenshotPerfSink: ((event: ScreenshotPerfEvent) => void) | undefined;

export function setScreenshotPerfSink(
  sink: ((event: ScreenshotPerfEvent) => void) | undefined,
): void {
  screenshotPerfSink = sink;
}

// Created lazily: a module-scope `logger()` here can race the circular
// import that installs the log-definitions factory (same hazard
// `emitSearchTiming` documents).
let screenshotPerfLog: ReturnType<typeof logger> | undefined;

export function emitScreenshotPerf(event: ScreenshotPerfEvent): void {
  if (screenshotPerfSink) {
    screenshotPerfSink(event);
    return;
  }
  (screenshotPerfLog ??= logger(SCREENSHOT_PERF_CHANNEL)).info(
    JSON.stringify({ channel: SCREENSHOT_PERF_CHANNEL, ...event }),
  );
}
