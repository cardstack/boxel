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
  // The bindings carry a secret, so the adapter's statement and error logs
  // print a placeholder in their place, and an error it throws drops the
  // detail in which Postgres quotes the offending row or value.
  redactBindings?: boolean;
  // Cancels the statement when it aborts: Postgres is asked to cancel the
  // backend running it (`pg_cancel_backend`), and the call rejects with the
  // signal's reason. A signal already aborted runs nothing. SQLite ignores it.
  signal?: AbortSignal;
  // Set by the adapter a read snapshot hands out (see `withReadSnapshot`):
  // the statement runs on that snapshot's connection. The snapshot's adapter
  // sends each statement through `execute` with it, so a wrapper of
  // `execute` sees every statement a snapshot runs; a wrapper passes the
  // options on as it got them. Opaque: nothing else sets it.
  readSnapshot?: object;
}

// The bindings as an adapter's statement and error logs print them.
export function loggableBindings(opts?: ExecuteOptions): string {
  return opts?.redactBindings ? '[redacted]' : JSON.stringify(opts?.bind);
}

export interface TransactionOptions {
  // Names the transaction in the log line a retry writes, e.g. the realm whose
  // index swap is committing.
  label?: string;
  // How many times to run `fn` before giving up on a deadlock or
  // serialization failure. Defaults to 3.
  maxAttempts?: number;
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
  // Run `fn` inside one transaction: every statement `fn` issues through
  // `txQuerier` commits together, or none do if `fn` throws. Statements `fn`
  // issues through the adapter itself are not part of the transaction.
  //
  // PgAdapter pins one pool connection for the whole transaction. A deadlock
  // or serialization failure (SQLSTATE 40P01 / 40001) rolls back and runs `fn`
  // again from the start, so `fn` must be safe to re-run and must keep no
  // effects outside the database that a rollback would leave behind. SQLite
  // runs the transaction on its single connection and never retries.
  withTransaction: <T>(
    fn: (txQuerier: Querier) => Promise<T>,
    opts?: TransactionOptions,
  ) => Promise<T>;
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
  // Per-file write-lock primitive, for a writer whose exclusivity is over the
  // files it reads and rewrites rather than over the realm. PgAdapter
  // implements it as one `pg_advisory_xact_lock` per file, taken in key order
  // on a pinned-connection transaction, so writers of one card serialize
  // across replicas while writers of different cards run in parallel. SQLite
  // is a passthrough, as above. See PgAdapter.withFileWriteLocks for the
  // design notes (deadlock ordering, pool footprint, re-entrancy).
  //
  // `fn` is handed a `releaseLocks` it may call to end the critical section
  // ahead of its own return, for work that no longer needs the files — a
  // write's index wait, which is most of its duration and needs no exclusivity
  // at all. Calling it is optional; a section that does not behaves as though
  // this parameter did not exist.
  withFileWriteLocks: <T>(
    realmUrl: string,
    localPaths: readonly string[],
    fn: (releaseLocks: () => void) => Promise<T>,
  ) => Promise<T>;
  // Per-matrix-user cost-barrier primitive: serializes one user's credit
  // bookkeeping — the balance check that admits a billable call and the debit
  // that records its cost — across replicas. PgAdapter
  // implements with `pg_advisory_xact_lock` on a namespaced hash of the
  // matrix user id; SQLite is a passthrough. See PgAdapter.withUserCostLock
  // for design notes (pool pressure, re-entrancy).
  withUserCostLock: <T>(
    matrixUserId: string,
    fn: () => Promise<T>,
  ) => Promise<T>;
  // Run `fn` as shared work: a computation that callers on behalf of
  // different realms may end up waiting on through a coalescing cache.
  // PgAdapter shares its connections out by the realm a search names and
  // holds a realm to a share of them under contention; shared work keeps its
  // place in that ordering but is exempt from the share, so a realm that joins
  // work another realm started never waits at the other realm's share.
  // Adapters that do not share connections out by tenant leave it undefined,
  // and callers run `fn` as it is.
  withSharedWork?: <T>(fn: () => Promise<T>) => Promise<T>;
  // Run `fn` against one read snapshot: every statement `fn` issues through
  // the adapter it is handed sees the database as it stood at the first of
  // them, whatever commits in between. A search reads its rows, its count,
  // its facets and its bindings this way, so it never answers with some of
  // them from before a commit and some from after.
  //
  // PgAdapter pins one pool connection, checked out at the first statement,
  // in a `REPEATABLE READ READ ONLY` transaction, and runs the statements on
  // it one at a time. A statement that fails leaves the snapshot usable for
  // the next, as a statement on its own would. `signal` cancels whichever
  // statement is running when it aborts (a statement's own signal does too),
  // and the transaction ends when `fn` settles, on success, error or cancel.
  // The handed adapter's `withTransaction` runs its body on the snapshot
  // inside a savepoint that is rolled back afterwards, so a `SET LOCAL` in
  // it reaches no other statement; a write there is refused (read only).
  // Calling `withReadSnapshot` on the handed adapter reuses the snapshot.
  // Its locks and writes (`withWriteLock`, `notify`, …) go to the adapter
  // itself, outside the snapshot.
  //
  // Adapters without it leave it undefined, and callers run `fn` with the
  // adapter as it is.
  //
  // `deadline` (epoch ms) is when the search must have finished. Postgres
  // then stops any one statement of the snapshot that runs past it (plus a
  // small margin), so a runaway statement ends even if cancelling it through
  // `signal` fails; such a statement fails as the time budget's refusal
  // (`SearchBoundError`, 408).
  withReadSnapshot?: <T>(
    fn: (reader: DBAdapter) => Promise<T>,
    opts?: { signal?: AbortSignal; deadline?: number },
  ) => Promise<T>;
}

// The deadline (epoch ms) a time budget gave the search an abort signal
// cancels. Whoever arms a budget's signal records its deadline here, and a
// signal combined from others (`mergeAbortSignals`) takes the earliest of
// theirs, so a search reading through the signal it was handed knows how
// long it has left. A signal no budget armed has none.
const signalDeadlines = new WeakMap<AbortSignal, number>();

export function setSignalDeadline(signal: AbortSignal, deadline: number) {
  let current = signalDeadlines.get(signal);
  if (current === undefined || deadline < current) {
    signalDeadlines.set(signal, deadline);
  }
}

export function signalDeadline(
  signal: AbortSignal | null | undefined,
): number | undefined {
  return signal ? signalDeadlines.get(signal) : undefined;
}
