import { logger } from './log.ts';

// `process` is absent in a browser build; mirror the guard `search-bounds.ts`
// uses so a cache constructed in the host falls back to its defaults instead
// of throwing at construction.
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' ? (process.env ?? {}) : {};

export type ResponseCacheOutcome = 'hit' | 'join' | 'miss';

// One JSON-object log line per summary, on the owning cache's channel — the
// same emit convention as `boxel:screenshot-perf` / `boxel:client-perf`: the
// whole line is one JSON object with an explicit `channel` field so Loki's
// `| json` parse reads it, every field flat and top-level so LogQL can
// `unwrap` any of them directly.
//
// Counter fields are deltas over the window (`windowMs`); `entryCount` /
// `sizeBytes` are gauges at emit time; `ttlMs` / `maxBytes` echo the
// configuration so a dashboard can plot utilization against the cap without
// joining deploy metadata.
export interface ResponseCacheSummary {
  event_type: 'summary';
  windowMs: number;
  // Request outcomes: served from the TTL window / shared an in-flight
  // compute / computed fresh.
  hits: number;
  joins: number;
  misses: number;
  // Why each miss found nothing to serve: the key was never stored (or its
  // entry had already been reclaimed), or it was stored and had aged past its
  // TTL. They sum to `misses`, and they separate a cache too small or too
  // churned to retain a key from one whose TTL is simply shorter than the gap
  // between reads of it — two problems with opposite fixes.
  missesKeyAbsent: number;
  missesKeyExpired: number;
  // Entry lifecycle: aged out past the TTL / displaced by the byte cap
  // (LRU) / never retained because the value alone exceeds the whole cap.
  // `expired` counts entries removed, wherever they were noticed — a lookup,
  // the head reaper, or the eviction scan — so it measures TTL turnover rather
  // than the outcome of any particular lookup. `missesKeyExpired` is the
  // lookup-side figure.
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

type ResponseCacheCounters = {
  hits: number;
  joins: number;
  misses: number;
  missesKeyAbsent: number;
  missesKeyExpired: number;
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
  let raw = env[envName];
  if (raw !== undefined && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    return Math.max(0, Number(raw));
  }
  return fallback;
}

export interface TtlResponseCacheOptions<T> {
  // Telemetry channel for the summary lines, e.g. `boxel:live-search-cache`.
  channel: string;
  // Env var prefix for the three runtime knobs: `<prefix>_TTL_MS`,
  // `<prefix>_MAX_BYTES`, `<prefix>_TELEMETRY_INTERVAL_MS`.
  envPrefix: string;
  // Values used when neither the constructor nor the env supplies one. Each
  // cache picks its own: the right TTL depends on whether the key is a
  // freshness fingerprint (retention is the only thing the TTL bounds) or
  // merely a request identity.
  defaults: { ttlMs: number; maxBytes: number; telemetryIntervalMs: number };
  // Heap cost of a retained value, in bytes. Charged against the cap and
  // reported as the by-outcome byte counters.
  sizeOf: (value: T) => number;
  // Whether a computed value is eligible for retention at all. A value that
  // fails this is still shared with anyone who joined its computation — it
  // just isn't kept for later requests. Defaults to retaining everything.
  retain?: (value: T) => boolean;
  ttlMs?: number;
  maxBytes?: number;
  // Floor between telemetry summaries; 0 disables emission.
  telemetryIntervalMs?: number;
  // Test seam: when set, summaries go here instead of the logger.
  emitTelemetry?: (summary: ResponseCacheSummary) => void;
}

// Per-process coalescing + TTL cache for request bodies that are a pure
// function of their key. Two layers:
//
//   1. In-flight coalescing: concurrent requests on one key await a single
//      `populate` and share its resolved value. Always on — sharing a
//      computation that is already running retains nothing extra.
//   2. TTL cache: the resolved value is kept for a window so later requests
//      on the same key read it instead of recomputing.
//
// Correctness is the caller's key, not this cache's eviction. A key that
// folds in the fingerprint of everything the value was computed from makes a
// superseded entry *unreachable* rather than wrong, which is a far easier
// property to hold than "evicted in time". The TTL then bounds retention, not
// staleness.
//
// No timers: expired entries are reaped lazily on each call and during cap
// eviction, and telemetry emission rides request activity, so the cache needs
// no teardown hook and can't leak handles in tests. Idle retention is bounded
// by the byte cap and reclaimed on the next call.
export class TtlResponseCache<T> {
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #telemetryIntervalMs: number;
  readonly #channel: string;
  readonly #sizeOf: (value: T) => number;
  readonly #retain: (value: T) => boolean;
  readonly #emitTelemetry: (summary: ResponseCacheSummary) => void;
  #inFlight = new Map<string, Promise<T>>();
  // Insertion order is recency order: hits re-insert their entry, so the
  // head of the map is always the least-recently-used entry.
  #entries = new Map<string, { value: T; bytes: number; expiresAt: number }>();
  #totalBytes = 0;
  // Cumulative counters (never reset — `stats` exposes them raw; telemetry
  // emits per-window deltas against #lastEmitted).
  #counters: ResponseCacheCounters = {
    hits: 0,
    joins: 0,
    misses: 0,
    missesKeyAbsent: 0,
    missesKeyExpired: 0,
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

