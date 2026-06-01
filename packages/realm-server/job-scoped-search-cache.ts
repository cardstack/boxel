import {
  logger,
  normalizeQueryForSignature,
  query,
  param,
  sortKeysDeep,
  type DBAdapter,
  type Expression,
  type Query,
} from '@cardstack/runtime-common';
import { md5 } from 'super-fast-md5';

const log = logger('job-scoped-search-cache');

const TABLE = 'job_scoped_search_cache';

// Missed-NOTIFY backstop. The jobs_finished listener evicts a job's entries as
// soon as it finalizes; this TTL only governs the janitor sweep that reclaims
// rows a job left behind when a replica missed the NOTIFY. Picked to
// comfortably outlive a single indexing batch (from-scratch reindexes of large
// realms can run an hour or more) while bounding the leak window.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

// How often the janitor sweeps aged rows. Infrequent — eviction is normally
// driven by the NOTIFY listener; this only mops up missed-NOTIFY orphans.
const DEFAULT_JANITOR_INTERVAL_MS = 30 * 60 * 1000;

// Per-batch read cache used during indexing, backed by a shared Postgres table
// so every realm-server replica reads and writes the same entries — one
// consolidated hit rate across the fleet rather than one per process.
//
// Each entry is keyed by the `<jobId>.<reservationId>` job identity (stamped on
// `x-boxel-job-id`) plus the md5 of the canonical `(realms, query, opts)`
// signature. That md5 is the same digest `computeETag` emits as the entry's
// validator, so matching on the hash is consistent with the existing ETag
// trust model. The job-id boundary scopes the cache to a single batch; a
// subsequent job hashes to different keys and never reuses a stale value.
//
// Same-realm reads are safe by construction: within an indexing batch the
// writer touches `boxel_index_working`, not `boxel_index`, so every read of the
// consuming realm's `boxel_index` returns identical bytes until the batch's
// `applyBatchUpdates` swap fires. Cross-realm reads accept a looser contract —
// within one jobId, results are pinned to the first observation regardless of
// whether a peer realm has swapped since ("one consolidated view of the
// realm-server's state per batch"). The bound is the job's lifetime.
//
// The handler gates entry into this cache on `x-boxel-job-id` and
// `x-boxel-consuming-realm` both being present and well-formed; both headers
// are only stamped by indexer-driven prerender requests, so user-facing API
// callers always bypass and see live state.
//
// Entries store the *resolved, serialized* response bytes (a `string`).
// Concurrent same-key populates each run their own `populate` and race to
// `INSERT ... ON CONFLICT DO NOTHING`; first write wins, and because both came
// from the same `(jobId, query)` tuple against the same snapshot-stable
// `boxel_index` either resolved doc is equally valid.
export class JobScopedSearchCache {
  readonly #dbAdapter: DBAdapter;
  readonly #ttlMs: number;
  readonly #janitorIntervalMs: number;
  #janitorTimer: ReturnType<typeof setInterval> | undefined;
  // Per-process hit/miss counters for observability. Recorded on every
  // `getOrPopulate` and emitted as a single debug line when the job's entries
  // are dropped via `clearJob`. Off by default; enable via
  // `LOG_LEVELS=job-scoped-search-cache=debug`. Cross-replica hit rates aren't
  // aggregated — each replica reports what it observed.
  //
  // `clearJob` is the normal flush path, but it isn't guaranteed to run for
  // every job this process observed: a peer replica can `clearJob` the shared
  // rows first (so this process's jobs_finished sweep never sees the job id),
  // or the rows can be reclaimed by the janitor on a missed NOTIFY. Without a
  // backstop those entries would accumulate forever. So each entry carries the
  // time it was last touched, and the janitor flushes (and drops) any entry not
  // touched within the TTL — the same age bound the DB rows themselves obey.
  #stats = new Map<
    string,
    { hits: number; misses: number; lastTouchedAt: number }
  >();

  constructor(
    dbAdapter: DBAdapter,
    opts?: { ttlMs?: number; janitorIntervalMs?: number },
  ) {
    this.#dbAdapter = dbAdapter;
    this.#ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.#janitorIntervalMs =
      opts?.janitorIntervalMs ?? DEFAULT_JANITOR_INTERVAL_MS;
  }

  async getOrPopulate(args: {
    jobId: string;
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<string>;
  }): Promise<string> {
    let hash = innerKeyHash(args.realms, args.query, args.opts);
    let existing = await this.#getCachedByHash(args.jobId, hash);
    if (existing !== undefined) {
      let stat = this.#stats.get(args.jobId);
      if (stat) {
        stat.hits += 1;
        stat.lastTouchedAt = Date.now();
      }
      return existing;
    }

    let result = await args.populate();
    // Count the miss only after populate resolves: if it throws we count
    // nothing and never allocate a #stats entry for a jobId that produced no
    // cache entry.
    let stat = this.#stats.get(args.jobId);
    if (!stat) {
      stat = { hits: 0, misses: 0, lastTouchedAt: Date.now() };
      this.#stats.set(args.jobId, stat);
    }
    stat.misses += 1;
    stat.lastTouchedAt = Date.now();

    await query(this.#dbAdapter, [
      `INSERT INTO ${TABLE} (job_id, inner_key_hash, result) VALUES (`,
      param(args.jobId),
      `,`,
      param(hash),
      `,`,
      param(result),
      `) ON CONFLICT (job_id, inner_key_hash) DO NOTHING`,
    ] as Expression);

