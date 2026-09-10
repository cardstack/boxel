// Count of search requests the realm-server is currently handling — both
// `_search` and `_federated-search`, since `SEARCH_PATH_PATTERN` in
// `middleware/index.ts` (the only gate on the increment) matches both. That
// includes the in-render `_search` round-trips prerender issues, which is the
// load this counter was added to make visible. Incremented at the search
// handler's entry and decremented when it settles. Read by the health sampler
// so a spike in concurrent searches can be correlated with event-loop lag —
// the signature of the realm-server process being saturated while prerenders
// wait on those round-trips. A plain module-level counter (the realm-server is
// a single process) kept separate from the sampler so the search handler
// doesn't pull in `perf_hooks`.
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
