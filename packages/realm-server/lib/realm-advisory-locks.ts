import { createHash } from 'crypto';
import {
  logger,
  param,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';

const log = logger('realm-server:advisory-locks');

// Hash a realm URL to a stable signed int64 (as a string, because JS numbers
// can't represent the full int64 range). Used as a pg advisory lock key:
// two writers for the same realm URL hash to the same key and serialize;
// writers for different URLs use different keys and run in parallel.
//
// sha256 is overkill crypto-wise but the cost is negligible, and it gives
// excellent collision resistance at the 10,000+ realm scale the project
// plans for. Returning a string (rather than BigInt) keeps the value
// parameter-compatible with our existing `query` / `param` helpers, which
// don't accept BigInt directly.
export function hashRealmUrlForAdvisoryLock(url: string): string {
  const digest = createHash('sha256').update(url).digest();
  return digest.readBigInt64BE(0).toString();
}

// Run `fn` while holding a per-realm transaction-scoped Postgres advisory
// lock. The lock is taken with `pg_advisory_xact_lock` inside an explicit
// BEGIN / COMMIT on a pinned pool connection (via PgAdapter.withConnection),
// so the lock is automatically released by the transaction's commit or
// rollback — there is no "unlock failed → stale lock on pooled connection"
// failure mode that a session-scoped `pg_advisory_lock` + `pg_advisory_unlock`
// pattern would expose.
//
// Concurrent callers for the same realm URL serialize (the second call
// blocks on the xact-lock until the first's transaction commits/rolls
// back). Callers for different URLs run in parallel — the hash key space
// ensures that.
//
// Reads are NOT gated by this lock; reads hit the DB directly (or go
// through in-memory caches on the realm-server) without acquiring it.
// Read-heavy paths should never call this helper.
//
// Note on the enclosing transaction: `fn` runs inside BEGIN/COMMIT here so
// the advisory lock is correctly scoped, AND so any DELETEs `fn` runs via
// the pinned `txQuerier` argument share that transaction's atomicity. CS-10898
// (this PR) plumbed the pinned querier through the realm-destruction helpers
// (`removeRealmDatabaseArtifacts`, `removeRealmPermissions`,
// `deleteRegistryRowByUrl`, `deletePublishedRowsBySourceUrl`,
// `cancelRunningJobsInConcurrencyGroup`); when callers pass `txQuerier` to
// those helpers, all their writes commit or roll back together with the
// advisory lock's own transaction. Queries `fn` issues through the shared
// `dbAdapter` still go via separate pool connections and are NOT part of
// this transaction — that's the pre-CS-10898 behavior preserved as the
// default for callers that don't opt in.
//
// In the SQLite branch (test environments only) `txQuerier` is `undefined`,
// so helpers fall back to the shared `dbAdapter`. SQLite has no cross-
// connection concurrency, so neither the lock nor the tx semantics matter
// there.
//
// Pool-exhaustion caveat: when the callback opts into the pinned querier
// for all of its DB work, only one client is checked out for the entire
// critical section — both the lock and the destruction queries share that
// connection. If the callback also issues queries through the shared
// `dbAdapter` (e.g. existence-check SELECTs that don't need to be inside
// the tx), each of those checks out an additional pool client briefly.
// Under N concurrent same-URL writers, N-1 block on the advisory lock
// before doing anything — so this helper does not itself amplify pool
// pressure. Under N concurrent different-URL writers, each pins one
// client; if the pool ceiling is less than realistic write concurrency,
// callbacks that need additional pool clients could deadlock waiting on
// the pool. For current scope (low realistic write concurrency, pool size
// >= concurrent writers + headroom) this is acceptable.
//
// Deadlock note: callers should never acquire a second write lock for a
// different URL while holding one — that's the only way a cycle could
// form. Mutation handlers lock exactly one URL each, so no cycles.
export async function withRealmWriteLock<T>(
  dbAdapter: DBAdapter,
  realmUrl: string,
  fn: (txQuerier: Querier | undefined) => Promise<T>,
): Promise<T> {
  // Advisory locks are Postgres-specific. In test environments backed by
  // SQLite (no cross-connection concurrency to worry about anyway) we
  // short-circuit and run fn directly. The PgAdapter branch is the one
  // that does real work.
  if (dbAdapter.kind !== 'pg') {
    return await fn(undefined);
  }
  const pg = dbAdapter as unknown as PgAdapter;
  const lockKey = hashRealmUrlForAdvisoryLock(realmUrl);
  return await pg.withConnection(async (queryFn) => {
    await queryFn(['BEGIN']);
    try {
      await queryFn([
        `SELECT pg_advisory_xact_lock(`,
        param(lockKey),
        `::bigint)`,
      ]);
      const result = await fn(queryFn);
      await queryFn(['COMMIT']);
      return result;
    } catch (err: unknown) {
      try {
        await queryFn(['ROLLBACK']);
      } catch (rollbackErr: unknown) {
        // Rollback failed — the xact-lock is still released when the
        // connection's transaction is aborted (pg will auto-rollback on
        // client release), so we don't have a stale-lock problem. Log for
        // visibility and rethrow the original error.
        log.warn(
          `ROLLBACK after withRealmWriteLock error for ${realmUrl} failed: ${String(rollbackErr)}`,
        );
      }
      throw err;
    }
  });
}