    return result;
  }

  // Read the cached body without populating or touching stats. Used by the
  // handler's 304 path to confirm the slot still exists before returning
  // Not-Modified.
  async getCached(args: {
    jobId: string;
    realms: string[];
    query: Query;
    opts: unknown | undefined;
  }): Promise<string | undefined> {
    return this.#getCachedByHash(
      args.jobId,
      innerKeyHash(args.realms, args.query, args.opts),
    );
  }

  async #getCachedByHash(
    jobId: string,
    hash: string,
  ): Promise<string | undefined> {
    let rows = (await query(this.#dbAdapter, [
      `SELECT result FROM ${TABLE} WHERE job_id=`,
      param(jobId),
      ` AND inner_key_hash=`,
      param(hash),
    ] as Expression)) as { result: string }[];
    return rows[0]?.result;
  }

  // Drop every entry for a given job. Driven by the jobs_finished NOTIFY
  // listener so the cache releases rows as soon as the worker signals
  // completion, rather than waiting on the janitor.
  async clearJob(jobId: string): Promise<void> {
    this.#flushStats(jobId, 'clearJob');
    await query(this.#dbAdapter, [
      `DELETE FROM ${TABLE} WHERE job_id=`,
      param(jobId),
    ] as Expression);
  }

  // Distinct `<jobId>.<reservationId>` keys currently holding entries. The
  // listener parses these to learn which jobs to check for finalization.
  async jobIds(): Promise<string[]> {
    let rows = (await query(this.#dbAdapter, [
      `SELECT DISTINCT job_id FROM ${TABLE}`,
    ] as Expression)) as { job_id: string }[];
    return rows.map((row) => row.job_id);
  }

  // Total entry count across all jobs. Useful for tests + observability.
  async size(): Promise<number> {
    let rows = (await query(this.#dbAdapter, [
      `SELECT COUNT(*)::int AS count FROM ${TABLE}`,
    ] as Expression)) as { count: number }[];
    return rows[0]?.count ?? 0;
  }

  // Count of jobs this process is holding local #stats for. Bounded by the
  // stale-stats janitor; exposed so tests can assert that backstop runs.
  get trackedStatJobCount(): number {
    return this.#stats.size;
  }

  // Job-id-based weak ETag. Same `(jobId, realms, query, opts)` always produces
  // the same value for an entry's lifetime; a different jobId yields a
  // different ETag so a stale If-None-Match from a previous batch never matches
  // a fresh entry.
  computeETag(args: {
    jobId: string;
    realms: string[];
    query: Query;
    opts: unknown | undefined;
  }): string {
    return `W/"${args.jobId}-${innerKeyHash(args.realms, args.query, args.opts)}"`;
  }

  // ── Janitor (missed-NOTIFY backstop) ──

  startJanitor(): void {
    if (this.#janitorTimer) {
      return;
    }
    this.#janitorTimer = setInterval(() => {
      void this.sweepExpired();
    }, this.#janitorIntervalMs);
    if (
      typeof (this.#janitorTimer as { unref?: () => void }).unref === 'function'
    ) {
      (this.#janitorTimer as { unref: () => void }).unref();
    }
  }

  stopJanitor(): void {
    if (this.#janitorTimer) {
      clearInterval(this.#janitorTimer);
      this.#janitorTimer = undefined;
    }
  }

  // Delete rows older than the TTL — the rows a job left behind because some
  // replica missed its jobs_finished NOTIFY. Best-effort. Also flushes local
  // #stats entries that have aged out, so they can't accumulate when clearJob
  // never runs for a job this process observed (see #flushStaleStats).
  async sweepExpired(): Promise<void> {
    try {
      await query(this.#dbAdapter, [
        `DELETE FROM ${TABLE} WHERE created_at < NOW() - (`,
        param(this.#ttlMs),
        ` * INTERVAL '1 millisecond')`,
      ] as Expression);
    } catch (err: unknown) {
      log.warn(`job-scoped search cache janitor sweep failed: ${String(err)}`);
    }
    this.#flushStaleStats();
  }

  // Single sink for the once-per-job stats log, emitted from clearJob.
  #flushStats(jobId: string, reason: string): void {
    let stat = this.#stats.get(jobId);
    if (!stat) {
      return;
    }
    let total = stat.hits + stat.misses;
    let hitRate =
      total === 0 ? '0%' : `${Math.round((100 * stat.hits) / total)}%`;
    log.debug(
      `job-scoped search cache stats job=${jobId} hits=${stat.hits} misses=${stat.misses} hitRate=${hitRate} (${reason})`,
    );
    this.#stats.delete(jobId);
  }

  // Flush #stats entries that haven't been touched within the TTL. clearJob
  // handles the normal eviction, but a job's stats outlive its rows whenever
  // clearJob never runs for it on this process — a peer replica cleared the
  // shared rows first, or the janitor reclaimed them on a missed NOTIFY. An
  // entry stops being touched once its job stops issuing reads, so aging out at
  // the TTL bounds the map without dropping stats for a still-active job.
  #flushStaleStats(): void {
    let cutoff = Date.now() - this.#ttlMs;
    for (let [jobId, stat] of this.#stats) {
      if (stat.lastTouchedAt < cutoff) {
        this.#flushStats(jobId, 'expired');
      }
    }
  }
}

// Compose the per-job inner key and hash it. Excludes jobId since the outer
// `job_id` column already partitions by job. The realms array is included
// verbatim (no sort, no dedupe): `_federated-search` preserves input order in
// its `data` array and first-occurrence `included`, so `[A, B]` and `[B, A]`
// are different responses and must hash to different entries.
function innerKeyHash(
  realms: string[],
  query: Query,
  opts: unknown | undefined,
): string {
  let innerKey = JSON.stringify([
    realms,
    normalizeQueryForSignature(query),
    opts ? sortKeysDeep(opts) : null,
  ]);
  return md5(innerKey);
}
