import { logger, type Query } from '@cardstack/runtime-common';
import { searchRequestKeyHash } from './job-scoped-search-cache.ts';

// Defaults are deliberately conservative: the TTL only needs to cover the
// window in which a burst of clients issues the same query (an index event
// fanning out to every subscribed browser), and the byte cap bounds how much
// heap the cache can hold at its worst — entry bodies are fully-assembled
// federated-search documents that can run to many MB each.
const DEFAULT_TTL_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
// Floor between telemetry summary lines. Emission piggybacks on request
// activity (see #maybeEmitTelemetry), so an idle cache emits nothing and a
// busy one emits at most one line per interval.
const DEFAULT_TELEMETRY_INTERVAL_MS = 30_000;

export const LIVE_SEARCH_CACHE_CHANNEL = 'boxel:live-search-cache';

export type LiveSearchOutcome = 'hit' | 'join' | 'miss';

// One JSON-object log line per summary on the `boxel:live-search-cache`
// channel — the same emit convention as `boxel:screenshot-perf` /
// `boxel:client-perf`: the whole line is one JSON object with an explicit
// `channel` field so Loki's `| json` parse reads it, every field flat and
// top-level so LogQL can `unwrap` any of them directly.
//
// Counter fields are deltas over the window (`windowMs`); `entryCount` /
// `sizeBytes` are gauges at emit time; `ttlMs` / `maxBytes` echo the
// configuration so a dashboard can plot utilization against the cap without
// joining deploy metadata.
export interface LiveSearchCacheSummary {
  event_type: 'summary';
  windowMs: number;
  // Request outcomes: served from the TTL window / shared an in-flight
  // compute / computed fresh.
  hits: number;
  joins: number;
  misses: number;
  // Entry lifecycle: aged out past the TTL / displaced by the byte cap
  // (LRU) / never retained because the body alone exceeds the whole cap.
  expired: number;
  evicted: number;
  oversized: number;
  // Failed populates (the initiating compute rejected; joiners of that
  // compute are not double-counted).
  errors: number;
  // Response bytes by outcome: hitBytes + joinBytes is traffic served
  // without recomputation; missBytes is what fresh computes produced.
  hitBytes: number;
  joinBytes: number;
  missBytes: number;
  entryCount: number;
  sizeBytes: number;
  ttlMs: number;
  maxBytes: number;
}