  constructor(opts: TtlResponseCacheOptions<T>) {
    this.#channel = opts.channel;
    this.#sizeOf = opts.sizeOf;
    this.#retain = opts.retain ?? (() => true);
    this.#ttlMs = configNumber(
      opts.ttlMs,
      `${opts.envPrefix}_TTL_MS`,
      opts.defaults.ttlMs,
    );
    this.#maxBytes = configNumber(
      opts.maxBytes,
      `${opts.envPrefix}_MAX_BYTES`,
      opts.defaults.maxBytes,
    );
    this.#telemetryIntervalMs = configNumber(
      opts.telemetryIntervalMs,
      `${opts.envPrefix}_TELEMETRY_INTERVAL_MS`,
      opts.defaults.telemetryIntervalMs,
    );
    this.#emitTelemetry =
      opts.emitTelemetry ??
      ((summary) => defaultEmitTelemetry(this.#channel, summary));
  }

  // `onOutcome` fires the moment the cache decides how it will satisfy the
  // request — before a joiner starts waiting on the in-flight compute, before
  // a hit returns, and as a miss starts its populate — so a caller can act on
  // the decision while the request is still in progress. The realm-server's
  // search admission uses it to hand back the slot of a request that holds no
  // result document of its own.
  async getOrPopulate(args: {
    key: string;
    populate: () => Promise<T>;
    onOutcome?: (outcome: ResponseCacheOutcome) => void;
  }): Promise<{ value: T; outcome: ResponseCacheOutcome }> {
    try {
      return await this.#getOrPopulate(args);
    } finally {
      this.#maybeEmitTelemetry();
    }
  }

  async #getOrPopulate(args: {
    key: string;
    populate: () => Promise<T>;
    onOutcome?: (outcome: ResponseCacheOutcome) => void;
  }): Promise<{ value: T; outcome: ResponseCacheOutcome }> {
    let { key } = args;
    // Classified before the reaper runs. It removes expired entries from the
    // head, so a key it takes would read as absent below and this lookup would
    // be indistinguishable from one for a key that was never stored.
    let entryAtLookup = this.#entries.get(key);
    let keyWasExpired =
      entryAtLookup !== undefined && entryAtLookup.expiresAt <= Date.now();
    this.#reapExpiredHead();
    let onOutcome = args.onOutcome ?? (() => {});

    let entry = this.#entries.get(key);
    if (entry) {
      if (entry.expiresAt > Date.now()) {
        // Refresh recency: re-insert so this entry moves to the tail and cap
        // eviction (head-first) takes the least-recently-used entry first.
        this.#entries.delete(key);
        this.#entries.set(key, entry);
        this.#counters.hits += 1;
        this.#counters.hitBytes += entry.bytes;
        onOutcome('hit');
        return { value: entry.value, outcome: 'hit' };
      }
      this.#delete(key, entry);
      this.#counters.expired += 1;
    }

    let inFlight = this.#inFlight.get(key);
    if (inFlight) {
      this.#counters.joins += 1;
      onOutcome('join');
      let value = await inFlight;
      this.#counters.joinBytes += this.#sizeOf(value);
      return { value, outcome: 'join' };
    }

    onOutcome('miss');
    let promise = args.populate();
    this.#inFlight.set(key, promise);
    try {
      let value = await promise;
      this.#counters.misses += 1;
      this.#counters[keyWasExpired ? 'missesKeyExpired' : 'missesKeyAbsent'] +=
        1;
      this.#counters.missBytes += this.#sizeOf(value);
      this.#store(key, value);
      return { value, outcome: 'miss' };
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

  // Observability for tests and debugging. `sizeBytes` is the sum of
  // `sizeOf` over the retained entries.
  get stats(): ResponseCacheCounters & {
    entryCount: number;
    sizeBytes: number;
  } {
    return {
      ...this.#counters,
      entryCount: this.#entries.size,
      sizeBytes: this.#totalBytes,
    };
  }

  #store(key: string, value: T): void {
    // ttl 0 disables retention entirely (coalescing still applies); a value
    // the caller declined to retain is shared with its joiners but kept for
    // nobody; one larger than the whole cap can never fit and would only
    // evict everything else on its way through.
    if (this.#ttlMs === 0 || !this.#retain(value)) {
      return;
    }
    let bytes = this.#sizeOf(value);
    if (bytes > this.#maxBytes) {
      this.#counters.oversized += 1;
      return;
    }
    // Subtract any entry already filed under this key before overwriting it.
    // No current path reaches `#store` on a live key — a miss only runs when
    // the key was absent or expired-and-deleted, and `#inFlight` is
    // registered in the same synchronous turn as `populate()` is called — but
    // the failure mode if one ever did would be silent and permanent:
    // `#totalBytes` would ratchet up, eviction would fire on every store, and
    // the cache would decay to a zero hit rate with no counter saying why.
    let prior = this.#entries.get(key);
    if (prior) {
      this.#totalBytes -= prior.bytes;
    }
    this.#entries.set(key, {
      value,
      bytes,
      expiresAt: Date.now() + this.#ttlMs,
    });
    this.#totalBytes += bytes;
    this.#evictOverCap();
  }

  #delete(key: string, entry: { bytes: number }): void {
    this.#entries.delete(key);
    this.#totalBytes -= entry.bytes;
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
    let deltas = {} as ResponseCacheCounters;
    let activity = 0;
    for (let name of Object.keys(this.#counters) as Array<
      keyof ResponseCacheCounters
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

// Created lazily and per channel: a module-scope `logger()` call can race the
// circular import that installs the logger factory (the same hazard
// `emitSearchTiming` documents).
let cacheLogs = new Map<string, ReturnType<typeof logger>>();
function defaultEmitTelemetry(
  channel: string,
  summary: ResponseCacheSummary,
): void {
  let log = cacheLogs.get(channel);
  if (!log) {
    log = logger(channel);
    cacheLogs.set(channel, log);
  }
  log.info(JSON.stringify({ channel, ...summary }));
}
