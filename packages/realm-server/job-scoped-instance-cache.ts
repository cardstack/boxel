import {
  logger,
  query,
  param,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';

const log = logger('job-scoped-instance-cache');

const TABLE = 'job_scoped_instance_cache';

// Missed-NOTIFY backstop, mirroring JobScopedSearchCache. Eviction is normally
// driven by the jobs_finished listener; this TTL only governs the janitor sweep
// that reclaims rows a job left behind when a replica missed the NOTIFY. Picked
// to comfortably outlive a single indexing batch while bounding the leak window.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_JANITOR_INTERVAL_MS = 30 * 60 * 1000;

// Eviction + janitor surface for the job-scoped per-instance wire-format cache.
//
// Unlike JobScopedSearchCache this class deliberately has no getOrPopulate: the
// reads and writes happen inside `RealmIndexQueryEngine.loadLinks`
// (runtime-common), where the assembled resource is produced and consumed. The
// table is the shared contract — runtime-common populates it, this class owns
// its lifecycle on the realm-server side (NOTIFY-driven eviction via
// JobsFinishedListener + an age-based janitor backstop), exactly like the
// search cache. Keyed by the `<jobId>.<reservationId>` job identity so a job
// that re-runs under a new reservation never reuses a prior run's entries.
export class JobScopedInstanceCache {
  readonly #dbAdapter: DBAdapter;
  readonly #ttlMs: number;
  readonly #janitorIntervalMs: number;
  #janitorTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    dbAdapter: DBAdapter,
    opts?: { ttlMs?: number; janitorIntervalMs?: number },
  ) {
    this.#dbAdapter = dbAdapter;
    this.#ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.#janitorIntervalMs =
      opts?.janitorIntervalMs ?? DEFAULT_JANITOR_INTERVAL_MS;
  }

  // Distinct `<jobId>.<reservationId>` keys currently holding entries. The
  // JobsFinishedListener parses these to learn which jobs to check for
  // finalization.
  async jobIds(): Promise<string[]> {
    let rows = (await query(this.#dbAdapter, [
      `SELECT DISTINCT job_id FROM ${TABLE}`,
    ] as Expression)) as { job_id: string }[];
    return rows.map((row) => row.job_id);
  }

  // Drop every entry for a given job identity. Driven by the jobs_finished
  // NOTIFY listener so the cache releases rows as soon as the worker signals
  // completion, rather than waiting on the janitor.
  async clearJob(jobId: string): Promise<void> {
    await query(this.#dbAdapter, [
      `DELETE FROM ${TABLE} WHERE job_id=`,
      param(jobId),
    ] as Expression);
  }

  async size(): Promise<number> {
    let rows = (await query(this.#dbAdapter, [
      `SELECT COUNT(*)::int AS count FROM ${TABLE}`,
    ] as Expression)) as { count: number }[];
    return rows[0]?.count ?? 0;
  }

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
  // replica missed its jobs_finished NOTIFY. Best-effort.
  async sweepExpired(): Promise<void> {
    try {
      await query(this.#dbAdapter, [
        `DELETE FROM ${TABLE} WHERE created_at < NOW() - (`,
        param(this.#ttlMs),
        ` * INTERVAL '1 millisecond')`,
      ] as Expression);
    } catch (err: unknown) {
      log.warn(
        `job-scoped instance cache janitor sweep failed: ${String(err)}`,
      );
    }
  }
}
