// Leading-edge debounce for live searches.
//
// A continuous control (a slider, a spinner, scrubbing a range) changes a live
// search's query many times a second. Fetching on every change floods the realm
// server with searches that are superseded before they return. A debounce that
// always waits would instead make every search feel sluggish, including the one
// a single click or keystroke starts. So the rule is per search resource (one
// consumer's query stream):
//
// - Leading edge. A query change that arrives while the stream is idle — the
//   first query, or one more than `settleMs` after the previous change —
//   fetches at once.
// - Trailing edge. A change within `settleMs` of the previous change is part of
//   a burst: it waits until the input settles (no further change for
//   `settleMs`) and then fetches the latest query. Each newer change restarts
//   the waiting run, cancelling it before it fetches.
// - Throttle ceiling. A drag that never pauses would otherwise show stale
//   results for as long as it lasts, so a burst still fetches once
//   `maxWaitMs` has passed since the last fetch started. 400 ms keeps a long
//   drag visibly live (about 2.5 refreshes a second) while still collapsing
//   the 20–60 change events a second a slider emits into one request.
//
// Only query changes go through this. Realm-event refreshes keep their own
// scheduler, and a render for the index or a prerender never waits: indexing
// throughput must not pay for interactive smoothing.

export interface SearchSettleTiming {
  settleMs: number;
  maxWaitMs: number;
}

const defaultTiming: SearchSettleTiming = { settleMs: 150, maxWaitMs: 400 };
let timing: SearchSettleTiming = { ...defaultTiming };

export function searchSettleTiming(): SearchSettleTiming {
  return timing;
}

// Tests shorten (or zero) the window; pass nothing to restore the defaults.
export function setSearchSettleTimingForTests(
  override?: Partial<SearchSettleTiming>,
): void {
  timing = { ...defaultTiming, ...override };
}

// True while the host renders for the index or a prerender. Strict `=== true`
// to match the prerender header and render-store selection.
export function isIndexRender(): boolean {
  return (globalThis as any).__boxelRenderContext === true;
}

export class SearchSettle {
  #lastChangeAt: number | undefined;
  #lastFetchAt: number | undefined;
  #now: () => number;
  #timing: () => SearchSettleTiming;
  #isIndexRender: () => boolean;

  constructor(
    options: {
      now?: () => number;
      timing?: () => SearchSettleTiming;
      isIndexRender?: () => boolean;
    } = {},
  ) {
    this.#now = options.now ?? (() => performance.now());
    this.#timing = options.timing ?? searchSettleTiming;
    this.#isIndexRender = options.isIndexRender ?? isIndexRender;
  }

  // Records a query change and returns how long its run should wait before
  // fetching: 0 on the leading edge, otherwise the settle window capped by the
  // throttle ceiling. A non-live search (`live: false`) and any search made
  // while rendering for the index or a prerender always return 0.
  delayForChange({ live = true }: { live?: boolean } = {}): number {
    if (!live || this.#isIndexRender()) {
      return 0;
    }
    let now = this.#now();
    let previous = this.#lastChangeAt;
    this.#lastChangeAt = now;
    let { settleMs, maxWaitMs } = this.#timing();
    if (previous === undefined || now - previous >= settleMs) {
      return 0;
    }
    let sinceFetch =
      this.#lastFetchAt === undefined ? Infinity : now - this.#lastFetchAt;
    return Math.max(0, Math.min(settleMs, maxWaitMs - sinceFetch));
  }

  // Called when a run actually starts its fetch, after any wait.
  fetchStarted(): void {
    this.#lastFetchAt = this.#now();
  }
}
