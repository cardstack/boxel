import {
  logger,
  query,
  param,
  separatedByCommas,
} from '@cardstack/runtime-common';
import type { Expression } from '@cardstack/runtime-common';
import type { PgAdapter, NotificationSubscription } from '@cardstack/postgres';

import type { JobScopedSearchCache } from '../job-scoped-search-cache';

const log = logger('realm-server:jobs-finished-listener');

// NOTIFY-driven eviction for the JobScopedSearchCache.
//
// `pg-queue` emits `NOTIFY jobs_finished` (no payload) whenever a job's
// finalize transaction commits. Absent this listener the cache releases a
// finished job's entries only when the janitor sweeps them past the TTL.
// Wiring the LISTEN side here drops a job's entries as soon as the worker
// signals completion instead of waiting for that sweep.
//
// Best-effort, like the other realm-server NOTIFY listeners: a missed
// notification just leaves entries for the janitor to reclaim (a bounded
// window, never a correctness issue — a re-run of a job hashes to a different
// cache key because the key embeds `<jobId>.<reservationId>`).
//
// The NOTIFY has no payload, so on each notification we sweep: take the
// `<jobId>.<reservationId>` keys the cache currently holds, ask `jobs` which
// of those job ids have finalized (status resolved | rejected), and clear the
// matching entries. This queries only the jobs we actually hold entries for,
// rather than scanning by a recency window.
const JOBS_FINISHED_CHANNEL = 'jobs_finished';

type SearchCacheView = Pick<JobScopedSearchCache, 'jobIds' | 'clearJob'>;

export interface JobsFinishedListenerDeps {
  dbAdapter: PgAdapter;
  searchCache: SearchCacheView;
  // The per-instance wire-format cache (job_scoped_instance_cache). Swept on
  // the same notification as the search cache — both are job-scoped and keyed
  // by the same `<jobId>.<reservationId>` identity. Optional so deployments
  // without the per-instance cache wired keep working unchanged.
  instanceCache?: SearchCacheView;
  // Test seam: given the job ids the caches currently hold entries for, return
  // the subset that have finalized. Defaults to a query against `jobs`.
  fetchFinalizedJobIds?: (candidateJobIds: number[]) => Promise<Set<number>>;
}

export class JobsFinishedListener {
  #deps: JobsFinishedListenerDeps;
  #fetchFinalizedJobIds: (candidateJobIds: number[]) => Promise<Set<number>>;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;
  // Single-flight guard: `jobs_finished` fires once per job completion, so a
  // burst of completions would otherwise launch overlapping sweeps (and DB
  // queries). Collapse the burst — run one sweep at a time, and if more
  // notifications land mid-sweep, re-run exactly once afterward.
  #sweeping = false;
  #sweepQueued = false;

  constructor(deps: JobsFinishedListenerDeps) {
    this.#deps = deps;
    this.#fetchFinalizedJobIds =
      deps.fetchFinalizedJobIds ??
      ((ids) => fetchFinalizedJobIdsFromDb(deps.dbAdapter, ids));
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        JOBS_FINISHED_CHANNEL,
        () => {
          // The notification carries no payload — sweep the cache against the
          // jobs table. Fire-and-forget: failures are logged, never thrown.
          void this.handleNotification();
        },
      );
    })();
    try {
      await this.#starting;
    } finally {
      this.#starting = undefined;
    }
  }

  async shutDown(): Promise<void> {
    // Mirror the sibling listeners: wait for any in-flight start() to finish
    // wiring #subscription before tearing down, so a racing start() can't
    // install a live subscription after we thought we were shut down. Swallow
    // start() errors — if startup failed there's nothing to unsubscribe.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
  }

  // Exposed for tests; also invoked internally by the LISTEN handler. Resolves
  // when the work prompted by this notification has settled. Coalesces
  // concurrent calls: if a sweep is already running, just mark that another
  // pass is needed and let the in-flight sweep re-run once when it finishes.
  async handleNotification(): Promise<void> {
    if (this.#sweeping) {
      this.#sweepQueued = true;
      return;
    }
    this.#sweeping = true;
    try {
      do {
        this.#sweepQueued = false;
        try {
          await this.#sweep();
        } catch (err: unknown) {
          log.warn(`jobs_finished sweep failed: ${String(err)}`);
        }
      } while (this.#sweepQueued);
    } finally {
      this.#sweeping = false;
    }
  }

  async #sweep(): Promise<void> {
    // Union the keys held by both job-scoped caches; a key may live in only
    // one of them, and a finalized job should be cleared from both.
    let searchKeys = await this.#deps.searchCache.jobIds();
    let instanceKeys = this.#deps.instanceCache
      ? await this.#deps.instanceCache.jobIds()
      : [];
    let keys = [...new Set([...searchKeys, ...instanceKeys])];
    if (keys.length === 0) {
      return;
    }
    // Cache keys are `<jobId>.<reservationId>`; group by the numeric jobId so
    // a single job's finalize clears every reservation's entries.
    let keysByJobId = new Map<number, string[]>();
    for (let key of keys) {
      let jobId = Number(key.split('.')[0]);
      if (!Number.isSafeInteger(jobId)) {
        continue;
      }
      let group = keysByJobId.get(jobId);
      if (!group) {
        group = [];
        keysByJobId.set(jobId, group);
      }
      group.push(key);
    }
    if (keysByJobId.size === 0) {
      return;
    }
    let finalized = await this.#fetchFinalizedJobIds([...keysByJobId.keys()]);
    for (let jobId of finalized) {
      for (let key of keysByJobId.get(jobId) ?? []) {
        // clearJob on a cache that doesn't hold the key is a no-op DELETE.
        await this.#deps.searchCache.clearJob(key);
        await this.#deps.instanceCache?.clearJob(key);
      }
    }
  }
}

async function fetchFinalizedJobIdsFromDb(
  dbAdapter: PgAdapter,
  candidateJobIds: number[],
): Promise<Set<number>> {
  if (candidateJobIds.length === 0) {
    return new Set();
  }
  let rows = (await query(dbAdapter, [
    `SELECT id FROM jobs WHERE status IN ('resolved', 'rejected') AND id IN (`,
    ...separatedByCommas(candidateJobIds.map((id) => [param(id)])),
    `)`,
  ] as Expression)) as { id: number | string }[];
  return new Set(rows.map((row) => Number(row.id)));
}
