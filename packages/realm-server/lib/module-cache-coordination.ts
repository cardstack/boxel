import { createHash } from 'crypto';
import {
  logger,
  MODULE_CACHE_POPULATED_CHANNEL,
  param,
  type Expression,
  type PgPrimitive,
  type PopulateCoordinator,
  type Querier,
} from '@cardstack/runtime-common';
import type { NotificationSubscription, PgAdapter } from '@cardstack/postgres';

const log = logger('realm-server:module-cache-coordination');

// Hash a coalesce key to a stable signed int64 string for use as a
// pg advisory lock key AND as the bounded payload we send through
// pg_notify. Same shape as hashRealmUrlForAdvisoryLock — sha256
// + readBigInt64BE + toString — so the int64 range is fully utilized and
// callers don't need BigInt-aware parameter binding. Two separate
// keyspaces (realm-write locks vs coalesce locks) coexist in pg's single
// advisory-lock namespace; collision probability is negligible at any
// realistic scale.
//
// Using the hashed id as the NOTIFY payload guarantees we stay well
// under Postgres's ~8000-byte payload cap regardless of how long the
// raw coalesce key gets (it concatenates realm URL + module URL +
// scope + user id; pathological URLs could otherwise overflow). The
// `#waiters` map is keyed off the same hashed id so the dispatch
// path matches.
//
// Exported for tests that manually emit pg_notify and need to address
// a specific waiter.
export function hashCoalesceKeyForAdvisoryLock(key: string): string {
  const digest = createHash('sha256').update(key).digest();
  return digest.readBigInt64BE(0).toString();
}

// Implements PopulateCoordinator (CS-10953). Owns:
//   - a subscription on `module_cache_populated` via the shared multiplexed
//     notification client (`PgAdapter.subscribe`), same pattern as
//     ModuleCacheInvalidationListener;
//   - a Map<coalesceKey, Set<waiter>> that NOTIFY payloads dispatch into;
//   - a `tryAcquireAndRun` method that opens a pinned pool connection,
//     attempts a non-blocking advisory xact-lock keyed on the hash of
//     the coalesce key, and (if won) runs `fn` inside the BEGIN/COMMIT
//     window with a `pg_notify` emit between persist and commit.
//
// The pinned connection holds the advisory lock, emits the NOTIFY, and
// is handed to `fn` as a querier so `fn` can run its own DB work
// (cache re-read + persist) on that same connection instead of checking
// out additional pool clients. This keeps a coordinated load to exactly
// ONE pool connection: because each distinct coalesce key wins its own
// lock, a burst of N distinct-key winners pins N connections, and if
// each also needed a second client for its queries the pool would
// deadlock once N approached the ceiling (the schema editor alone fans
// out to ~31 distinct cold base modules). The in-process #inFlight
// coalescer still fans same-key callers into one coordinated load per
// process; `fn` callbacks that are not DB-bound (e.g. a prerender) may
// ignore the querier and use the shared dbAdapter.
//
// `pg_try_advisory_xact_lock` is non-blocking by design: a blocking
// `pg_advisory_xact_lock` would hold a pool client for the full
// prerender wall time (up to 150s in production) on every loser,
// quickly exhausting the pool. Losers release their pinned connection
// immediately on contention and instead wait on NOTIFY — much cheaper
// to multiplex.
//
// Behavior at N=1: the try-lock always succeeds uncontended; loser
// path is never taken; self-NOTIFY is dropped because there are no
// waiters registered.
//
// Sqlite/in-memory deployments don't construct a coordinator — when
// `dbAdapter.kind !== 'pg'` the realm-server `main.ts` skips
// constructing this and CachingDefinitionLookup runs its uncoordinated
// path.
export interface ModuleCacheCoordinatorDeps {
  dbAdapter: PgAdapter;
}

interface KeyWaiter {
  resolve: () => void;
}

export class ModuleCacheCoordinator implements PopulateCoordinator {
  #deps: ModuleCacheCoordinatorDeps;
  #subscription?: NotificationSubscription;
  #starting?: Promise<void>;
  #waiters = new Map<string, Set<KeyWaiter>>();

  constructor(deps: ModuleCacheCoordinatorDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
    if (this.#subscription || this.#starting) {
      await this.#starting;
      return;
    }
    this.#starting = (async () => {
      this.#subscription = await this.#deps.dbAdapter.subscribe(
        MODULE_CACHE_POPULATED_CHANNEL,
        (notification) => {
          this.#dispatch(notification.payload);
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
    // Wait for any in-flight start() to finish wiring up #subscription
    // before tearing down. Otherwise shutDown can run while subscribe()
    // is still awaiting the LISTEN, return early with #subscription
    // still undefined, and the racing start() then installs a live
    // subscription after we thought we were shut down. Swallow start()
    // errors here — if startup failed, there's nothing to unsubscribe.
    try {
      await this.#starting;
    } catch {
      // ignore
    }
    const sub = this.#subscription;
    this.#subscription = undefined;
    await sub?.unsubscribe();
    // Resolve any waiters still parked so callers don't hang forever
    // during a clean shutdown. Their loops will re-read the cache on
    // wake and either return the row or surface a transient miss as a
    // normal undefined.
    for (let waiters of this.#waiters.values()) {
      for (let waiter of waiters) {
        waiter.resolve();
      }
    }
    this.#waiters.clear();
  }

  // PopulateCoordinator — winner path.
  async tryAcquireAndRun<T>(
    coalesceKey: string,
    fn: (querier: Querier) => Promise<T>,
  ): Promise<{ acquired: true; result: T } | { acquired: false }> {
    const lockKey = hashCoalesceKeyForAdvisoryLock(coalesceKey);
    return await this.#deps.dbAdapter.withConnection(async (queryFn) => {
      await queryFn(['BEGIN']);
      let lockResult: Record<string, PgPrimitive>[];
      try {
        lockResult = await queryFn([
          'SELECT pg_try_advisory_xact_lock(',
          param(lockKey),
          '::bigint) AS got',
        ]);
      } catch (err: unknown) {
        await this.#safeRollback(queryFn);
        throw err;
      }
      const got = lockResult[0]?.got === true;
      if (!got) {
        // Contended. Release the pool client immediately so the loser
        // doesn't hold a pinned connection for the duration of the
        // peer's prerender (could be many seconds; would exhaust the
        // pool under N>>1 concurrency).
        await this.#safeRollback(queryFn);
        return { acquired: false };
      }
      try {
        const result = await fn(queryFn);
        // Emit pg_notify INSIDE the same transaction as the lock so
        // peers only see the signal on commit. When `fn` persisted
        // through the pinned `queryFn`, that write is part of THIS
        // transaction and becomes visible to peers at the COMMIT below —
        // which is also when the NOTIFY is delivered, so a woken peer's
        // re-read always observes it. When `fn` persisted through the
        // shared dbAdapter instead, the row autocommitted even earlier.
        // Either way the row is visible by the time peers re-read on wake.
        //
        // We notify regardless of whether `fn` produced a row or
        // undefined — a "no row" outcome (all populationCandidates
        // produced missing-module errors, or generation-changed
        // returned post-invalidate state) still wants to wake peers
        // promptly so they don't sit on the COALESCE_NOTIFY_WAIT_MS
        // timeout. Peers re-read the cache on wake; if it's empty,
        // they return undefined and the user sees the same answer
        // we returned, just faster than a missed-NOTIFY would.
        await queryFn([
          'SELECT pg_notify(',
          param(MODULE_CACHE_POPULATED_CHANNEL),
          ',',
          // Use the bounded int64 hash, not the raw coalesce key —
          // see hashCoalesceKeyForAdvisoryLock for the cap rationale.
          param(lockKey),
          ')',
        ]);
        await queryFn(['COMMIT']);
        return { acquired: true, result };
      } catch (err: unknown) {
        await this.#safeRollback(queryFn);
        throw err;
      }
    });
  }

  // PopulateCoordinator — loser path. Resolves on either NOTIFY or
  // timeout; the caller's outer loop re-reads the cache regardless.
  async waitForKey(coalesceKey: string, timeoutMs: number): Promise<void> {
    // Key the waiter off the same bounded hash we use as the NOTIFY
    // payload, so #dispatch can match incoming notifications.
    const waiterKey = hashCoalesceKeyForAdvisoryLock(coalesceKey);
    return await new Promise((resolve) => {
      let resolved = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        if (resolved) return;
        resolved = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        // Best-effort waiter unregister so the dispatch path doesn't
        // leak a stale entry. If we already left via NOTIFY the entry
        // is already gone; if we left via timeout we need to clean up.
        const set = this.#waiters.get(waiterKey);
        if (set) {
          set.delete(waiter);
          if (set.size === 0) {
            this.#waiters.delete(waiterKey);
          }
        }
        resolve();
      };
      const waiter: KeyWaiter = { resolve: settle };
      let set = this.#waiters.get(waiterKey);
      if (!set) {
        set = new Set();
        this.#waiters.set(waiterKey, set);
      }
      set.add(waiter);
      timer = setTimeout(settle, timeoutMs);
      // unref so a hung waiter doesn't hold the Node event loop open
      // during shutdown / test teardown. Real workloads won't reach
      // the timeout in healthy operation.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
    });
  }

  // Exposed for tests.
  handleNotification(payload: string | undefined): void {
    this.#dispatch(payload);
  }

  #dispatch(payload: string | undefined): void {
    if (!payload) {
      return;
    }
    // Payload is the bounded int64 hash of the coalesce key (see
    // hashCoalesceKeyForAdvisoryLock). #waiters is keyed off the same
    // hash, so we look up directly with no structure to parse.
    const set = this.#waiters.get(payload);
    if (!set) {
      return;
    }
    this.#waiters.delete(payload);
    for (let waiter of set) {
      try {
        waiter.resolve();
      } catch (err: unknown) {
        log.warn(
          `${MODULE_CACHE_POPULATED_CHANNEL} waiter resolve threw for ${payload}: ${String(err)}`,
        );
      }
    }
  }

  async #safeRollback(
    queryFn: (expr: Expression) => Promise<Record<string, PgPrimitive>[]>,
  ): Promise<void> {
    try {
      await queryFn(['ROLLBACK']);
    } catch (rollbackErr: unknown) {
      // The xact-lock and any in-tx state release when the connection's
      // transaction is aborted — pg auto-rolls back on client release —
      // so we don't have a stale-lock problem. Log for visibility.
      log.warn(
        `ROLLBACK after coordinator error failed: ${String(rollbackErr)}`,
      );
    }
  }
}
