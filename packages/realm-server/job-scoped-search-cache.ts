import {
  normalizeQueryForSignature,
  sortKeysDeep,
  type LinkableCollectionDocument,
  type Query,
} from '@cardstack/runtime-common';

// Default entry TTL. Picked to comfortably outlive a single indexing
// batch (workers cap from-scratch jobs at 6 min, incremental jobs are
// shorter) while bounding the worst case where a job ends without a
// NOTIFY-driven eviction reaching this process — a leaked entry persists
// at most this long. Cross-job collision is impossible because the cache
// key includes `jobId`, so a stale leak only hurts memory, never
// correctness.
const DEFAULT_TTL_MS = 10 * 60 * 1000;

type CachedEntry = {
  result: LinkableCollectionDocument;
  timer: ReturnType<typeof setTimeout>;
};

// Same-realm read cache used during indexing. Each entry is keyed by
// `(jobId, normalizedQuery, normalizedOpts)` and represents one
// `_federated-search` populate computed during the lifetime of one
// indexing job. Safe because within an indexing batch the writer
// touches `boxel_index_working`, not `boxel_index` — so every read of
// the same realm's `boxel_index` returns identical bytes until the
// batch's `applyBatchUpdates` swap fires. The job-id boundary scopes
// the cache to a single batch; a subsequent job hashes to different
// keys and never reuses a stale value.
//
// The handler gates entry into this cache on three conditions all
// holding: `x-boxel-job-id` present, `x-boxel-consuming-realm` present,
// and the request's `realms` array is exactly `[consumingRealm]`.
// Cross-realm reads bypass the cache because peer realms can swap
// independently — a cached read against a foreign realm could freeze
// a stale snapshot. Anonymous (no jobId) reads also bypass: those
// callers are not inside the batch's snapshot-stable read window and
// must always see live state.
//
// Entries store the *resolved* doc, not the in-flight promise.
// Concurrent same-key callers each run their own `populate` (Phase 1's
// in-flight dedup at `RealmIndexQueryEngine.searchCards` already
// coalesces the heavy inner SQL+loadLinks walk for same-realm calls
// arriving concurrently). The first to finish stores its result here;
// later sequential callers within the same job see the cached doc and
// short-circuit before re-entering `searchRealms`.
//
// Storing promises was tempting (it would also dedupe at this layer)
// but creates a tail-latency stall: a slow first populate blocks every
// later same-key caller past their render-timeout window, even when
// they could otherwise have run their own search in parallel and made
// progress. Resolved-only avoids that failure mode and keeps the
// benefit of sequential dedup, which is the win this cache exists for.
export class JobScopedSearchCache {
  #byJob = new Map<string, Map<string, CachedEntry>>();
  readonly #ttlMs: number;

  constructor(opts?: { ttlMs?: number }) {
    this.#ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  async getOrPopulate(args: {
    jobId: string;
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<LinkableCollectionDocument>;
  }): Promise<LinkableCollectionDocument> {
    let innerKey = buildInnerKey(args.query, args.opts);
    let jobMap = this.#byJob.get(args.jobId);
    let existing = jobMap?.get(innerKey);
    if (existing) {
      return existing.result;
    }

    let result = await args.populate();

    // Late-arriving check: the populate may have just settled while a
    // peer's populate (same key) also settled and stored its result
    // first. Last-write-wins; either of the two resolved docs is
    // equally valid since they came from the same `(jobId, query)`
    // tuple against the same snapshot-stable boxel_index.
    let currentJobMap = this.#byJob.get(args.jobId);
    if (!currentJobMap) {
      currentJobMap = new Map();
      this.#byJob.set(args.jobId, currentJobMap);
    }
    let prior = currentJobMap.get(innerKey);
    if (prior) {
      clearTimeout(prior.timer);
    }
    let timer = setTimeout(() => {
      let jm = this.#byJob.get(args.jobId);
      if (!jm) return;
      let entry = jm.get(innerKey);
      if (entry?.timer === timer) {
        jm.delete(innerKey);
        if (jm.size === 0) {
          this.#byJob.delete(args.jobId);
        }
      }
    }, this.#ttlMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    currentJobMap.set(innerKey, { result, timer });
    return result;
  }

  // Drop every entry for a given job. Wired in by the NOTIFY-driven
  // eviction path so the cache releases memory as soon as the worker
  // signals job completion, rather than waiting on TTL.
  clearJob(jobId: string): void {
    let jobMap = this.#byJob.get(jobId);
    if (!jobMap) return;
    for (let entry of jobMap.values()) {
      clearTimeout(entry.timer);
    }
    this.#byJob.delete(jobId);
  }

  // Total entry count across all jobs. Useful for tests + observability.
  size(): number {
    let total = 0;
    for (let jm of this.#byJob.values()) {
      total += jm.size;
    }
    return total;
  }

  jobIds(): string[] {
    return [...this.#byJob.keys()];
  }
}

// Compose the per-job inner key. Excludes jobId since the outer Map is
// already partitioned by jobId — this keeps inner-key length bounded
// regardless of how the call site formats the jobId. Excludes the
// realms array (the cache gate already enforces same-realm-only), so
// two requests with `realms: [R]` produce the same inner key
// regardless of array identity.
function buildInnerKey(query: Query, opts: unknown | undefined): string {
  return JSON.stringify([
    normalizeQueryForSignature(query),
    opts ? sortKeysDeep(opts) : null,
  ]);
}
