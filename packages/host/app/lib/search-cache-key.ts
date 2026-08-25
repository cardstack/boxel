import {
  normalizeQueryForSignature,
  type Query,
  type SearchEntryScope,
} from '@cardstack/runtime-common';

// Stable digest key for the store-side resolved-doc search cache.
// Pairs with `searchInFlightKey` (CS-11121) but adds the `jobId` and
// `consumingRealm` dimensions so cache entries are scoped to a single
// indexing batch's view of a single realm.
//
// The cache itself only consults this key when the caller has already
// passed the same-realm gate (realms array equals `[consumingRealm]`),
// so the realms list is not part of the key — by construction it
// equals the consumingRealm.
//
// Returns undefined if the inputs can't be serialized deterministically —
// caller falls back to uncached fetch so the cache is best-effort, never
// a correctness boundary. Same trade-off as the server-side cache key.
export function searchCacheKey(
  jobId: string,
  consumingRealm: string,
  query: Query,
  // The *resolved* wire scope (see `StoreService.resolveWireScope`), not the
  // caller's raw scope, so two spellings of a byte-identical request share a
  // key. Two requests that differ by wire scope are different result sets, so
  // scope is part of the key.
  scope?: SearchEntryScope,
): string | undefined {
  try {
    return JSON.stringify([
      jobId,
      consumingRealm,
      normalizeQueryForSignature(query),
      scope ?? null,
    ]);
  } catch {
    return undefined;
  }
}
