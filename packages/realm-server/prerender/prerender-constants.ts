export const PRERENDER_SERVER_STATUS_HEADER = 'X-Boxel-Prerender-Server-Status';
export const PRERENDER_SERVER_STATUS_DRAINING = 'draining';
export const PRERENDER_SERVER_DRAINING_STATUS_CODE = 410;

// CS-10872: correlates one client-initiated prerender call across
// remote-prerenderer → manager → prerender-server. The client assigns
// the ID on the first request; the manager and prerender-server echo
// it on both logs and response headers so operators can grep a single
// ID across all three processes when diagnosing an abort/timeout.
export const PRERENDER_REQUEST_ID_HEADER = 'x-boxel-prerender-request-id';

// CS-10872: sanitize an inbound `x-boxel-prerender-request-id`. The
// value gets echoed into log lines and response headers, so we want
// it tight enough that an attacker (or a buggy internal caller)
// can't inject CR/LF (Node fetch/http rejects these already, but be
// defensive), whitespace, or pathologically long strings that bloat
// every log line. A UUID v4 is the expected shape, and we accept
// anything in the UUID alphabet up to 64 chars; anything else
// returns null and callers mint a fresh UUID.
const REQUEST_ID_PATTERN = /^[0-9a-fA-F-]{1,64}$/;
export function sanitizePrerenderRequestId(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

// Threads the indexing job's `<jobId>.<reservationId>` identifier from
// the worker through the prerender call chain (worker → manager →
// prerender-server). Any service that handles the request stamps
// `[job: J.R]` onto its `<--`/`-->` HTTP-log lines and the manager's
// `proxying`/`proxied` lines so a single job's prerender activity is
// greppable across services with the same `[job: J.R]` substring used
// in worker logs.
export const PRERENDER_JOB_ID_HEADER = 'x-boxel-job-id';

// Stamped onto every outbound HTTP request fired by the host SPA from
// inside a prerender browser tab. The prerender server uses
// puppeteer's setExtraHTTPHeaders to attach this to every page on
// creation — the host doesn't know it's in a prerender, but the
// inbound side at the realm server sees the marker. Search handlers
// read it and pass `cacheOnlyDefinitions: true` to searchCards so the
// recursive `lookupDefinition → prerenderModule` path in
// populateQueryFields is short-circuited; without this, parallel
// indexing renders fan out into self-referential prerender deadlocks
// (the file render holds the tab the recursive module sub-render
// needs).
//
// Defined in runtime-common's realm.ts as the single source of truth
// so the Realm class can read it without depending on realm-server.
// Re-exported here so the prerender server's puppeteer wiring keeps
// a stable local import path.
export { DURING_PRERENDER_HEADER } from '@cardstack/runtime-common';
export const DURING_PRERENDER_HEADER_VALUE = '1';

// Sanitize the inbound job-id header. Format is `<digits>.<digits>`
// (job.id + reservation.id, both bigint-shaped); accept up to 32
// digits per side (so up to 65 chars total including the separator)
// to be defensive without admitting newlines or other log-injection.
const JOB_ID_PATTERN = /^[0-9]{1,32}\.[0-9]{1,32}$/;
export function sanitizePrerenderJobId(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  return JOB_ID_PATTERN.test(trimmed) ? trimmed : null;
}

// Base timeout for a single prerender capture on the prerender server
// (DOM rendering + data loading inside the headless browser).
const DEFAULT_RENDER_TIMEOUT_MS = 90_000;
// Additional budget for request-level timeouts that wrap render work across
// process/network boundaries (manager proxying, serialization, retries, etc).
// Request timeout defaults are computed as:
//   render timeout + overhead
// so request-level aborts happen after render-level timeouts, not before.
const DEFAULT_RENDER_TIMEOUT_OVERHEAD_MS = 60_000;
// Global lower bound used when parsing timeout env vars so invalid/too-small
// values (0, negative, NaN) do not cause immediate aborts or tight retry loops.
const MIN_TIMEOUT_MS = 1_000;

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  let parsed = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return Math.max(MIN_TIMEOUT_MS, fallback);
  }
  return Math.max(MIN_TIMEOUT_MS, parsed);
}

// Primary knob for prerender timeout behavior across layers.
export const prerenderRenderTimeoutMs = parseTimeoutMs(
  process.env.RENDER_TIMEOUT_MS,
  DEFAULT_RENDER_TIMEOUT_MS,
);

const defaultPrerenderRequestTimeoutMs =
  prerenderRenderTimeoutMs + DEFAULT_RENDER_TIMEOUT_OVERHEAD_MS;

export const prerenderRequestTimeoutMs = parseTimeoutMs(
  process.env.PRERENDER_REQUEST_TIMEOUT_MS,
  defaultPrerenderRequestTimeoutMs,
);

export function resolvePrerenderManagerRequestTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.PRERENDER_MANAGER_REQUEST_TIMEOUT_MS,
    prerenderRequestTimeoutMs,
  );
}

export function resolvePrerenderServerProxyTimeoutMs(): number {
  return parseTimeoutMs(
    process.env.PRERENDER_SERVER_TIMEOUT_MS,
    prerenderRequestTimeoutMs,
  );
}
