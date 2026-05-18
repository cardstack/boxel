import {
  normalizeQueryForSignature,
  sortKeysDeep,
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

// Hard cap on total entries across all jobs. When the cap is reached
// the FIFO-oldest entry is evicted to make room. Cap exists to bound
// worst-case memory: the `jobId` header is sanitized to a digits-only
// shape but the cache otherwise accepts any well-formed
// `(jobId, query, opts)` tuple from an authenticated caller, so a
// reader who mints synthetic jobIds and varied queries could otherwise
// grow the cache without bound for the full TTL window. Picked to
// comfortably accommodate the busiest realistic workload (a from-
// scratch reindex of a piranha-class realm fires hundreds of distinct
// queries within one job) while keeping worst-case footprint bounded
// to ~tens of MB.
const DEFAULT_MAX_ENTRIES = 5000;

type CachedEntry = {
  // Result is stored opaquely so both `_federated-search`'s
  // `LinkableCollectionDocument` and `_federated-search-prerendered`'s
  // `PrerenderedCardCollectionDocument` can share the same cache
  // instance. Inner-key canonicalisation already includes the
  // endpoint-distinguishing params (htmlFormat / cardUrls / renderType
  // are passed through `opts`), so two endpoints' entries cannot
  // collide on a key they don't both fully share.
  result: unknown;
  timer: ReturnType<typeof setTimeout>;
  // Position in the FIFO eviction ring. Stored on the entry so a
  // cache hit doesn't need a separate map lookup to know its slot.
  fifoSeq: number;
};

// Per-batch read cache used during indexing. Each entry is keyed by
// `(jobId, normalizedRealms, normalizedQuery, normalizedOpts)` and
// represents one search populate computed during the lifetime of one
// indexing job. The cache is shared across both `_federated-search`
// (`LinkableCollectionDocument` results) and
// `_federated-search-prerendered` (`PrerenderedCardCollectionDocument`
// results) — the endpoint-specific request shape (`htmlFormat`,
// `cardUrls`, `renderType` for the prerendered handler) is folded into
// `opts` before the call here, so the canonicalised inner key already
// segregates the two endpoints' entries. The job-id boundary scopes
// the cache to a single batch; a subsequent job hashes to different
// keys and never reuses a stale value.
//
// Same-realm reads are safe by construction: within an indexing batch
// the writer touches `boxel_index_working`, not `boxel_index`, so
// every read of the consuming realm's `boxel_index` returns identical
// bytes until the batch's `applyBatchUpdates` swap fires (at which
// point `Realm.update`'s onInvalidation tears down the cache via
// `clearInFlightSearch`, Phase 1's path — unchanged here).
//
// Cross-realm reads accept a different staleness contract: within one
// jobId, results are pinned to the *first* observation regardless of
// whether a peer realm has swapped since. The rationale is "one
// consolidated view of the realm-server's state per batch" — repeated
// reads of the same broad cross-realm query during one batch are
// strictly better when they all see the same snapshot than when they
// each chase whatever a peer realm has just published. The bound is
// the job's lifetime; a subsequent job re-observes.
//
// The handler gates entry into this cache on two conditions:
// `x-boxel-job-id` present and well-formed, and
// `x-boxel-consuming-realm` present and well-formed. Both headers are
// only stamped by indexer-driven prerender requests, so user-facing
// API callers always bypass and see live state.
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
  // FIFO ring keyed by an ever-incrementing sequence so eviction
  // ordering survives the (jobId, innerKey) name space. The oldest
  // surviving sequence number is `#evictionCursor`; advances as the
  // entry it points at is evicted (either via cap or its own TTL).
  #fifo = new Map<number, { jobId: string; innerKey: string }>();
  #nextFifoSeq = 0;
  readonly #ttlMs: number;
  readonly #maxEntries: number;

  constructor(opts?: { ttlMs?: number; maxEntries?: number }) {
    this.#ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  async getOrPopulate<T>(args: {
    jobId: string;
    realms: string[];
    query: Query;
    opts: unknown | undefined;
    populate: () => Promise<T>;
  }): Promise<T> {
    let innerKey = buildInnerKey(args.realms, args.query, args.opts);
    let jobMap = this.#byJob.get(args.jobId);
    let existing = jobMap?.get(innerKey);
    if (existing) {
      return existing.result as T;
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
      this.#fifo.delete(prior.fifoSeq);
    }
    let fifoSeq = this.#nextFifoSeq++;
    let timer = setTimeout(() => {
      this.#evictByKey(args.jobId, innerKey, timer);
    }, this.#ttlMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    currentJobMap.set(innerKey, { result, timer, fifoSeq });
    this.#fifo.set(fifoSeq, { jobId: args.jobId, innerKey });

    // Cap enforcement: evict FIFO-oldest until under the limit. Map
    // preserves insertion order, so the first key is the oldest. We
    // skip-over any keys whose entries are already gone (TTL fired)
    // without rewriting the ring.
    while (this.#fifo.size > this.#maxEntries) {
      let oldestSeq = this.#fifo.keys().next().value;
      if (oldestSeq === undefined) break;
      let slot = this.#fifo.get(oldestSeq)!;
      this.#fifo.delete(oldestSeq);
      let jm = this.#byJob.get(slot.jobId);
      let entry = jm?.get(slot.innerKey);
      if (entry?.fifoSeq === oldestSeq) {
        clearTimeout(entry.timer);
        jm!.delete(slot.innerKey);
        if (jm!.size === 0) {
          this.#byJob.delete(slot.jobId);
        }
      }
    }

    return result;
  }

  #evictByKey(
    jobId: string,
    innerKey: string,
    expectedTimer: ReturnType<typeof setTimeout>,
  ): void {
    let jm = this.#byJob.get(jobId);
    if (!jm) return;
    let entry = jm.get(innerKey);
    if (entry?.timer === expectedTimer) {
      this.#fifo.delete(entry.fifoSeq);
      jm.delete(innerKey);
      if (jm.size === 0) {
        this.#byJob.delete(jobId);
      }
    }
  }

  // Drop every entry for a given job. Wired in by the NOTIFY-driven
  // eviction path so the cache releases memory as soon as the worker
  // signals job completion, rather than waiting on TTL.
  clearJob(jobId: string): void {
    let jobMap = this.#byJob.get(jobId);
    if (!jobMap) return;
    for (let entry of jobMap.values()) {
      clearTimeout(entry.timer);
      this.#fifo.delete(entry.fifoSeq);
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
// regardless of how the call site formats the jobId. The realms array
// is included verbatim (no sort, no dedupe): `_federated-search`
// preserves input order in its `data` array and first-occurrence
// `included`, so `[A, B]` and `[B, A]` are *different* responses and
// must hash to different cache entries. A duplicated realm entry
// likewise contributes duplicate per-realm searches at the handler
// layer — preserve that observable shape too rather than silently
// canonicalising it here.
function buildInnerKey(
  realms: string[],
  query: Query,
  opts: unknown | undefined,
): string {
  return JSON.stringify([
    realms,
    normalizeQueryForSignature(query),
    opts ? sortKeysDeep(opts) : null,
  ]);
}
