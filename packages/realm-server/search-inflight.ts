// Count of `_federated-search` requests the realm-server is currently
// handling. Incremented at the search handler's entry and decremented when
// it settles. Read by the health sampler so a spike in concurrent searches
// can be correlated with event-loop lag — the signature of the realm-server
// process being saturated while prerenders wait on in-render `_search`
// round-trips. A plain module-level counter (the realm-server is a single
// process) kept separate from the sampler so the search handler doesn't pull
// in `perf_hooks`.
let inFlight = 0;

export function incrementSearchInFlight(): void {
  inFlight++;
}

export function decrementSearchInFlight(): void {
  inFlight = inFlight > 0 ? inFlight - 1 : 0;
}

export function getSearchInFlight(): number {
  return inFlight;
}
