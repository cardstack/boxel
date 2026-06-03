// `<jobId>.<reservationId>` of the indexing job that triggered a
// prerender visit. Originates at the worker (`pg-queue`), tagged
// onto outbound prerender requests by `remote-prerenderer`, echoed
// through prerender-manager → prerender-server, and (new in CS-11115
// Phase 2) injected into the rendered host as `window.__boxelJobId`
// so the host's `_federated-search` fetch wrapper can re-stamp it on
// outbound calls. Lives in runtime-common alongside the consuming-
// realm header so the host SPA can import it without taking a
// dependency on the realm-server package. realm-server's
// `prerender-constants.ts` re-exports this as `PRERENDER_JOB_ID_HEADER`
// for backwards-compatibility with existing imports.
export const X_BOXEL_JOB_ID_HEADER = 'x-boxel-job-id';

// Sanitize the inbound job-id header. Format is `<digits>.<digits>`
// (job.id + reservation.id, both bigint-shaped); accept up to 32 digits
// per side (so up to 65 chars total including the separator) to be
// defensive without admitting newlines or other log-injection. Lives
// here alongside the header so both the realm-server search handlers and
// the Realm class (card-GET assembly) normalize the identity the same way
// before using it as a job-scoped cache key. realm-server's
// `prerender-constants.ts` re-exports this as `sanitizePrerenderJobId`.
const JOB_ID_PATTERN = /^[0-9]{1,32}\.[0-9]{1,32}$/;
export function sanitizePrerenderJobId(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  return JOB_ID_PATTERN.test(trimmed) ? trimmed : null;
}

// HTTP header sent by the host's `_federated-search` fetch wrapper while
// rendering inside a prerender tab. Carries the URL of the realm whose
// card is currently being rendered (the "consuming" realm). The realm-
// server's search-cache layer pairs this with `x-boxel-job-id` as the
// indexer-traffic gate: both headers are only stamped by indexer-driven
// prerender requests, so user-facing API callers always bypass the
// cache and see live state. Within a single jobId, cache entries are
// keyed by `(jobId, normalizedRealms, normalizedQuery, normalizedOpts)`
// and cover both same-realm and cross-realm reads. Cross-realm reads
// accept "first observation pinned for the batch's lifetime" as their
// staleness contract; same-realm reads are tighter — the consuming
// realm's own swap fires `clearInFlightSearch` and the cache is torn
// down on `Realm.update`'s onInvalidation path.
//
// Lives in runtime-common (not realm-server/prerender) so both the host
// SPA and the realm-server can import it without cross-package coupling.
export const X_BOXEL_CONSUMING_REALM_HEADER = 'x-boxel-consuming-realm';

// Sanitize the inbound consuming-realm header value. Echoed into log
// lines + used as a cache-key prefix, so reject anything that isn't a
// plausible `http(s)://…` URL string, has whitespace, or is too long.
// 2048 is a defensive ceiling, comfortably above real realm URLs.
const REALM_URL_PATTERN = /^https?:\/\/[!-~]{1,2048}$/;
export function sanitizeConsumingRealmHeader(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  return REALM_URL_PATTERN.test(trimmed) ? trimmed : null;
}

// HTTP header carrying the worker-job priority of the request that
// triggered the prerender. Threaded from `pg-queue` job priority →
// `remote-prerenderer` → prerender-server → render-runner → page
// (`globalThis.__boxelJobPriority`) → host's `_federated-search` fetch
// wrapper → realm-server's `handle-search`. The realm-server forwards
// it into `LookupContext.priority` so any sub-`prerenderModule` fired
// by `CachingDefinitionLookup` for a missed definition inherits the
// originating job's priority instead of silently dropping to 0.
//
// Same scale as worker-job priority — 0 = system-initiated, 10 =
// userInitiatedPriority — small non-negative integers.
export const X_BOXEL_JOB_PRIORITY_HEADER = 'x-boxel-job-priority';

// Sanitize the inbound job-priority header value. The producer side
// stringifies a small non-negative integer; the consumer side must
// reject anything that isn't a base-10 integer in a reasonable range
// before passing it on as a number. Rejecting an out-of-range value
// returns `null` rather than clamping so an upstream regression
// (e.g. someone sending a bogus value) surfaces as "no priority" —
// safer than silently substituting a plausible-looking integer.
const JOB_PRIORITY_MAX = 1_000_000;
export function sanitizeJobPriorityHeader(
  raw: string | null | undefined,
): number | null {
  if (typeof raw !== 'string') return null;
  let trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  let n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0 || n > JOB_PRIORITY_MAX) return null;
  return n;
}
