// Decides when renders timing out on unresponsive tabs mean the browser as a
// whole needs recycling, rather than just the tabs involved.
//
// A render timeout already retires its own tab: the affinity is evicted and
// the tab's target closed, which takes its renderer process with it. That is
// enough for a card that pegs its tab on every render — each render costs one
// tab, and the rest of the browser is unaffected — so a single realm timing
// out repeatedly must never restart Chrome under every other realm's renders.
//
// Reports are therefore counted by realm, not by affinity key. A realm's
// affinities are split by render session (the indexer's realm-authority
// session, each signed-in user, anonymous), and one pegged card wedges the tab
// of every session that renders it, so counting affinity keys would let a
// single card look like several unrelated failures. A user affinity counts as
// its own realm. Two signals point past the tab:
//
//   * CDP session attaches timing out in distinct realms within the window.
//     The attach is the browser's to answer, but whether Chrome ever holds it
//     for an unresponsive renderer isn't pinned down, so one realm's
//     timed-out attaches are not enough on their own, however many there are.
//   * Tabs of several distinct realms going unresponsive within the window.
//     Each affinity renders in its own BrowserContext on its own renderer
//     process, so unrelated realms wedging together points at the browser
//     rather than at any one card.
//
// Neither signal is proof. A definition shared across realms (a catalog or
// base card) that loops on some data shape wedges a renderer in every realm
// that renders it, and a host starved for CPU fails the responsiveness probe
// on tabs that are only slow. A recycle can't help either case, and each one
// costs every user of this prerender server something:
//
//   * every warm context is dropped, so each realm's next render pays a cold
//     start;
//   * renders in flight on other tabs fail with the browser. Visits and module
//     renders await the restart and retry once on the new browser, but a
//     command is not retried, here or by the realm-server (`run-command` is
//     resent only when it was never delivered), because running it again could
//     repeat its writes. Its caller gets the error.
//
// So recycles are spaced at least `minRecycleIntervalMs` apart and counted for
// the logs.

import { realmAffinityKeyOf } from './affinity.ts';

export const DEFAULT_UNRESPONSIVE_REALM_THRESHOLD = 3;
export const DEFAULT_ATTACH_TIMEOUT_THRESHOLD = 2;
export const DEFAULT_UNRESPONSIVE_WINDOW_MS = 5 * 60_000;
export const DEFAULT_MIN_RECYCLE_INTERVAL_MS = 15 * 60_000;

export type UnresponsiveTabReport = {
  affinityKey: string;
  // Attaching a CDP session to the tab timed out.
  browserUnresponsive: boolean;
};

export class UnresponsiveTabTracker {
  #realmThreshold: number;
  #attachThreshold: number;
  #windowMs: number;
  #minRecycleIntervalMs: number;
  #now: () => number;
  // Latest unresponsive timeout per realm.
  #lastSeenByRealm = new Map<string, number>();
  // Latest timed-out attach per realm.
  #lastAttachTimeoutByRealm = new Map<string, number>();
  #lastRecycleAt: number | undefined;
  #recycleCount = 0;

  constructor(options?: {
    realmThreshold?: number;
    attachThreshold?: number;
    windowMs?: number;
    minRecycleIntervalMs?: number;
    now?: () => number;
  }) {
    this.#realmThreshold =
      options?.realmThreshold ?? DEFAULT_UNRESPONSIVE_REALM_THRESHOLD;
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
    let realm = realmAffinityKeyOf(report.affinityKey);
    this.#lastSeenByRealm.set(realm, now);
    if (report.browserUnresponsive) {
      this.#lastAttachTimeoutByRealm.set(realm, now);
    }
    for (let seen of [this.#lastSeenByRealm, this.#lastAttachTimeoutByRealm]) {
      for (let [key, seenAt] of seen) {
        if (now - seenAt > this.#windowMs) {
          seen.delete(key);
        }
      }
    }

    let reason: string | null = null;
    if (this.#lastAttachTimeoutByRealm.size >= this.#attachThreshold) {
      reason =
        `CDP session attaches timed out in ` +
        `${this.#lastAttachTimeoutByRealm.size} realms within ` +
        `${this.#windowMs}ms: ${[...this.#lastAttachTimeoutByRealm.keys()].join(', ')}`;
    } else if (this.#lastSeenByRealm.size >= this.#realmThreshold) {
      reason =
        `${this.#lastSeenByRealm.size} realms had unresponsive tabs ` +
        `within ${this.#windowMs}ms: ${[...this.#lastSeenByRealm.keys()].join(', ')}`;
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
    this.#lastSeenByRealm.clear();
    this.#lastAttachTimeoutByRealm.clear();
  }
}
