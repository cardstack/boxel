import type { PgPrimitive } from './index.ts';
import type { Querier } from './expression.ts';

export interface TypeCoercion {
  [column: string]: 'BOOLEAN' | 'JSON' | 'VARCHAR';
}

export interface ExecuteOptions {
  // SQLite has a very limited set of data types. we can coerce the resulting
  // types into values that match pg using this option
  bind?: PgPrimitive[];
  coerceTypes?: TypeCoercion;
}

export interface DBAdapter {
  kind: 'pg' | 'sqlite';
  isClosed: boolean;
  execute: (
    sql: string,
    opts?: ExecuteOptions,
  ) => Promise<Record<string, PgPrimitive>[]>;
  close: () => Promise<void>;
  getColumnNames: (tableName: string) => Promise<string[]>;
  // Best-effort cross-instance broadcast on a named channel. Backends that
  // don't support pub/sub (e.g. in-process SQLite) implement this as a no-op:
  // the caller must treat it as fire-and-forget cache-coherency, never as
  // delivery-guaranteed messaging.
  notify: (channel: string, payload: string) => Promise<void>;
  // Per-realm write-lock primitive. PgAdapter implements with
  // `pg_advisory_xact_lock(hash64(realmUrl))` on a pinned-connection
  // transaction so concurrent same-URL callers across replicas serialize;
  // different-URL callers run in parallel. SQLite has no cross-connection
  // concurrency to coordinate, so it's a passthrough (`txQuerier` is
  // undefined). See PgAdapter.withWriteLock for the full design notes
  // (re-entrancy, pool exhaustion, rollback semantics).
  withWriteLock: <T>(
    realmUrl: string,
    fn: (txQuerier: Querier | undefined) => Promise<T>,
  ) => Promise<T>;
  // Per-matrix-user cost-barrier primitive: serializes concurrent billable
  // upstream proxy calls for the same user across replicas so the next
  // request can't kick off another upstream call before the previous
  // request's cost row has landed in the credits ledger. PgAdapter
  // implements with `pg_advisory_xact_lock` on a namespaced hash of the
  // matrix user id; SQLite is a passthrough. See PgAdapter.withUserCostLock
  // for design notes (pool pressure, re-entrancy).
  withUserCostLock: <T>(
    matrixUserId: string,
    fn: () => Promise<T>,
  ) => Promise<T>;
}
