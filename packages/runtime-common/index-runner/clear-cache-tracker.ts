// CS-11043. Tracks whether the next prerender call from the indexer
// should carry `renderOptions.clearCache: true`. Extracted from
// IndexRunner so it can be unit-tested without spinning up the rest of
// the runner. See clear-cache-tracker-test.ts for the spec.
//
// Two modes:
//   - 'consume-once': the next consume returns true, then it falls to
//     'off'. Matches the historical IndexRunner behavior of priming a
//     single warm-tab loader at the start of a fresh run.
//   - 'sticky-for-batch': every consume returns true. Used when the
//     batch contains an executable invalidation (.gts/.ts/.js) — under
//     PRERENDER_AFFINITY_TAB_MAX > 1 the batch's renders fan out across
//     multiple puppeteer pages, so each page needs its own loader reset.
//   - 'off': consume always returns false.
//
// `upgradeToStickyForBatch` is one-way: once the runner has decided the
// batch needs the sticky behavior, falling back to consume-once would
// silently leak stale module bytes into the next render.

export type ClearCacheTrackerMode = 'consume-once' | 'sticky-for-batch' | 'off';

export class ClearCacheTracker {
  #mode: ClearCacheTrackerMode;

  constructor(opts?: { initialMode?: ClearCacheTrackerMode }) {
    this.#mode = opts?.initialMode ?? 'consume-once';
  }

  upgradeToStickyForBatch(): void {
    this.#mode = 'sticky-for-batch';
  }

  consume(): boolean {
    switch (this.#mode) {
      case 'off':
        return false;
      case 'consume-once':
        this.#mode = 'off';
        return true;
      case 'sticky-for-batch':
        return true;
    }
  }
}
