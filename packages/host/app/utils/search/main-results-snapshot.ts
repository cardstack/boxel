import type { SearchResultsYield } from '@cardstack/runtime-common';

import type { MainResultsSnapshot } from '../../services/search-sheet-state';

// Decide what the main-search pane renders while persisting: the retained
// snapshot or the live results. Show the snapshot only when it belongs to the
// current search (`queryKey` match) AND the recreated live resource hasn't
// produced rows yet (empty + loading) — the reopen handoff. Flag it loading so
// the "refreshing" indicator shows; the live results take over as soon as they
// land. Every other case (no snapshot, a different search, live has rows, or the
// live search has settled) renders live. Pure so it can be unit-tested without a
// render.
export function resolveMainResults(
  live: SearchResultsYield,
  snapshot: MainResultsSnapshot | undefined,
  currentQueryKey: string | undefined,
): SearchResultsYield {
  if (
    snapshot &&
    snapshot.queryKey === currentQueryKey &&
    live.entries.length === 0 &&
    live.isLoading
  ) {
    return {
      entries: snapshot.entries,
      meta: snapshot.meta,
      isLoading: true,
      errors: undefined,
    };
  }
  return live;
}
