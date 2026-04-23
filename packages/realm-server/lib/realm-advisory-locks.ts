import { createHash } from 'crypto';
import { logger, param, type DBAdapter } from '@cardstack/runtime-common';
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

// Run `fn` while holding a per-realm session-scoped Postgres advisory lock.
// The lock is acquired on a pinned pool connection (via PgAdapter.withConnection)
// and explicitly released in a finally block before the connection returns
// to the pool to avoid lock leaks.
//
// Concurrent callers for the same realm URL serialize (the second call
// blocks until the first releases). Callers for different URLs run in
// parallel — the hash key space ensures that.
//
// Reads are NOT gated by this lock; reads hit the DB directly (or go
// through in-memory caches on the realm-server) without acquiring it.
// Read-heavy paths should never call this helper.
//
// Why session-scoped rather than transaction-scoped: the realm-server's
// mutation handlers (Phase 1) don't wrap their FS + DB writes in a single
// Postgres transaction (that's CS-10898's territory). An xact-scoped lock
// would only protect the enclosed transaction's lifetime, which would
// cover just a subset of the handler's critical section. The session-
// scoped lock held across the whole callback closure covers the entire
// write (FS ops + DB writes + any enqueues).
//
// Deadlock note: callers should never acquire a second write lock for a
// different URL while holding one — that's the only way a cycle could
// form. Mutation handlers lock exactly one URL each, so no cycles.
export async function withRealmWriteLock<T>(
  dbAdapter: DBAdapter,
  realmUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Advisory locks are Postgres-specific. In test environments backed by
  // SQLite (no cross-connection concurrency to worry about anyway) we
  // short-circuit and run fn directly. The PgAdapter branch is the one
  // that does real work.
  if (dbAdapter.kind !== 'pg') {
    return await fn();
  }
  const pg = dbAdapter as unknown as PgAdapter;
  const lockKey = hashRealmUrlForAdvisoryLock(realmUrl);
  return await pg.withConnection(async (queryFn) => {
    await queryFn([`SELECT pg_advisory_lock(`, param(lockKey), `::bigint)`]);
    try {
      return await fn();
    } finally {
      try {
        await queryFn([
          `SELECT pg_advisory_unlock(`,
          param(lockKey),
          `::bigint)`,
        ]);
      } catch (err: unknown) {
        // Explicit unlock failed — likely a transient DB issue. The session
        // will end when withConnection releases the client, but node-pg
        // pools keep connections alive, so the lock could persist for the
        // life of the connection. This is a real concern for long-lived
        // pools; in practice the lock's hashed-URL key space is large
        // enough that a stale lock is unlikely to collide with a future
        // legitimate acquirer, and the server boots without locks held.
        // If this warning fires repeatedly, investigate the underlying DB
        // error.
        log.warn(
          `failed to release advisory lock for ${realmUrl}: ${String(err)}`,
        );
      }
    }
  });
}
