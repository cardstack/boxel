// Decides when renders timing out on unresponsive tabs mean the browser as a
// whole needs recycling, rather than just the tabs involved.
//
// A render timeout already retires its own tab: the affinity is evicted and
// the tab's target closed, which takes its renderer process with it. That is
// enough for a card that pegs its tab on every render — each render costs one
// tab, and the rest of the browser is unaffected — so a single affinity
// timing out repeatedly must never restart Chrome under every other realm's
// renders. Two signals point past the tab instead:
//
//   * The browser process stopped answering: attaching a CDP session to a tab
//     is answered by the browser, not the tab's renderer, so a timed-out
//     attach recycles at once.
//   * Tabs of several distinct affinities went unresponsive within a short
//     window. Each affinity renders in its own BrowserContext on its own
//     renderer process, so unrelated realms wedging together is a property of
//     the browser, not of any card.

export const DEFAULT_UNRESPONSIVE_AFFINITY_THRESHOLD = 3;
export const DEFAULT_UNRESPONSIVE_WINDOW_MS = 5 * 60_000;

export type UnresponsiveTabReport = {
  affinityKey: string;
  // The tab's CDP session attach timed out — the browser process itself
  // didn't answer.
  browserUnresponsive: boolean;
};

export class UnresponsiveTabTracker {
  #threshold: number;
  #windowMs: number;
  #now: () => number;
  // Latest unresponsive timeout per affinity, pruned to the window on read.
  #lastSeenByAffinity = new Map<string, number>();

  constructor(options?: {
    threshold?: number;
    windowMs?: number;
    now?: () => number;
  }) {
    this.#threshold =
      options?.threshold ?? DEFAULT_UNRESPONSIVE_AFFINITY_THRESHOLD;
    this.#windowMs = options?.windowMs ?? DEFAULT_UNRESPONSIVE_WINDOW_MS;
    this.#now = options?.now ?? Date.now;
  }

  // Records one render that timed out on an unresponsive tab. Returns the
  // reason to recycle the browser, or null when retiring the tab suffices.
  // Returning a reason also resets the tracker: the recycle replaces every
  // tab the window was counting.
  record(report: UnresponsiveTabReport): string | null {
    let now = this.#now();
    if (report.browserUnresponsive) {
      this.#lastSeenByAffinity.clear();
      return `CDP session attach timed out on a tab of ${report.affinityKey}`;
    }
    this.#lastSeenByAffinity.set(report.affinityKey, now);
    for (let [affinityKey, seenAt] of this.#lastSeenByAffinity) {
      if (now - seenAt > this.#windowMs) {
        this.#lastSeenByAffinity.delete(affinityKey);
      }
    }
    if (this.#lastSeenByAffinity.size >= this.#threshold) {
      let affinities = [...this.#lastSeenByAffinity.keys()];
      this.#lastSeenByAffinity.clear();
      return (
        `${affinities.length} affinities had unresponsive tabs within ` +
        `${this.#windowMs}ms: ${affinities.join(', ')}`
      );
    }
    return null;
  }

  // Forgets everything counted so far. The browser restart path calls this,
  // since tabs from before a restart say nothing about the new browser.
  reset(): void {
    this.#lastSeenByAffinity.clear();
  }
}
