import { Sha256 } from '@aws-crypto/sha256-js';
import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  asExpressions,
  param,
  query,
  separatedByCommas,
  upsert,
  type Expression,
} from './expression.ts';
import { uint8ArrayToHex } from './index.ts';

// The MediaCache: a content-addressed store for derived media (screenshots),
// split across two channels that this module keeps consistent:
//
//   * objects — the output bytes, held in a `MediaCacheAdapter` (S3 in
//     deployment, local disk in dev/tests) under a key that is the hash of
//     the bytes themselves, so identical output is stored exactly once;
//   * the ledger — one `media_cache_ledger` row per capture (source
//     instance × canonical capture spec × generation) pointing at its
//     object. The ledger is the store's only catalog: GC reclaims objects by
//     scanning ledger rows, never by enumerating the bucket, so every object
//     write is paired with a ledger write here.
//
// This module is browser-safe: it holds the adapter interface, the key
// derivation, the put/touch orchestration, and the GC sweep's read side. The
// adapters themselves are node-only and live in the realm-server package.

// What an adapter knows about a stored object. Content type is recorded here
// for bucket-browsing convenience only — the ledger's `content_type` column
// is the serving-path source of truth (the local-disk adapter stores no
// metadata at all and never reports one).
export interface MediaObjectStat {
  size: number;
  contentType?: string;
}

// One backing store for MediaCache objects. Implementations must be safe to
// call with keys they have never seen: `head`/`getStream` report absence with
// `undefined`, and `delete` of a missing key is a successful no-op (the GC
// sweep re-deletes keys whose ledger rows survived a crashed sweep).
//
// `put` must leave the object durable before resolving, and may skip the
// upload when the key is already stored — the key is a hash of the bytes, so
// an existing object under the same key already holds them (dedupe-on-write).
export interface MediaCacheAdapter {
  put(
    key: string,
    bytes: Uint8Array,
    opts: { contentType: string },
  ): Promise<void>;
  head(key: string): Promise<MediaObjectStat | undefined>;
  getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined>;
  delete(key: string): Promise<void>;
}

// GC policy differs by how a capture came to exist. A 'declared' capture
// (an indexing-time declared screenshot) lives until a newer generation
// supersedes it or its source is deleted; an 'on-demand' capture (URL DSL /
// POST) additionally ages out when unused, since nothing re-creates demand
// for it except another request.
export type MediaCacheLane = 'declared' | 'on-demand';

// The identity of one ledger row: one capture of one source instance under
// one canonical spec at one generation.
export interface MediaCacheEntryKey {
  realmURL: string;
  sourceURL: string;
  captureSpecHash: string;
  sourceGeneration: number;
}

export interface MediaCacheEntry extends MediaCacheEntryKey {
  objectKey: string;
  sourceContentHash: string | null;
  lane: MediaCacheLane;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
  lastAccessedAt: number;
}

// The content address for a blob of output bytes. sha256 rather than the
// realm-file `computeContentHash`: that one samples large content (head +
// tail) to bound synchronous main-thread cost, which is the wrong trade for
// a true content address — a false key match here would serve one capture's
// bytes under another's identity forever.
export async function computeMediaCacheKey(bytes: Uint8Array): Promise<string> {
  let hash = new Sha256();
  hash.update(bytes);
  return uint8ArrayToHex(await hash.digest());
}

// Stores one capture: derives the content address, makes the object durable,
// then records the ledger row. Object-before-ledger so a ledger row never
// points at bytes that aren't durable; a crash between the two leaves an
// unreferenced object that the capture's own retry re-references (same
// bytes → same key). The ledger write is an upsert on the capture identity:
// a re-capture that produced different bytes repoints the row at the new
// object, and the old object is reclaimed by the GC sweep once nothing else
// references it.
export async function putMedia(
  dbAdapter: DBAdapter,
  adapter: MediaCacheAdapter,
  {
    bytes,
    contentType,
    realmURL,
    sourceURL,
    captureSpecHash,
    sourceGeneration,
    sourceContentHash = null,
    lane,
  }: MediaCacheEntryKey & {
    bytes: Uint8Array;
    contentType: string;
    lane: MediaCacheLane;
    sourceContentHash?: string | null;
  },
): Promise<{ objectKey: string; sizeBytes: number }> {
  let objectKey = await computeMediaCacheKey(bytes);
  await adapter.put(objectKey, bytes, { contentType });
  let now = Date.now();
  let { nameExpressions, valueExpressions } = asExpressions({
    realm_url: realmURL,
    source_url: sourceURL,
    capture_spec_hash: captureSpecHash,
    source_generation: sourceGeneration,
    object_key: objectKey,
    source_content_hash: sourceContentHash,
    lane,
    content_type: contentType,
    size_bytes: bytes.length,
    created_at: now,
    last_accessed_at: now,
  });
  await query(
    dbAdapter,
    upsert(
      'media_cache_ledger',
      'media_cache_ledger_pkey',
      nameExpressions,
      valueExpressions,
    ),
  );
  return { objectKey, sizeBytes: bytes.length };
}

