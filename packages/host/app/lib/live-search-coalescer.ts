// How long a settled live search answer may satisfy an identical request from
// another consumer. Matches the realm-server's live-search cache TTL: a
// request that reached the server inside that window could have been answered
// from the server's cache with a body this old, so reusing it here adds no
// staleness the server does not already allow.
export const LIVE_SEARCH_REUSE_TTL_MS = 5_000;

interface Entry<V> {
  promise: Promise<V>;
  // The state of the world the request was sent under (see `run`).
  fingerprint: string;
  // When the request settled successfully; unset while it is in flight.
  settledAt?: number;
}

// Shares one live search between every consumer asking the identical
// question, so a tab issuing the same query from many places sends it once.
// A consumer joins a request already in flight, or adopts one that settled
// within `ttlMs`.
//
// Freshness is structural rather than temporal. Each request carries the
// fingerprint of the state it was sent under: for a live search, the count of
// realm events the tab has received for each realm it searches, and the count
// of writes the tab has completed. A request is shared only while its
// fingerprint still matches the current one, so an answer sent before a realm
// event or a write is never handed to a consumer that asks after it. The
// event that makes an answer unshareable is the same one that tells every
// live consumer of that answer to search again, so a live result is never
// left older than the newest event the tab received. `ttlMs` bounds what the
// fingerprint cannot see: a change the tab has not been told about.
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
      promise: fetch().then(
        (value) => {
          entry.settledAt = this.#now();
          return value;
        },
        (error) => {
          if (this.#entries.get(key) === entry) {
            this.#entries.delete(key);
          }
          throw error;
        },
      ),
    };
    this.#entries.set(key, entry);
    return entry.promise;
  }

  clear(): void {
    this.#entries.clear();
  }

  // Expired answers are dropped on every access, so what the coalescer holds
  // is bounded by what the tab fetched within one TTL.
  #sweep(): void {
    let now = this.#now();
    for (let [key, entry] of this.#entries) {
      if (
        entry.settledAt !== undefined &&
        now - entry.settledAt > this.#ttlMs
      ) {
        this.#entries.delete(key);
      }
    }
  }
}
