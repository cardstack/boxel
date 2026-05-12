// CS-11043. Tracks what kind of reset (if any) the next prerender call
// from the indexer should request. Extracted from IndexRunner so it can
// be unit-tested without spinning up the rest of the runner. See
// clear-cache-tracker-test.ts for the spec.
//
// Three returnable reset modes per render:
//   - 'clear-cache'       — `renderOptions.clearCache: true`. Resets
//     the prerender Loader AND the store. Use on the very first
//     render of a batch (so the loader can't serve stale module bytes
//     from a previous batch).
//   - 'reset-loader-only' — `renderOptions.resetLoaderOnly: true`.
//     Resets only the Loader. Use on subsequent renders within a
//     batch when we want the loader fresh on each puppeteer page
//     (which can be different from the page that received
//     'clear-cache' under PRERENDER_AFFINITY_TAB_MAX > 1) but want to
//     preserve the store's cumulative hydration data for query-field
//     serialization.
//   - 'none'              — no reset requested.
//
// Tracker modes that decide which return values come out of `consume`:
//   - 'consume-once'      — default. First consume → 'clear-cache',
//     subsequent → 'none'. Matches the historical pre-CS-11043
//     IndexRunner behavior.
//   - 'sticky-for-batch'  — set when the batch contains an executable
//     invalidation (.gts/.ts/.js). First consume → 'clear-cache',
//     subsequent → 'reset-loader-only'. Solves the multi-page
//     fan-out problem (every page that handles a render gets at
//     least a Loader reset) without resetting the store on every
//     render (which would erase per-batch hydration data).
//   - 'off'               — every consume returns 'none'.
//
// `upgradeToStickyForBatch` is one-way: once the runner has decided the
// batch needs the sticky behavior, falling back to consume-once would
// silently leak stale module bytes into the next render.

export type ResetForRender = 'clear-cache' | 'reset-loader-only' | 'none';
export type ClearCacheTrackerMode = 'consume-once' | 'sticky-for-batch' | 'off';

export class ClearCacheTracker {
  #mode: ClearCacheTrackerMode;
  // Tracks whether any consume has fired yet — the first consume
  // always returns 'clear-cache' (unless in 'off' mode), regardless
  // of when the upgrade happened. The state machine matters when
  // upgradeToStickyForBatch is called AFTER the first consume.
  #consumed = false;

  constructor(opts?: { initialMode?: ClearCacheTrackerMode }) {
    this.#mode = opts?.initialMode ?? 'consume-once';
  }

  upgradeToStickyForBatch(): void {
    this.#mode = 'sticky-for-batch';
  }

  consume(): ResetForRender {
    if (this.#mode === 'off') {
      return 'none';
    }
    if (!this.#consumed) {
      this.#consumed = true;
      if (this.#mode === 'consume-once') {
        // Done — subsequent consumes return 'none'.
        this.#mode = 'off';
      }
      return 'clear-cache';
    }
    // We've consumed at least once. In sticky-for-batch the per-render
    // loader still needs resetting (because the manager may route this
    // render to a different puppeteer page than the one that received
    // the initial clear-cache). In consume-once we're done.
    return this.#mode === 'sticky-for-batch' ? 'reset-loader-only' : 'none';
  }
}