// Serving-path bump for the on-demand age-out lane: reading a capture resets
// its idle clock. Coarse is fine — the lane's TTL is measured in days, so
// callers may throttle their bumps.
export async function touchMediaCacheEntry(
  dbAdapter: DBAdapter,
  entryKey: MediaCacheEntryKey,
  now = Date.now(),
): Promise<void> {
  await query(dbAdapter, [
    `UPDATE media_cache_ledger SET last_accessed_at =`,
    param(now),
    `WHERE realm_url =`,
    param(entryKey.realmURL),
    `AND source_url =`,
    param(entryKey.sourceURL),
    `AND capture_spec_hash =`,
    param(entryKey.captureSpecHash),
    `AND source_generation =`,
    param(entryKey.sourceGeneration),
  ] as Expression);
}

// ---------------------------------------------------------------------------
// GC sweep read side — mirrors `prerender-html-reconcile.ts`: pure queries
// plus a pure planning step; the enqueue/delete orchestration lives in the
// `media-cache-gc` task. A healthy, fully-live ledger yields no candidates.
// ---------------------------------------------------------------------------

// No row younger than this is ever collected, whatever lane it is in: the
// delay is what keeps the sweep from racing an in-flight capture or serve
// (a row is written moments after its object; a serve streams moments after
// its ledger read).
export const MEDIA_CACHE_GC_MIN_AGE_MS = 24 * 60 * 60 * 1000;
// The on-demand lane's idle TTL: a DSL/POST capture nobody has requested for
// this long is reclaimed. Anything needing a longer-lived artifact should be
// a declared screenshot, which never ages out.
export const MEDIA_CACHE_ON_DEMAND_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MediaCacheGcReason = 'tombstoned' | 'superseded' | 'expired';

export interface MediaCacheGcCandidate extends MediaCacheEntryKey {
  objectKey: string;
  reason: MediaCacheGcReason;
}

// Ledger rows the sweep may reclaim, oldest reasons first:
//   - 'tombstoned': the source instance is deleted (its `boxel_index` row is
//     a tombstone) — the capture inherits the deletion.
//   - 'superseded': a newer-generation row exists for the same capture
//     identity, and has for at least the min-age (so a serve that resolved
//     the old row just before the swap can still finish streaming).
//   - 'expired': an on-demand capture idle past the TTL.
// Every arm additionally requires the row itself to be older than min-age.
// The jsonb-free SQL here is still Postgres-shaped (row-value EXISTS,
// bigint arithmetic); like the reconcile scans, the GC task runs solely
// behind the Postgres queue.
export async function findMediaCacheGcCandidates(
  dbAdapter: DBAdapter,
  {
    now = Date.now(),
    minAgeMs = MEDIA_CACHE_GC_MIN_AGE_MS,
    onDemandTtlMs = MEDIA_CACHE_ON_DEMAND_TTL_MS,
  }: { now?: number; minAgeMs?: number; onDemandTtlMs?: number } = {},
): Promise<MediaCacheGcCandidate[]> {
  let minAgeCutoff = now - minAgeMs;
  let idleCutoff = now - onDemandTtlMs;
  let rows = (await query(dbAdapter, [
    `SELECT realm_url, source_url, capture_spec_hash, source_generation, object_key,
       CASE
         WHEN EXISTS (
           SELECT 1 FROM boxel_index i
           WHERE i.url = r.source_url AND i.realm_url = r.realm_url
             AND i.type = 'instance' AND i.is_deleted IS TRUE
         ) THEN 'tombstoned'
         WHEN EXISTS (
           SELECT 1 FROM media_cache_ledger n
           WHERE n.realm_url = r.realm_url AND n.source_url = r.source_url
             AND n.capture_spec_hash = r.capture_spec_hash
             AND n.source_generation > r.source_generation
             AND n.created_at <`,
    param(minAgeCutoff),
    `) THEN 'superseded'
         ELSE 'expired'
       END AS reason
     FROM media_cache_ledger r
     WHERE r.created_at <`,
    param(minAgeCutoff),
    `AND (
       EXISTS (
         SELECT 1 FROM boxel_index i
         WHERE i.url = r.source_url AND i.realm_url = r.realm_url
           AND i.type = 'instance' AND i.is_deleted IS TRUE
       )
       OR EXISTS (
         SELECT 1 FROM media_cache_ledger n
         WHERE n.realm_url = r.realm_url AND n.source_url = r.source_url
           AND n.capture_spec_hash = r.capture_spec_hash
           AND n.source_generation > r.source_generation
           AND n.created_at <`,
    param(minAgeCutoff),
    `)
       OR (r.lane = 'on-demand' AND r.last_accessed_at <`,
    param(idleCutoff),
    `))`,
  ] as Expression)) as {
    realm_url: string;
    source_url: string;
    capture_spec_hash: string;
    source_generation: number | string;
    object_key: string;
    reason: MediaCacheGcReason;
  }[];
  return rows.map((row) => ({
    realmURL: row.realm_url,
    sourceURL: row.source_url,
    captureSpecHash: row.capture_spec_hash,
    sourceGeneration: Number(row.source_generation),
    objectKey: row.object_key,
    reason: row.reason,
  }));
}

