// How long after a live search is sent its answer may satisfy an identical
// request from another consumer, whether the answer is still in flight or has
// settled. The bound on what the fingerprint (see `LiveSearchCoalescer`)
// cannot see: a change the tab was never told about, such as a write landing
// while the tab's realm subscription is down. It also bounds how long a
// request that has stalled can hold every identical search behind it.
export const LIVE_SEARCH_REUSE_TTL_MS = 5_000;

interface Entry<V> {
  promise: Promise<V>;
  // The state of the world the request was sent under (see `run`).
  fingerprint: string;
  // When the request was sent. The reuse window runs from here.
  sentAt: number;
}

// Shares one live search between every consumer asking the identical
// question, so a tab issuing the same query from many places sends it once.
// A consumer joins a request already in flight, or adopts one that has
// settled, as long as it was sent within `ttlMs`.
//
// Freshness is structural rather than temporal. Each request carries the
// fingerprint of the state it was sent under: for a live search, the count of
// realm events the tab has received for each realm it searches, and the count
// of writes the tab has completed. A request is shared only while its
// fingerprint still matches the current one, so an answer sent before a realm
// event or a write is never handed to a consumer that asks after it. Any event
// for a searched realm ends the sharing, which is wider than what re-runs a
// live consumer: a consumer re-runs on the events that could change its
// result, and sharing ends on every one, so an answer is never handed out
// past an event that would have made its holders search again. `ttlMs` bounds
// what the fingerprint cannot see.
//
// A failed request is never shared past its own waiters; the next consumer
// sends its own.
export class LiveSearchCoalescer<V> {
  #entries = new Map<string, Entry<V>>();
  #ttlMs: number;
  #now: () => number;

  constructor(opts?: { ttlMs?: number; now?: () => number }) {
    this.#ttlMs = opts?.ttlMs ?? LIVE_SEARCH_REUSE_TTL_MS;
    this.#now = opts?.now ?? (() => Date.now());
  }

  // The shared answer for `key` under `fingerprint`, if one may be shared.
  peek(key: string, fingerprint: string): Promise<V> | undefined {
    this.#sweep();
    let entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.fingerprint !== fingerprint) {
      return undefined;
    }
    return entry.promise;
  }

  // The shared answer for `key` under `fingerprint`, or the answer `fetch`
  // produces, which then becomes the shared one.
  run(key: string, fingerprint: string, fetch: () => Promise<V>): Promise<V> {
    let shared = this.peek(key, fingerprint);
    if (shared) {
      return shared;
    }
    let entry: Entry<V> = {
      fingerprint,
      sentAt: this.#now(),
      promise: fetch().catch((error) => {
        if (this.#entries.get(key) === entry) {
          this.#entries.delete(key);
        }
        throw error;
      }),
    };
    this.#entries.set(key, entry);
    return entry.promise;
  }

  clear(): void {
    this.#entries.clear();
  }

  // Expired answers are dropped on every access, so what the coalescer holds
  // is bounded by what the tab sent within one TTL.
  #sweep(): void {
    let now = this.#now();
    for (let [key, entry] of this.#entries) {
      if (now - entry.sentAt > this.#ttlMs) {
        this.#entries.delete(key);
      }
    }
  }
}
