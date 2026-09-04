export const PRERENDER_SERVER_STATUS_HEADER = 'X-Boxel-Prerender-Server-Status';
export const PRERENDER_SERVER_STATUS_DRAINING = 'draining';
export const PRERENDER_SERVER_DRAINING_STATUS_CODE = 410;

// Opaque token for the current host shell: a truncated hash of the host app's
// index.html as the realm server fetches it from its host-app URL, before the
// per-request config rewrite `serve-index` applies when serving that HTML. The
// realm server reports the token to the manager at boot and again from the
// post-deployment hook (POST /host-shell); the manager echoes the latest value
// on every heartbeat response via this header.
//
// A prerender server recycles its browser for any token that isn't the one it
// last warmed against — the first token it sees included, since a server that
// booted mid-deploy warmed against the outgoing shell and holds no baseline to
// compare against. The token only has to change when the host bundle changes;
// prerender servers treat it opaquely.
export const PRERENDER_HOST_SHELL_HASH_HEADER =
  'X-Boxel-Prerender-Host-Shell-Hash';

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
//
// CS-11115 Phase 2: the canonical definition now lives in runtime-
// common's prerender-headers.ts (as `X_BOXEL_JOB_ID_HEADER`) so the
// host SPA can import it without taking a realm-server dependency.
// Re-exported here under the legacy name so existing realm-server
// imports keep working unchanged.
export { X_BOXEL_JOB_ID_HEADER as PRERENDER_JOB_ID_HEADER } from '@cardstack/runtime-common';

// Worker-job priority of the request that triggered this prerender.
// Producer side stamps this header so any sub-`prerenderModule` the
// host fires during render inherits the originating priority instead
// of silently dropping to 0 — see prerender-headers.ts for the full
// chain rationale.
export {
  X_BOXEL_JOB_PRIORITY_HEADER as PRERENDER_JOB_PRIORITY_HEADER,
  sanitizeJobPriorityHeader,
} from '@cardstack/runtime-common';

// Stamped on the host's outbound _federated-search / _search calls
// when the host SPA detects it's running inside a prerender tab. The
// prerender server signals "you are in a prerender" by injecting
// `globalThis.__boxelRenderContext = true` via evaluateOnNewDocument
// before the host SPA boots. The host's realm-server fetch wrapper
// reads that flag and attaches this header to the request; the
// search handlers read it inbound and pass `cacheOnlyDefinitions:true`
// to searchCards, short-circuiting the recursive lookupDefinition
// fan-out in populateQueryFields that causes self-referential
// prerender deadlocks under parallel indexing.
//
// Defined in runtime-common's realm.ts as the single source of truth
// so the Realm class can read it without depending on realm-server.
// Re-exported here for the host fetch wrapper's import-locality.
export { DURING_PRERENDER_HEADER } from '@cardstack/runtime-common';

// Sanitize the inbound job-id header (`<digits>.<digits>` = job.id +
// reservation.id). Defined in runtime-common alongside
// `X_BOXEL_JOB_ID_HEADER` so the Realm class can normalize the identity
// without depending on realm-server; re-exported here for import-locality.
export { sanitizePrerenderJobId } from '@cardstack/runtime-common';

// Base timeout for a single prerender capture on the prerender server
// (DOM rendering + data loading inside the headless browser). A healthy
// render completes in well under 30s; 60s cleanly separates a genuine
// wedge from the slowest legitimate cards, and (with the request-timeout
// overhead below) fires the render-level timeout — and its hang
// diagnostics — before the request-level abort gives up on the render.
const DEFAULT_RENDER_TIMEOUT_MS = 60_000;
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

// Whether any prerender server received this request before the manager
// answered it. The manager stamps this on every response it produces itself.
// `none` is the manager's guarantee that no prerender server saw the request,
// which is what makes the failure safe to retry even for a request that must
// not run twice; `delivered` — and an absent header, which reads the same way —
// means a server may have received it and acted on it.
export const PRERENDER_DISPATCH_HEADER = 'x-boxel-prerender-dispatch';
export const PRERENDER_DISPATCH_NONE = 'none';
export const PRERENDER_DISPATCH_DELIVERED = 'delivered';

// How far a failed prerender request may be retried.
//
// A render is a pure read of a card: repeating it costs time and nothing else,
// so any failure is worth another attempt. Running a command is not — it
// creates cards, matrix rooms and outbound calls, and the queue deliberately
// declines to collapse two identical invocations (see `dedupeKey` in
// runtime-common's `tasks/run-command.ts`), so a retry of an invocation whose
// outcome is unknown executes it a second time while the caller still sees a
// single call. Such a request is retried only on a failure that proves it
// never reached a prerender server.
export type PrerenderRetryPolicy = 'any-failure' | 'only-when-undelivered';

// The policy for each prerender endpoint, read by both layers that retry —
// the client's per-request loop and the manager's failover across servers.
// They enforce different halves of the same guarantee, so a request type
// listed on one side and forgotten on the other would keep retrying through
// the other half in silence; naming it once is what makes that impossible.
// An endpoint absent here is a pure read.
const RETRY_POLICY_BY_PATH: Record<string, PrerenderRetryPolicy> = {
  'run-command': 'only-when-undelivered',
};

export function retryPolicyForPath(path: string): PrerenderRetryPolicy {
  return RETRY_POLICY_BY_PATH[path] ?? 'any-failure';
}

// Network error codes that mean no connection to the peer was ever
// established, so the request cannot have been received, let alone acted on.
// A reset or a timeout proves nothing: either can land after the peer read the
// request and started work on it.
//
// Membership turns on the phase an error can be raised in, not on how it
// reads. Routing failures (`EHOSTUNREACH`, `ENETUNREACH`) are deliberately
// absent even though they usually do come from a failed `connect`: undici
// forwards a socket error raw from an established connection too, so a route
// that dies while the request is in flight surfaces under the same code as one
// that died before the SYN. `UND_ERR_CONNECT_TIMEOUT` is included because it
// carries the distinction itself — undici raises it only from the timer it
// clears once the socket connects, so it cannot describe a request that was
// already written.
const UNDELIVERED_ERROR_CODES = new Set([
  'ECONNREFUSED', // the peer refused the connection
  'ENOTFOUND', // DNS resolved to nothing
  'EAI_AGAIN', // DNS resolution failed
  'UND_ERR_CONNECT_TIMEOUT', // the connection was never established
]);

// Node's fetch wraps network errors in a TypeError carrying the underlying
// error in `cause`, so the code sits at either level.
export function isUndeliveredRequestError(err: unknown): boolean {
  let code =
    (err as { code?: unknown; cause?: { code?: unknown } })?.code ??
    (err as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === 'string' && UNDELIVERED_ERROR_CODES.has(code);
}