type LiveSearchCounters = {
  hits: number;
  joins: number;
  misses: number;
  expired: number;
  evicted: number;
  oversized: number;
  errors: number;
  hitBytes: number;
  joinBytes: number;
  missBytes: number;
};

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
// No timers: expired entries are reaped lazily on each call and during cap
// eviction, and telemetry emission rides request activity, so the cache
// needs no teardown hook and can't leak handles in tests. Idle retention is
// bounded by the byte cap and reclaimed on the next call.
export class LiveSearchCache {
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #telemetryIntervalMs: number;
  readonly #emitTelemetry: (summary: LiveSearchCacheSummary) => void;
  #inFlight = new Map<string, Promise<string>>();
  // Insertion order is recency order: hits re-insert their entry, so the
  // head of the map is always the least-recently-used entry.
  #entries = new Map<string, { body: string; expiresAt: number }>();
  #totalBytes = 0;
  // Cumulative counters (never reset — `stats` exposes them raw; telemetry
  // emits per-window deltas against #lastEmitted).
  #counters: LiveSearchCounters = {
    hits: 0,
    joins: 0,
    misses: 0,
    expired: 0,
    evicted: 0,
    oversized: 0,
    errors: 0,
    hitBytes: 0,
    joinBytes: 0,
    missBytes: 0,
  };
  #lastEmitted = { ...this.#counters };
  #lastEmitAt = Date.now();

  constructor(opts?: {
    ttlMs?: number;
    maxBytes?: number;
    // Floor between telemetry summaries; 0 disables emission.
    telemetryIntervalMs?: number;
    // Test seam: when set, summaries go here instead of the logger.
    emitTelemetry?: (summary: LiveSearchCacheSummary) => void;
  }) {
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
    this.#telemetryIntervalMs = configNumber(
      opts?.telemetryIntervalMs,
      'LIVE_SEARCH_CACHE_TELEMETRY_INTERVAL_MS',
      DEFAULT_TELEMETRY_INTERVAL_MS,
    );
    this.#emitTelemetry = opts?.emitTelemetry ?? defaultEmitTelemetry;
  }

  // `onOutcome` fires the moment the cache decides how it will satisfy the
  // request — before a joiner starts waiting on the in-flight compute, before
  // a hit returns, and as a miss starts its populate — so a caller can act on
  // the decision while the request is still in progress. The realm-server's
  // search admission uses it to hand back the slot of a request that holds no
  // result document of its own.
  async getOrPopulate(args: {
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<string>;
    onOutcome?: (outcome: LiveSearchOutcome) => void;
  }): Promise<{ body: string; outcome: LiveSearchOutcome }> {
    try {
      return await this.#getOrPopulate(args);
    } finally {
      this.#maybeEmitTelemetry();
    }
  }

  async #getOrPopulate(args: {
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<string>;
    onOutcome?: (outcome: LiveSearchOutcome) => void;
  }): Promise<{ body: string; outcome: LiveSearchOutcome }> {
    this.#reapExpiredHead();
    let key = searchRequestKeyHash(args.realms, args.query, args.opts);
    let onOutcome = args.onOutcome ?? (() => {});

    let entry = this.#entries.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        // Refresh recency: re-insert so this entry moves to the tail and cap
        // eviction (head-first) takes the least-recently-used entry first.
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        this.#counters.hits += 1;
        this.#counters.hitBytes += entry.body.length;
        onOutcome('hit');
        return { body: entry.body, outcome: 'hit' };
      }
      this.#delete(key, entry);
      this.#counters.expired += 1;
    }

    let inFlight = this.#inFlight.get(key);
    if (inFlight) {
      this.#counters.joins += 1;
      onOutcome('join');
      let body = await inFlight;
      this.#counters.joinBytes += body.length;
      return { body, outcome: 'join' };
    }

    onOutcome('miss');
    let promise = args.populate();
    this.#inFlight.set(key, promise);
    try {
      let body = await promise;
      this.#counters.misses += 1;
      this.#counters.missBytes += body.length;
      this.#store(key, body);
      return { body, outcome: 'miss' };
    } catch (e) {
      // Counted once per failed compute; joiners awaiting the same promise
      // reject too but are not the compute.
      this.#counters.errors += 1;
      throw e;
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
    expired: number;
    evicted: number;
    oversized: number;
    errors: number;
    hitBytes: number;
    joinBytes: number;
    missBytes: number;
    entryCount: number;
    sizeBytes: number;
  } {
    return {
      ...this.#counters,
      entryCount: this.#entries.size,
      sizeBytes: this.#totalBytes,
    };
  }

  #store(key: string, body: string): void {
    // ttl 0 disables retention entirely (coalescing still applies); a body
    // larger than the whole cap can never fit and would only evict
    // everything else on its way through.
    if (this.#ttlMs === 0) {
      return;
    }
    if (body.length > this.#maxBytes) {
      this.#counters.oversized += 1;
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
  // means the head holds the least-recently-used entries; an expired entry
  // behind a live one (possible, since a hit re-inserts with its original
  // expiry) is caught on its own access or by the cap-eviction scan instead.
  #reapExpiredHead(): void {
    let now = Date.now();
    for (let [key, entry] of this.#entries) {
      if (entry.expiresAt > now) {
        break;
      }
      this.#delete(key, entry);
      this.#counters.expired += 1;
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
        this.#counters.expired += 1;
      }
    }
    for (let [key, entry] of this.#entries) {
      if (this.#totalBytes <= this.#maxBytes) {
        break;
      }
      this.#delete(key, entry);
      this.#counters.evicted += 1;
    }
  }

  // Telemetry rides request activity rather than a timer: after each call,
  // emit one summary line when at least the configured interval has passed
  // since the last one and the window saw any activity. A burst that ends
  // leaves its tail counted-but-unemitted until the next request — deltas
  // are cumulative so nothing is lost, only deferred; during any load worth
  // dashboarding, traffic is continuous and the line lands each interval.
  #maybeEmitTelemetry(): void {
    if (this.#telemetryIntervalMs === 0) {
      return;
    }
    let now = Date.now();
    let windowMs = now - this.#lastEmitAt;
    if (windowMs < this.#telemetryIntervalMs) {
      return;
    }
    let deltas = {} as LiveSearchCounters;
    let activity = 0;
    for (let name of Object.keys(this.#counters) as Array<
      keyof LiveSearchCounters
    >) {
      deltas[name] = this.#counters[name] - this.#lastEmitted[name];
      activity += deltas[name];
    }
    if (activity === 0) {
      // Nothing happened; slide the window rather than emit an empty line.
      this.#lastEmitAt = now;
      return;
    }
    this.#lastEmitted = { ...this.#counters };
    this.#lastEmitAt = now;
    this.#emitTelemetry({
      event_type: 'summary',
      windowMs,
      ...deltas,
      entryCount: this.#entries.size,
      sizeBytes: this.#totalBytes,
      ttlMs: this.#ttlMs,
      maxBytes: this.#maxBytes,
    });
  }
}

// Created lazily: a module-scope `logger()` call can race the circular
// import that installs the logger factory (the same hazard
// `emitSearchTiming` documents).
let liveSearchCacheLog: ReturnType<typeof logger> | undefined;
function defaultEmitTelemetry(summary: LiveSearchCacheSummary): void {
  (liveSearchCacheLog ??= logger(LIVE_SEARCH_CACHE_CHANNEL)).info(
    JSON.stringify({ channel: LIVE_SEARCH_CACHE_CHANNEL, ...summary }),
  );
}
