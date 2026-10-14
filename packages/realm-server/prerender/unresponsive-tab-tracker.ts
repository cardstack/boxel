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
//   * CDP session attaches timing out. The attach is the browser's to answer,
//     but whether Chrome ever holds it for an unresponsive renderer isn't
//     pinned down, so one timed-out attach is not enough on its own: it takes
//     a second within the window.
//   * Tabs of several distinct affinities going unresponsive within the
//     window. Each affinity renders in its own BrowserContext on its own
//     renderer process, so unrelated realms wedging together points at the
//     browser rather than at any one card.
//
// Neither signal is proof. A definition shared across realms (a catalog or
// base card) that loops on some data shape wedges a renderer in every realm
// that renders it, and a host starved for CPU fails the responsiveness probe
// on tabs that are only slow. A recycle can't help either case, and each one
// drops every warm context, so recycles are spaced at least
// `minRecycleIntervalMs` apart and counted for the logs.

export const DEFAULT_UNRESPONSIVE_AFFINITY_THRESHOLD = 3;
export const DEFAULT_ATTACH_TIMEOUT_THRESHOLD = 2;
export const DEFAULT_UNRESPONSIVE_WINDOW_MS = 5 * 60_000;
export const DEFAULT_MIN_RECYCLE_INTERVAL_MS = 15 * 60_000;

export type UnresponsiveTabReport = {
  affinityKey: string;
  // Attaching a CDP session to the tab timed out.
  browserUnresponsive: boolean;
};

export class UnresponsiveTabTracker {
  #affinityThreshold: number;
  #attachThreshold: number;
  #windowMs: number;
  #minRecycleIntervalMs: number;
  #now: () => number;
  // Latest unresponsive timeout per affinity.
  #lastSeenByAffinity = new Map<string, number>();
  // When each timed-out attach was reported.
  #attachTimeouts: number[] = [];
  #lastRecycleAt: number | undefined;
  #recycleCount = 0;

  constructor(options?: {
    affinityThreshold?: number;
    attachThreshold?: number;
    windowMs?: number;
    minRecycleIntervalMs?: number;
    now?: () => number;
  }) {
    this.#affinityThreshold =
      options?.affinityThreshold ?? DEFAULT_UNRESPONSIVE_AFFINITY_THRESHOLD;
    this.#attachThreshold =
      options?.attachThreshold ?? DEFAULT_ATTACH_TIMEOUT_THRESHOLD;
    this.#windowMs = options?.windowMs ?? DEFAULT_UNRESPONSIVE_WINDOW_MS;
    this.#minRecycleIntervalMs =
      options?.minRecycleIntervalMs ?? DEFAULT_MIN_RECYCLE_INTERVAL_MS;
    this.#now = options?.now ?? Date.now;
  }

  // How many recycles this tracker has called for.
  get recycleCount(): number {
    return this.#recycleCount;
  }

  // Records one render that timed out on an unresponsive tab. Returns the
  // reason to recycle the browser, or null when retiring the tab suffices.
  record(report: UnresponsiveTabReport): string | null {
    let now = this.#now();
    this.#lastSeenByAffinity.set(report.affinityKey, now);
    if (report.browserUnresponsive) {
      this.#attachTimeouts.push(now);
    }
    for (let [affinityKey, seenAt] of this.#lastSeenByAffinity) {
      if (now - seenAt > this.#windowMs) {
        this.#lastSeenByAffinity.delete(affinityKey);
      }
    }
    this.#attachTimeouts = this.#attachTimeouts.filter(
      (seenAt) => now - seenAt <= this.#windowMs,
    );

    let reason: string | null = null;
    if (this.#attachTimeouts.length >= this.#attachThreshold) {
      reason =
        `${this.#attachTimeouts.length} CDP session attaches timed out ` +
        `within ${this.#windowMs}ms`;
    } else if (this.#lastSeenByAffinity.size >= this.#affinityThreshold) {
      reason =
        `${this.#lastSeenByAffinity.size} affinities had unresponsive tabs ` +
        `within ${this.#windowMs}ms: ${[...this.#lastSeenByAffinity.keys()].join(', ')}`;
    }
    if (!reason) {
      return null;
    }
    if (
      this.#lastRecycleAt !== undefined &&
      now - this.#lastRecycleAt < this.#minRecycleIntervalMs
    ) {
      return null;
    }
    this.#lastRecycleAt = now;
    this.#recycleCount++;
    this.reset();
    return reason;
  }

  // Forgets the reports counted so far, but not when the last recycle was.
  // The browser restart path calls this once the new browser is up, since
  // tabs from before a restart say nothing about the new browser.
  reset(): void {
    this.#lastSeenByAffinity.clear();
    this.#attachTimeouts = [];
  }
}
