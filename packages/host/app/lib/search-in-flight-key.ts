import {
  normalizeQueryForSignature,
  type Query,
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
): string | undefined {
  try {
    return JSON.stringify([realms, normalizeQueryForSignature(query)]);
  } catch {
    return undefined;
  }
}
