import {
  DURING_PRERENDER_HEADER,
  X_BOXEL_CONSUMING_REALM_HEADER,
  X_BOXEL_JOB_ID_HEADER,
  X_BOXEL_REQUEST_ID_HEADER,
} from '@cardstack/runtime-common';

// Set by the prerender server's `evaluateOnNewDocument` before the
// SPA boots, and also by the host's prerender-shaped routes
// (render.ts / module.ts / file-extract.ts / command-runner.ts) when
// they activate — `__boxelRenderContext = true`. Read here so the
// realm-server fetch wrappers can attach the marker header on
// search calls only, narrowly scoping the signal to the endpoints
// that need it. See realm.ts:DURING_PRERENDER_HEADER for the full
// chain.
export function duringPrerenderHeaders(): Record<string, string> {
  let flag = (globalThis as unknown as { __boxelRenderContext?: boolean })
    .__boxelRenderContext;
  return flag === true ? { [DURING_PRERENDER_HEADER]: '1' } : {};
}

// While rendering inside a prerender tab the render route writes
// `__boxelConsumingRealm` with the URL of the realm whose card is
// being rendered. Attach it to outbound search requests so the
// realm-server's job-scoped cache layer can gate caching on the
// indexer-traffic shape. Read each fetch (not cached at module
// scope) so a tab that renders cards from multiple realms in
// sequence sends the correct header per request. Returns an empty
// object when the global is not set so non-prerender (live SPA)
// fetches behave exactly as before.
export function consumingRealmHeader(): Record<string, string> {
  let r = (globalThis as unknown as { __boxelConsumingRealm?: string })
    .__boxelConsumingRealm;
  return r ? { [X_BOXEL_CONSUMING_REALM_HEADER]: r } : {};
}

// Companion to `consumingRealmHeader()`. The prerender server's
// `prerenderVisitAttempt` injects `__boxelJobId` onto the page
// before transitioning into the render route — see
// `packages/realm-server/prerender/render-runner.ts`. Read it on
// each fetch (not module-scope-cached) so a page reused across
// multiple visits picks up the current visit's job id. Outside a
// prerender tab the global is undefined and we send no header, so
// user / API callers continue to bypass the realm-server's
// job-scoped cache.
export function jobIdHeader(): Record<string, string> {
  let j = (globalThis as unknown as { __boxelJobId?: string }).__boxelJobId;
  return j ? { [X_BOXEL_JOB_ID_HEADER]: j } : {};
}

// Per-search correlation id. Minted fresh for each `_federated-search`
// fetch the SPA issues while rendering inside a prerender tab, and stamped
// as `x-boxel-request-id`. The realm-server reads it back out and keys its
// `realm:search-timing` line on it, so a search the prerender observes as
// slow (surfaced in its `queryLoadsInFlight` diagnostics) can be joined to
// the realm-server's stage-by-stage view of the same request. Gated on the
// prerender context — exactly like the job-id / consuming-realm headers —
// so live SPA traffic is unaffected and emits no server-side timing line.
export function requestIdHeader(): Record<string, string> {
  let flag = (globalThis as unknown as { __boxelRenderContext?: boolean })
    .__boxelRenderContext;
  if (flag !== true) {
    return {};
  }
  return { [X_BOXEL_REQUEST_ID_HEADER]: newCorrelationId() };
}

function newCorrelationId(): string {
  let c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // Fallback for the rare environment without `crypto.randomUUID` — the id
  // only needs to disambiguate concurrent searches in a log line, not be
  // cryptographically strong.
  return `r-${Date.now().toString(36)}-${Math.floor(
    Math.random() * 1e9,
  ).toString(36)}`;
}
