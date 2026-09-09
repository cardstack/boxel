import type { Query } from '@cardstack/runtime-common';
import { searchRequestKeyHash } from './job-scoped-search-cache.ts';

// Defaults are deliberately conservative: the TTL only needs to cover the
// window in which a burst of clients issues the same query (an index event
// fanning out to every subscribed browser), and the byte cap bounds how much
// heap the cache can hold at its worst — entry bodies are fully-assembled
// federated-search documents that can run to many MB each.
const DEFAULT_TTL_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

export type LiveSearchOutcome = 'hit' | 'join' | 'miss';

// Explicit constructor option first (0 is a real value — it disables
// retention), then the env var when it parses as a number, then the default.
function configNumber(
  explicit: number | undefined,
  envName: string,
  fallback: number,
): number {
  if (explicit !== undefined) {
    return Math.max(0, explicit);
  }
  let raw = process.env[envName];
  if (raw !== undefined && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    return Math.max(0, Number(raw));
  }
  return fallback;
}

// Per-process coalescing + short-TTL cache for LIVE `_federated-search`
// requests — the callers the job-scoped cache deliberately excludes (no
// `x-boxel-job-id`). Live searches are dominated by many clients rendering
// the same cards: their queries are byte-identical, and every incremental
// index event makes every subscribed client re-issue them at once. Without
// this layer each of those requests runs its own SQL + `loadLinks` assembly
// and stringifies its own multi-MB document — concurrent identical requests
// scale heap linearly and have OOM'd the realm-server in production.
//
// Two layers, both keyed on the same canonical `(realms, query, opts)` hash
// the job-scoped cache uses:
//
//   1. In-flight coalescing: concurrent identical requests await one
//      `populate` and share the resolved body string. Always on — sharing a
//      computation that is already running retains nothing extra.
//   2. TTL cache: the resolved body is kept for a short window so near-miss
//      stragglers (clients whose re-run lands just after the first resolves)
//      also share it. Freshness is structural, not temporal: the caller folds
//      each realm's generation fingerprint into `opts`, so any index or
//      prerendered-HTML swap on a searched realm changes the key and the
//      next request recomputes. The TTL exists to bound retention, not to
//      bound staleness.
//
// Sharing across users is safe: the body is a pure function of
// `(realms, query, opts)` — permissions are realm-scoped and
// `multiRealmAuthorization` has already validated every caller against the
// full realm list before the handler runs.
//
// One deliberate looseness: `_federated-search` drops a realm that fails to
// mount rather than failing the whole request, so a body computed during a
// transient per-realm failure can be served to TTL-window stragglers. Those
// callers would have received the same degraded body from their own compute
// moments earlier; the short TTL bounds the recovery lag.
//
// No timers: expired entries are reaped lazily on each call and during
// cap eviction, so the cache needs no teardown hook and can't leak handles
// in tests. Idle retention is bounded by the byte cap and reclaimed on the
// next call.
export class LiveSearchCache {
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  #inFlight = new Map<string, Promise<string>>();
  // Insertion order is recency order: hits re-insert their entry, so the
  // head of the map is always the least-recently-used entry.
  #entries = new Map<string, { body: string; expiresAt: number }>();
  #totalBytes = 0;
  #hits = 0;
  #joins = 0;
  #misses = 0;

  constructor(opts?: { ttlMs?: number; maxBytes?: number }) {
    this.#ttlMs = configNumber(
      opts?.ttlMs,
      'LIVE_SEARCH_CACHE_TTL_MS',
      DEFAULT_TTL_MS,
    );
    this.#maxBytes = configNumber(
      opts?.maxBytes,
      'LIVE_SEARCH_CACHE_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
  }

  async getOrPopulate(args: {
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<string>;
  }): Promise<{ body: string; outcome: LiveSearchOutcome }> {
    this.#reapExpiredHead();
    let key = searchRequestKeyHash(args.realms, args.query, args.opts);

    let entry = this.#entries.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        // Refresh recency: re-insert so this entry moves to the tail and cap
        // eviction (head-first) takes the least-recently-used entry first.
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        this.#hits += 1;
        return { body: entry.body, outcome: 'hit' };
      }
      this.#delete(key, entry);
    }

    let inFlight = this.#inFlight.get(key);
    if (inFlight) {
      this.#joins += 1;
      return { body: await inFlight, outcome: 'join' };
    }

    let promise = args.populate();
    this.#inFlight.set(key, promise);
    try {
      let body = await promise;
      this.#misses += 1;
      this.#store(key, body);
      return { body, outcome: 'miss' };
    } finally {
      // Delete on rejection too: a failed populate must not pin the key, or
      // every retry would join a dead promise.
      this.#inFlight.delete(key);
    }
  }

  // Observability for tests and debugging. `sizeBytes` approximates heap
  // cost by string length — federated-search bodies are JSON and thus
  // overwhelmingly single-byte characters.
  get stats(): {
    hits: number;
    joins: number;
    misses: number;
    entryCount: number;
    sizeBytes: number;
  } {
    return {
      hits: this.#hits,
      joins: this.#joins,
      misses: this.#misses,
      entryCount: this.#entries.size,
      sizeBytes: this.#totalBytes,
    };
  }

  #store(key: string, body: string): void {
    // ttl 0 disables retention entirely (coalescing still applies); a body
    // larger than the whole cap can never fit and would only evict
    // everything else on its way through.
    if (this.#ttlMs === 0 || body.length > this.#maxBytes) {
      return;
    }
    this.#entries.set(key, { body, expiresAt: Date.now() + this.#ttlMs });
    this.#totalBytes += body.length;
    this.#evictOverCap();
  }

  #delete(key: string, entry: { body: string }): void {
    this.#entries.delete(key);
    this.#totalBytes -= entry.body.length;
  }

  // Drop expired entries from the head of the map. Recency re-insertion
  // means the head holds the oldest entries, so this stops at the first
  // live one — O(expired) per call, not O(entries).
  #reapExpiredHead(): void {
    let now = Date.now();
    for (let [key, entry] of this.#entries) {
      if (entry.expiresAt > now) {
        break;
      }
      this.#delete(key, entry);
    }
  }

  #evictOverCap(): void {
    if (this.#totalBytes <= this.#maxBytes) {
      return;
    }
    // Reclaim expired entries anywhere in the map first, then take
    // least-recently-used from the head.
    let now = Date.now();
    for (let [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#delete(key, entry);
      }
    }
    for (let [key, entry] of this.#entries) {
      if (this.#totalBytes <= this.#maxBytes) {
        break;
      }
      this.#delete(key, entry);
    }
  }
}
