import { buildWaiter } from '@ember/test-waiters';

import { isTesting } from '@embroider/macros';

const waiter = buildWaiter('live-search-refresh-scheduler:flush-waiter');

// How long a live search waits after a realm event before re-running, so a
// burst of events — one write's index event plus its prerender_html
// follow-ups, or many concurrent writers — triggers one re-run instead of one
// per event. Sized against the write cadence it exists to absorb: a steady
// stream of saves (autosave, a busy shared realm) emits events more often
// than once a second, and every re-run is a server-side search per open
// client. Trailing-edge, so the run that fires reflects everything the
// window accumulated.
export const LIVE_SEARCH_REFRESH_WINDOW_MS = isTesting() ? 10 : 2000;

// Random extra delay added per scheduled flush, so the many clients that all
// receive the same realm event don't re-query in lockstep — without it a
// popular realm turns every write into a synchronized thundering herd
// against the search endpoints.
export const LIVE_SEARCH_REFRESH_MAX_JITTER_MS = isTesting() ? 0 : 1000;

// Coalesces schedule() calls into one deferred flush: the first call of a
// burst arms the timer, later calls ride the armed flush, and the timer is
// never extended — a continuous event stream still flushes once per window
// rather than starving. The caller accumulates *what* to refresh (realm
// sets, invalidation maps) in its own state; this class only owns *when* the
// refresh runs. A test waiter spans arm-to-flush so `settled()` waits out
// the window.
export class LiveSearchRefreshScheduler {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #token: unknown;
  #flush: () => void;

  constructor(flush: () => void) {
    this.#flush = flush;
  }

  get isScheduled(): boolean {
    return this.#timer !== undefined;
  }

  schedule(): void {
    if (this.#timer !== undefined) {
      return;
    }
    this.#token = waiter.beginAsync();
    let delay =
      LIVE_SEARCH_REFRESH_WINDOW_MS +
      Math.random() * LIVE_SEARCH_REFRESH_MAX_JITTER_MS;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      let token = this.#token;
      this.#token = undefined;
      try {
        this.#flush();
      } finally {
        waiter.endAsync(token as Parameters<typeof waiter.endAsync>[0]);
      }
    }, delay);
  }

  // Drops the armed flush without running it. For teardown and for a query
  // change, where the events the window accumulated describe a result set
  // that no longer exists.
  cancel(): void {
    if (this.#timer === undefined) {
      return;
    }
    clearTimeout(this.#timer);
    this.#timer = undefined;
    waiter.endAsync(this.#token as Parameters<typeof waiter.endAsync>[0]);
    this.#token = undefined;
  }
}