// Total ledger reference counts for the given object keys — candidates and
// survivors alike — so the planner can tell which objects the sweep's row
// deletions would orphan.
export async function findMediaCacheKeyReferenceCounts(
  dbAdapter: DBAdapter,
  objectKeys: string[],
): Promise<Map<string, number>> {
  let counts = new Map<string, number>();
  if (objectKeys.length === 0) {
    return counts;
  }
  let rows = (await query(dbAdapter, [
    `SELECT object_key, COUNT(*) AS refs FROM media_cache_ledger WHERE object_key IN`,
    ...addExplicitParens(
      separatedByCommas([...new Set(objectKeys)].map((key) => [param(key)])),
    ),
    `GROUP BY object_key`,
  ] as Expression)) as { object_key: string; refs: number | string }[];
  for (let row of rows) {
    counts.set(row.object_key, Number(row.refs));
  }
  return counts;
}

export interface MediaCacheGcPlan {
  rows: MediaCacheGcCandidate[];
  // Object keys whose every ledger reference is in `rows` — deleting the
  // rows orphans the object, so the object goes too.
  objectKeys: string[];
}

// Pure reconciliation: an object is reclaimed only when this sweep's row
// deletions remove its last ledger reference; an object some surviving row
// still points at (dedupe across captures) keeps its bytes.
export function planMediaCacheGcDeletions(
  candidates: MediaCacheGcCandidate[],
  referenceCounts: Map<string, number>,
): MediaCacheGcPlan {
  let candidateRefs = new Map<string, number>();
  for (let candidate of candidates) {
    candidateRefs.set(
      candidate.objectKey,
      (candidateRefs.get(candidate.objectKey) ?? 0) + 1,
    );
  }
  let objectKeys: string[] = [];
  for (let [key, candidateCount] of candidateRefs) {
    if ((referenceCounts.get(key) ?? 0) <= candidateCount) {
      objectKeys.push(key);
    }
  }
  return { rows: candidates, objectKeys };
}

// Removes the given ledger rows by exact identity. Chunked so a large sweep
// never builds one unbounded statement.
const DELETE_ROWS_CHUNK_SIZE = 200;
export async function deleteMediaCacheRows(
  dbAdapter: DBAdapter,
  rows: MediaCacheEntryKey[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += DELETE_ROWS_CHUNK_SIZE) {
    let chunk = rows.slice(i, i + DELETE_ROWS_CHUNK_SIZE);
    await query(dbAdapter, [
      `DELETE FROM media_cache_ledger
       WHERE (realm_url, source_url, capture_spec_hash, source_generation) IN`,
      ...addExplicitParens(
        separatedByCommas(
          chunk.map((row) =>
            addExplicitParens(
              separatedByCommas([
                [param(row.realmURL)],
                [param(row.sourceURL)],
                [param(row.captureSpecHash)],
                [param(row.sourceGeneration)],
              ]),
            ),
          ),
        ),
      ),
    ] as Expression);
  }
}
