import {
  normalizeQueryForSignature,
  type Query,
  type SearchEntryScope,
} from '@cardstack/runtime-common';

// Stable digest key for store-side `_federated-search` in-flight dedup.
// Mirrors `runtime-common/realm-index-query-engine.ts:searchInFlightKey`
// but takes a realms array (the host fires federated searches against
// one or more realms; the realm-server engine is per-realm so its
// version takes a single URL).
//
// Returns undefined if the inputs can't be serialized deterministically —
// caller falls back to running uncoalesced so dedup is best-effort, never
// a correctness boundary.
//
// `realms` order is preserved (not sorted): the realm-server's
// `_federated-search` iterates the array and concatenates results in
// that order, so `[a, b]` and `[b, a]` are different requests.
export function searchInFlightKey(
  realms: string[],
  query: Query,
  // The *resolved* wire scope (see `StoreService.resolveWireScope`), not the
  // caller's raw scope, so two spellings of a byte-identical request share a
  // key. Two requests that differ by wire scope are different result sets, so
  // scope is part of the key.
  scope?: SearchEntryScope,
): string | undefined {
  try {
    return JSON.stringify([
      realms,
      normalizeQueryForSignature(query),
      scope ?? null,
    ]);
  } catch {
    return undefined;
  }
}
