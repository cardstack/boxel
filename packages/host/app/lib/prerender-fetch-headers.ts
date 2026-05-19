import {
  DURING_PRERENDER_HEADER,
  X_BOXEL_CONSUMING_REALM_HEADER,
  X_BOXEL_JOB_ID_HEADER,
} from '@cardstack/runtime-common';

// Set by the prerender server's `evaluateOnNewDocument` before the
// SPA boots — `__boxelDuringPrerender = true`. Read here so the
// realm-server fetch wrappers can attach the marker header on
// search calls only, narrowly scoping the signal to the endpoints
// that need it. See realm.ts:DURING_PRERENDER_HEADER for the full
// chain.
export function duringPrerenderHeaders(): Record<string, string> {
  let flag = (globalThis as unknown as { __boxelDuringPrerender?: boolean })
    .__boxelDuringPrerender;
  return flag ? { [DURING_PRERENDER_HEADER]: '1' } : {};
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
