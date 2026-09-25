import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
  type Expression,
  type Querier,
  type TransactionOptions,
  Deferred,
  expressionToSql,
  logger,
  param,
} from '@cardstack/runtime-common';
import { createHash } from 'crypto';
import nodePgMigrate, { type RunnerOption } from 'node-pg-migrate';
import { join } from 'path';
import { Pool, Client, type PoolClient, type Notification } from 'pg';

import { postgresConfig } from './pg-config.ts';
import migrationNameFixes from './scripts/migration-name-fixes.cjs';

// node-pg-migrate is CJS and exposes the runner as its default export. Under
// native ESM the default import binds the module's namespace object, so the
// callable lives on `.default`; the package's types declare the default as the
// runner, so cast to its call signature.
const migrate = ((nodePgMigrate as any).default ?? nodePgMigrate) as (
  options: RunnerOption,
) => Promise<unknown>;

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

// Lock key for the per-matrix-user "next request waits for prior cost to land"
// barrier (see PgAdapter.withUserCostLock). Namespaced so the user-cost lock
// space cannot collide with the realm-write lock space — a matrix user id is
// extremely unlikely to hash-collide with a realm URL even without the
// namespace (input shapes are disjoint), but the prefix makes the partition
// explicit at the key-derivation site rather than implicit in input formats.
export function hashUserIdForCostLock(matrixUserId: string): string {
  const digest = createHash('sha256')
    .update('cost-barrier:')
    .update(matrixUserId)
    .digest();
  return digest.readBigInt64BE(0).toString();
}

// Lock key for one file within one realm (see PgAdapter.withFileWriteLocks).
// Namespaced away from both the realm-write and user-cost spaces: a file lock
// and its realm's lock must never collide, or a writer holding a file would
// exclude a realm-lifecycle caller that has nothing to do with it. The realm
// URL and the path are joined through a separator that cannot appear in
// either, so two different (realm, path) pairs cannot produce one key by
// running together at the join.
export function hashFilePathForAdvisoryLock(
  realmUrl: string,
  localPath: string,
): string {
  const digest = createHash('sha256')
    .update('file-write:')
    .update(realmUrl)
    .update('\u0000')
    .update(localPath)
    .digest();
  return digest.readBigInt64BE(0).toString();
}

// How many files one write may lock individually before it takes the realm
// instead. Advisory locks occupy a cluster-wide table sized by
// `max_locks_per_transaction`, and a transaction holding one per file would
// exhaust it on a caller that names a file per entry — the realm-wide
// `deleteAll` an unpublish performs is the one that reaches that scale.
//
// Sized by the shape of the callers rather than by the table: an interactive
// card write names one file and its side-loads, a composed batch a few dozen.
// Anything past this is a bulk operation whose natural scope is the realm.
const MAX_FILE_WRITE_LOCKS = 256;

const log = logger('pg-adapter');

// deadlock_detected and serialization_failure: the attempt lost a race with
// another transaction and is expected to succeed when run again.
const RETRYABLE_TRANSACTION_SQLSTATES = new Set(['40P01', '40001']);

// One line per file-write lock acquisition. Separate from `pg-adapter`'s own
// channel because it is operational signal rather than adapter diagnostics,
// and it answers the question request latency cannot: a write that took a
// minute either did a minute of work or spent it queued behind another writer
// of the same card, and only `waitMs` against `holdMs` tells those apart.
//
// Emitted for every acquisition, not sampled and not gated on a correlation
// id. Writes are a small fraction of a realm's requests — hundreds an hour
// against tens of thousands of reads — and a contended write is rarely one
// that was instrumented in advance.
//
// The line leads with a fixed token because the log envelope does not carry
// the channel name: filtering for this signal means matching the content.
const lockLog = logger('realm:write-lock');

type MigrationNameFixes = {
  migrationRenames: Array<[string, string]>;
  buildUpdateMigrationSql: (mapping: Array<[string, string]>) => string;
};

const { migrationRenames, buildUpdateMigrationSql } =
  migrationNameFixes as MigrationNameFixes;

function config() {
  return postgresConfig({
    database: 'boxel',
  });
}

type Config = ReturnType<typeof config>;

// node-postgres' default pool max is 10. That's too small for the
// realm-server under parallel indexing — a single file render can
// fire several federated-search calls, each running primaryQuery +
// loadLinks-layer queries that each hold a connection for the
// duration of the SQL round-trip. With INDEX_RUNNER_MAX_CONCURRENCY=4
// renders in flight at peak, observed pg connection demand reaches
// 20+ — and any waiter past max sits in node-postgres' internal
// acquire queue, which is indistinguishable from "the SQL is slow"
// in diagnostic logs (we saw primaryQuery=73s for queries returning
// 3 rows during the ambitious-piranha benchmark). 40 gives a margin
// over that peak for non-search realm-server work (advisory locks,
// indexer writes, NOTIFY dispatch) so a search burst doesn't crowd
// out the indexer's own commits. Hosted RDS sizing (staging
// db.r7g.large ≈ 1700, prod db.r7g.xlarge ≈ 3500 default
// max_connections) leaves plenty of headroom even with 4-6 client
// processes each opening their own pool. Operators can raise it
// further via the env var for fleets with bigger pg instances; lower
// it to throttle a noisy realm.
const DEFAULT_POOL_MAX = 40;
function configuredPoolMax(): number {
  let rawValue = process.env.PG_POOL_MAX;
  if (!rawValue) {
    return DEFAULT_POOL_MAX;
  }

  let value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_POOL_MAX;
}

export type NotificationHandler = (notification: Notification) => void;

export interface NotificationSubscription {
  unsubscribe(): Promise<void>;
}

// Per-channel state kept alive while at least one subscriber is registered
// or while a LISTEN is being established. Each subscribe() pushes its own
// handler entry and holds a reference to it, so unsubscribing removes the
// exact entry — even when the same function reference is subscribed twice.
// `establishment` resolves when LISTEN has succeeded; concurrent subscribers
// to the same channel join the same promise so a LISTEN failure rejects all
// of them atomically rather than leaving later subscribers stranded.
type HandlerEntry = { fn: NotificationHandler };
type ChannelState = {
  handlers: HandlerEntry[];
  establishment: Promise<void>;
};

// `pg` reports a connection dying as an `error` event, and an `error` event
// with no listener is an uncaught exception — so every connection whose
// lifecycle this module owns carries one, whether it lives for a query or for
// the life of a subscription. A short-lived client is no less exposed: its
// in-flight query rejects into the caller that can handle it, and the socket's
// closing event arrives afterwards with nobody left to hear it.
//
// The migration runner is the deliberate exception. `migrate()` is given a
// connection config rather than a client, so node-pg-migrate opens and owns
// that connection, and a drop there has to stop startup rather than be logged
// and continued: the rejection it raises already does that, and a listener
// would only be racing it. Recording is for a process that should survive the
// drop, which a half-applied schema is not.
//
// Severity says whether anything recovers. A pooled client is replaced on the
// next checkout and a short-lived one reports through its caller, so those are
// `warn`. A connection held for the life of a subscription has no reconnect
// path — losing it degrades whatever depends on those notifications for the
// rest of the process's life, which is worth alerting on.
//
// Returns a function that stops recording, for the callers that hand their
// client back: a pool re-attaches its own idle listener on release, and this
// one must come off so the client it owns again carries exactly one.
function recordConnectionErrors(
  client: Client | PoolClient,
  label: string,
  severity: 'warn' | 'error',
): () => void {
  let onError = (e: Error) => {
    log[severity](`connection error on ${label}: ${String(e)}`);
  };
  client.on('error', onError);
  return () => client.removeListener('error', onError);
}

export class PgAdapter implements DBAdapter {
  readonly kind = 'pg';
  #isClosed = false;
  private pool: Pool;
  private started: Promise<void>;
  private config: Config;
  // Shared LISTEN connection used by all subscribe() callers. A dedicated
  // Client (not Pool-acquired) is required because LISTEN/NOTIFY is
  // unreliable on pooled connections — see node-postgres#1543. Lazily
  // opened on first subscribe; closed in close().
  #notificationClient?: Client;
  #notificationClientStarting?: Promise<Client>;
  #channels = new Map<string, ChannelState>();
  // In-process coalescer for the per-user cost-barrier. Multiple concurrent
  // same-user callers in this process chain on the same in-memory promise so
  // only ONE of them is actively waiting on the cross-replica advisory lock
  // (and therefore pinning a pool connection) at a time. The advisory lock
  // itself serializes the holder across replicas; the in-process map keeps
  // the per-replica pool footprint bounded to one connection per active
  // same-user user, not one per concurrent same-user request. See
  // withUserCostLock for the full rationale.
  #userCostQueue = new Map<string, Promise<void>>();
  // The same coalescer, for writers contending over one set of files. Keyed by
  // the lock keys a call asks for, joined in the order they are taken — so two
  // writers aimed at one card chain in memory and only the head of the chain
  // pins a pool connection while it waits, and two writers aimed at different
  // cards never meet here at all. See withFileWriteLocks.
  #fileWriteQueue = new Map<string, Promise<void>>();

  constructor(opts?: { autoMigrate?: boolean; migrationLogging?: boolean }) {
    if (opts?.autoMigrate) {
      this.started = this.migrateDb(opts.migrationLogging !== false);
    } else {
      this.started = Promise.resolve();
    }
    this.config = config();
    let { user, host, database, password, port } = this.config;
    let max = configuredPoolMax();
    log.debug(`connecting to DB ${this.url}`);
    this.pool = new Pool({
      user,
      host,
      database,
      password,
      port,
      max,
    });
    // An idle client whose connection dies — a failover, a restart, an
    // administrator terminating the backend — emits `error` on the pool, and
    // an `error` event nobody listens for is an uncaught exception. The pool
    // has already discarded the client by the time this runs and stays
    // usable, so recording it is the whole job: without this listener a
    // process that was about to reconnect dies instead.
    this.pool.on('error', (e: Error) => {
      log.warn(`error on idle client of ${this.url}: ${String(e)}`);
    });
  }

  get isClosed() {
    return this.#isClosed;
  }

  get url() {
    let { user, host, database, port } = this.config;
    return `${user}@${host}:${port}/${database}`;
  }

  async close() {
    log.debug(`closing ${this.url}`);
    this.#isClosed = true;
    await this.started;
    // Resolve any in-flight notification-client startup so we can end the
    // resulting Client. Without this await, a close() that races a first
    // subscribe() can leave the connection alive after #isClosed flipped to
    // true, because the connect() resolves into #notificationClient only
    // after we've already returned from close().
    let pendingStart = this.#notificationClientStarting;
    if (pendingStart) {
      try {
        await pendingStart;
      } catch {
        // Startup failed — there's nothing for us to end.
      }
    }
    const client = this.#notificationClient;
    this.#notificationClient = undefined;
    this.#channels.clear();
    if (client) {
      try {
        await client.end();
      } catch (err: unknown) {
        log.warn(`failed to end shared notification client: ${String(err)}`);
      }
    }
    await this.pool.end();
  }

  // Subscribe a handler to a Postgres NOTIFY channel. Multiple subscribe()
  // callers — across channels, or even on the same channel — share one
  // dedicated Client; the Client is opened lazily on the first subscribe and
  // closed in close(). Each call returns an `unsubscribe()` that removes
  // just this handler; UNLISTEN is sent only after the last handler for a
  // channel is removed. Concurrent subscribes on the same channel join the
  // same in-flight LISTEN, so a LISTEN failure rejects all racing callers
  // atomically — no caller is ever stranded with a registered handler that
  // the backend isn't actually delivering to.
  async subscribe(
    channel: string,
    handler: NotificationHandler,
  ): Promise<NotificationSubscription> {
    await this.started;
    // Loop in case the channel state we joined gets torn down by a concurrent
    // unsubscribe (or LISTEN failure) while we were still awaiting establishment.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.#isClosed) {
        throw new Error('PgAdapter is closed');
      }
      const client = await this.#ensureNotificationClient();
      if (this.#isClosed) {
        throw new Error('PgAdapter is closed');
      }
      let state = this.#channels.get(channel);
      if (!state) {
        const safeChannel = safeName(channel);
        const establishment = (async () => {
          await client.query(`LISTEN ${safeChannel}`);
        })();
        const newState: ChannelState = { handlers: [], establishment };
        this.#channels.set(channel, newState);
        // If LISTEN ultimately rejects, drop the channel from the map so the
        // next subscribe gets a fresh attempt rather than re-awaiting a
        // permanently-rejected promise. Awaiting subscribers see the rejection
        // through their own `await state.establishment` below.
        establishment.catch(() => {
          if (this.#channels.get(channel) === newState) {
            this.#channels.delete(channel);
          }
        });
        state = newState;
      }
      const joined = state;
      await joined.establishment;
      // A concurrent unsubscribe may have torn the channel state down between
      // when we joined it and when LISTEN resolved. Re-check, retry from the
      // top if so.
      if (this.#channels.get(channel) !== joined) {
        continue;
      }
      const entry: HandlerEntry = { fn: handler };
      joined.handlers.push(entry);
      let unsubscribed = false;
      return {
        unsubscribe: async () => {
          if (unsubscribed) {
            return;
          }
          unsubscribed = true;
          const cur = this.#channels.get(channel);
          if (!cur) {
            return;
          }
          const idx = cur.handlers.indexOf(entry);
          if (idx >= 0) {
            cur.handlers.splice(idx, 1);
          }
          if (cur.handlers.length > 0) {
            return;
          }
          this.#channels.delete(channel);
          if (this.#notificationClient && !this.#isClosed) {
            try {
              await this.#notificationClient.query(
                `UNLISTEN ${safeName(channel)}`,
              );
            } catch (err: unknown) {
              log.warn(`UNLISTEN ${channel} failed: ${String(err)}`);
            }
          }
        },
      };
    }
  }

  async #ensureNotificationClient(): Promise<Client> {
    if (this.#notificationClient) {
      return this.#notificationClient;
    }
    if (this.#notificationClientStarting) {
      return this.#notificationClientStarting;
    }
    this.#notificationClientStarting = (async () => {
      const client = new Client(this.config);
      client.on('notification', (n) => {
        log.debug(`heard pg notification for channel %s`, n.channel);
        const state = this.#channels.get(n.channel);
        if (!state) {
          return;
        }
        for (const entry of [...state.handlers]) {
          try {
            entry.fn(n);
          } catch (err: unknown) {
            log.warn(
              `notification handler for channel ${n.channel} threw: ${String(err)}`,
            );
          }
        }
      });
      client.on('error', (err) => {
        // The shared client is the substrate for every subscriber, so a
        // disconnect silently kills them all. Surface it loudly. Reconnect
        // is not implemented here; current production has not seen this
        // path, and the legacy listen() API has the same hazard.
        log.error(`shared notification client error: ${String(err)}`);
      });
      await client.connect();
      this.#notificationClient = client;
      return client;
    })();
    try {
      return await this.#notificationClientStarting;
    } finally {
      this.#notificationClientStarting = undefined;
    }
  }

  async execute(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Record<string, PgPrimitive>[]> {
    await this.started;
    let client = await this.pool.connect();
    // A checked-out client's death is nobody's event: the pool removes its
    // own idle listener for the duration of the checkout, so the in-flight
    // query rejects into the caller that handles it and the socket's closing
    // event lands unheard.
    let stopRecording = recordConnectionErrors(client, this.url, 'warn');
    log.debug(
      `executing sql: ${sql}, with bindings: ${JSON.stringify(opts?.bind)}`,
    );
    try {
      let { rows } = await client.query({
        text: sql,
        values: opts?.bind,
      });
      return rows;
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.message} (${e.hint}):\n${sql}${
          opts?.bind ? ' with bindings: ' + JSON.stringify(opts?.bind) : ''
        }`,
        e,
      );
      throw e;
    } finally {
      stopRecording();
      client.release();
    }
  }

  async notify(channel: string, payload: string): Promise<void> {
    await this.execute('SELECT pg_notify($1, $2)', {
      bind: [channel, payload],
    });
  }

  // @deprecated — prefer `subscribe(channel, handler)`. Each call to listen()
  // opens its own dedicated Client connection for the duration of `fn`, which
  // doesn't scale as the number of LISTEN-using callers grows. subscribe()
  // multiplexes all callers onto a single shared Client. This entry point is
  // kept for callers that haven't migrated yet (e.g. pg-queue).
  async listen(
    channel: string,
    handler: (notification: Notification) => void,
    fn: () => Promise<void>,
  ) {
    await this.started;

    // we have found that LISTEN/NOTIFY doesn't work reliably on connections from the
    // Pool, and this is substantiated by commentary on GitHub:
    //   https://github.com/brianc/node-postgres/issues/1543#issuecomment-353622236
    // So for listen purposes, we establish a completely separate connection.
    let client = new Client(this.config);
    recordConnectionErrors(
      client,
      `the LISTEN connection for ${channel}`,
      // Nothing reconnects this: the subscription is dead for the life of the
      // process, and every caller waiting on those notifications silently
      // falls back to whatever polling it has. `error` so it can be alerted
      // on rather than read afterwards.
      'error',
    );
    await client.connect();
    try {
      client.on('notification', (n) => {
        log.debug(`heard pg notification for channel %s`, n.channel);
        handler(n);
      });
      await client.query(`LISTEN ${safeName(channel)}`);
      await fn();
    } finally {
      await client.end();
    }
  }

  // Run `fn` while holding a per-realm transaction-scoped Postgres advisory
  // lock. The lock is taken with `pg_advisory_xact_lock` inside an explicit
  // BEGIN / COMMIT on a pinned pool connection (via withConnection), so the
  // lock is automatically released by the transaction's commit or rollback
  // — there is no "unlock failed → stale lock on pooled connection" failure
  // mode that a session-scoped `pg_advisory_lock` + `pg_advisory_unlock`
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
  // the pinned `txQuerier` argument share that transaction's atomicity.
  // CS-10898 plumbed the pinned querier through the realm-destruction
  // helpers (removeRealmDatabaseArtifacts, removeRealmPermissions,
  // deleteRegistryRowByUrl, deletePublishedRowsBySourceUrl,
  // cancelRunningJobsInLaneFamily); when callers pass `txQuerier` to
  // those helpers, all their writes commit or roll back together with the
  // advisory lock's own transaction. Queries `fn` issues through the shared
  // dbAdapter still go via separate pool connections and are NOT part of
  // this transaction.
  //
  // What reaches this method is the realm-lifecycle work — creating,
  // destroying, publishing and unpublishing a realm — which is the work that
  // wants the realm itself held and the pinned querier's atomicity. A card
  // write takes `withFileWriteLocks` instead: it is scoped to the files it
  // touches, and its inner work (writing them through the FS adapter,
  // enqueuing indexing, broadcasting NOTIFY) is not transactional with a
  // lock-holder's connection in any case, so it is handed no querier to
  // consume.
  //
  // Pool-exhaustion caveat: when the callback opts into the pinned querier
  // for all of its DB work, only one client is checked out for the entire
  // critical section. If the callback also issues queries through the
  // shared dbAdapter (e.g. existence-check SELECTs), each of those checks
  // out an additional pool client briefly. Under N concurrent same-URL
  // writers, N-1 block on the advisory lock before doing anything — so
  // this method does not itself amplify pool pressure. Under N concurrent
  // different-URL writers, each pins one client; if the pool ceiling is
  // less than realistic write concurrency, callbacks that need additional
  // pool clients could deadlock waiting on the pool. For current scope
  // (low realistic write concurrency, pool size >= concurrent writers +
  // headroom) this is acceptable.
  //
  // Re-entrancy: callers MUST NOT re-enter the lock for the same URL while
  // already holding it — a second `pg_advisory_xact_lock` on the same key
  // would pin a different pool connection and block forever on its own
  // transaction. Code that wraps a wider critical section around a method
  // that also takes the lock must invoke the unlocked inner variant, the way
  // `withFileWriteLocks`'s callers reach `_batchWriteUnlocked` rather than the
  // public write methods that would take those locks again.
  async withWriteLock<T>(
    realmUrl: string,
    fn: (txQuerier: Querier | undefined) => Promise<T>,
  ): Promise<T> {
    const lockKey = hashRealmUrlForAdvisoryLock(realmUrl);
    return await this.#runWithAdvisoryXactLock(lockKey, realmUrl, fn);
  }

  // Serialize the writers of a set of files, rather than the writers of a
  // realm. What a card write needs to be exclusive over is the read-merge-write
  // of the files it touches: two writers that both read one card's stored
  // bytes, merge independently, and write must not interleave, or the second
  // silently drops the first's changes. That is a property of the files, and
  // holding the realm instead charges every other writer in the realm for it —
  // including the writers of cards this one never reads.
  //
  // Scope is what separates this from `withWriteLock`. Both are
  // `pg_advisory_xact_lock`, so both serialize across replicas and both release
  // on commit or rollback with no stale-lock mode. This one takes a key per
  // file, in a key space of its own, so two writers of different cards do not
  // exclude each other. A caller that must exclude every writer in the realm —
  // destroying it, publishing it — still wants `withWriteLock`, and this one
  // holds the realm's own key in shared mode so that caller still excludes it.
  //
  // Deadlock: keys are sorted and taken in that order, so two batches whose
  // file sets overlap take the shared keys in the same sequence and one waits
  // rather than each holding what the other needs. What matters is that every
  // caller agrees on the order, not what the order means — these are hashes,
  // so their sequence carries nothing about the files. The realm's own key is
  // always taken first, ahead of any file key, for the same reason.
  // Duplicates collapse — one file named twice in a batch is one lock.
  //
  // Pool footprint: a waiter blocks on `pg_advisory_xact_lock` with its client
  // already checked out and its transaction open, so N contending writers would
  // pin N clients from the pool indexing and `_federated-search` also draw on.
  // The in-process queue in front bounds that to one pinned client per
  // contended file set per replica, the same trade `withUserCostLock` makes
  // and for the same reason.
  //
  // What that queue does not bound is writers of *different* files, and
  // nothing else does either — the realm key is taken shared, so it no longer
  // holds a replica to one critical section per realm the way an exclusive
  // realm lock did. Each section pins its client for as long as it holds the
  // locks, and its inner work draws further clients from the same pool, so
  // per-realm peak demand is the number of concurrent writers rather than one.
  // A section that releases early gives its client back there rather than at
  // its own end, so the work it does afterwards costs the pool nothing.
  //
  // Left unbounded deliberately. The number of sections in flight is arrival
  // rate times hold time, and the hold is what this scope shortens: a writer
  // no longer waits out another card's indexing, nor its own. A realm taking a
  // few hundred writes an hour against a hold measured in seconds keeps well
  // under one concurrent section on average. Adding a cap would reintroduce,
  // at a fixed width, the queueing this removes.
  //
  // The pool is the backstop if that reasoning is ever wrong: past its ceiling
  // `pool.connect()` makes writers wait for a client instead of failing, which
  // degrades the same way the previous lock did and is visible as `waitMs` on
  // the lock's own telemetry.
  //
  // The callback gets no pinned querier. These locks serialize file writers;
  // they do not group the writes into a transaction, and the work inside —
  // writing bytes through the filesystem adapter, enqueueing indexing — is not
  // transactional with this connection anyway.
  //
  // Re-entrancy: a caller holding any of these keys must not ask for them
  // again. A second `pg_advisory_xact_lock` on a held key runs on a different
  // pooled connection and waits on the first's transaction forever.
  // Ending the section early: `fn` is handed a `releaseLocks` it may call once
  // it is done with the files, and everything it does after that call runs
  // with the locks already gone. What that is for is the write path, where the
  // work after the bytes are durable — queueing an index job and waiting for a
  // worker to run it — needs no exclusivity over the files at all, while being
  // by far the longest part of the section. Holding across it makes the Nth
  // concurrent writer of one card wait N index passes; releasing at the
  // durable boundary makes it wait for one. A section that never calls it
  // behaves exactly as before, releasing when it returns.
  //
  // It releases the realm's shared guard along with the file keys, since one
  // transaction holds them all and ends as a unit. So a section that releases
  // early excludes a realm-lifecycle caller up to its durable write rather
  // than to its own end, and a realm destroyed in that window takes out the
  // job rows a released section may still be waiting on. A section whose
  // remaining work depends on the realm surviving it should hold to the end.
  async withFileWriteLocks<T>(
    realmUrl: string,
    localPaths: readonly string[],
    fn: (releaseLocks: () => void) => Promise<T>,
  ): Promise<T> {
    // Before anything waits, so the wait this call reports covers the in-
    // process queue below as well as the lock itself. A writer that spent its
    // time chained in memory waited just as long as one that spent it blocked
    // in postgres, and the queue is where same-file contention now lands.
    const enqueuedAt = Date.now();
    const fileKeys = [
      ...new Set(
        localPaths.map((localPath) =>
          hashFilePathForAdvisoryLock(realmUrl, localPath),
        ),
      ),
    ].sort();
    const realmKey = hashRealmUrlForAdvisoryLock(realmUrl);
    if (fileKeys.length === 0) {
      // A write that names no file still runs under the realm guard. It has no
      // read-merge-write of its own to protect — a create the client did not
      // name mints a path while staging that no other writer can be aimed at —
      // but it does write, and a realm-lifecycle caller taking the realm key
      // exclusively must still exclude it. Dropping the guard here is what
      // would let a realm be torn down under a create.
      //
      // No in-process chaining: a shared holder conflicts with no other shared
      // holder, so there is nothing for a queue in front of it to bound.
      let { work } = await this.#runWithAdvisoryXactLocks(
        [{ key: realmKey, mode: 'shared' }],
        { realmUrl, fileCount: 0, enqueuedAt },
        fn,
      );
      return await work;
    }
    // Past the ceiling the file keys are dropped for the realm's own key, held
    // exclusively. Every advisory lock a transaction takes occupies a slot in
    // a cluster-wide table sized by `max_locks_per_transaction`, so a caller
    // naming a file per entry — unpublishing a realm hands `deleteAll` every
    // file in it — would otherwise take thousands of them at once and fail the
    // write with "out of shared memory". Falling back to the realm is sound
    // rather than merely cheap: it excludes strictly more writers than the
    // file keys would, and a caller touching this many files is realm-scoped
    // in effect already.
    const bulk = fileKeys.length > MAX_FILE_WRITE_LOCKS;
    const lockPlan: { key: string; mode: 'shared' | 'exclusive' }[] = bulk
      ? [{ key: realmKey, mode: 'exclusive' }]
      : [
          // Shared on the realm, so file writers do not exclude each other
          // through it, but a realm-lifecycle caller taking the realm key
          // exclusively — destroying, publishing or unpublishing the realm —
          // is held out for as long as each of them holds. Without this the
          // two lock spaces are disjoint and a realm could be torn down under
          // a live write. How long each holds is the section's to decide; see
          // the early release above.
          { key: realmKey, mode: 'shared' as const },
          ...fileKeys.map((key) => ({ key, mode: 'exclusive' as const })),
        ];
    const queueKey = bulk ? `bulk:${realmKey}` : fileKeys.join(',');
    const previous = this.#fileWriteQueue.get(queueKey) ?? Promise.resolve();
    // Resolves when this caller's locks are gone, carrying whatever of its
    // section is still running. The two moments are the same for a section
    // that holds to the end and different for one that releases early, and the
    // queue below has to chain on the first of them while the caller waits on
    // the second.
    const myTurn = (async (): Promise<{ work: Promise<T> }> => {
      try {
        await previous;
      } catch {
        // A prior caller's failure must not cascade — the next writer of
        // these files still gets its turn at the lock.
      }
      return await this.#runWithAdvisoryXactLocks(
        lockPlan,
        { realmUrl, fileCount: fileKeys.length, enqueuedAt },
        fn,
      );
    })();
    // What the next caller for this same file set waits on: outcome-erased so
    // its own try/catch is not sensitive to ours, and tee'd off `myTurn` to
    // keep one source of truth for when the files came free. Chaining on the
    // whole section instead would put back in memory exactly the queueing the
    // early release removes in postgres — the next writer would sit here for
    // the duration of this one's index wait, on this replica, having been let
    // through by every other replica.
    const myCompletion: Promise<void> = myTurn.then(
      () => undefined,
      () => undefined,
    );
    this.#fileWriteQueue.set(queueKey, myCompletion);
    // Compact the map once the chain is idle. Only delete if no later caller
    // has overwritten the tail — otherwise the chain is unlinked and a
    // same-file-set caller races past it.
    void myCompletion.finally(() => {
      if (this.#fileWriteQueue.get(queueKey) === myCompletion) {
        this.#fileWriteQueue.delete(queueKey);
      }
    });
    const { work } = await myTurn;
    return await work;
  }

  // Per-matrix-user serialization barrier for a user's credit bookkeeping.
  // Callers hold it around the steps that read the user's balance and act on
  // it — gating a billable call on the balance, and debiting a call's cost —
  // so two such steps for the same matrix user never interleave, including
  // across replicas with no stickiness. The debit reads each credit bucket
  // before writing it, so two unserialized debits can both spend the same
  // credits.
  //
  // Two coordination layers compose:
  //
  // 1. In-process: `#userCostQueue` chains same-user callers within this
  //    process on an in-memory promise. Only the head of the chain is
  //    actively waiting on the DB lock; later callers wait in memory.
  // 2. Cross-replica: `pg_advisory_xact_lock` on a namespaced hash of the
  //    matrix user id serializes holders across replicas.
  //
  // Pool-pressure budget: this is the realm-server's main pool (also used
  // by indexing / federated-search), and a burst of one user's calls
  // arrives at the barrier together. Without
  // the in-process queue, N concurrent same-user requests landing on one
  // replica would each pin a pool client while blocked on the advisory
  // lock — that scales badly against the 40-client default and the
  // indexer's 20-client baseline. With the queue, per-replica pool
  // footprint is bounded to *one* pinned client per active same-user
  // user, not per concurrent request. Across N replicas a single user's
  // requests fan out to at most N pinned clients cluster-wide; per-replica
  // count is invariant to per-user concurrency.
  //
  // Failure semantics: a prior caller's rejection does NOT cascade — the
  // next caller's `await previous.catch(...)` swallows it so the chain
  // marches on. Each caller's own error is surfaced via the returned
  // promise. The advisory lock's own rollback/release semantics are the
  // same as withWriteLock (xact-lock released on transaction abort, no
  // stale-lock risk).
  //
  // The callback does NOT receive a `txQuerier` — the barrier only needs
  // serialization, not transactional grouping of the work inside it.
  // Inner DB calls (validateCredits, spendUsageCost) run via the shared
  // dbAdapter on separate pool connections as today.
  async withUserCostLock<T>(
    matrixUserId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#userCostQueue.get(matrixUserId) ?? Promise.resolve();
    const lockKey = hashUserIdForCostLock(matrixUserId);
    const myWork = (async (): Promise<T> => {
      try {
        await previous;
      } catch {
        // A prior caller's failure must not cascade — the next request
        // in the queue should still get its turn at the lock.
      }
      return await this.#runWithAdvisoryXactLock(
        lockKey,
        `user-cost:${matrixUserId}`,
        () => fn(),
      );
    })();
    // What the NEXT same-user caller waits on: outcome-erased so its
    // own try/catch isn't sensitive to ours. Tee'd off myWork to keep a
    // single source of truth for completion timing.
    const myCompletion: Promise<void> = myWork.then(
      () => undefined,
      () => undefined,
    );
    this.#userCostQueue.set(matrixUserId, myCompletion);
    // Compact the map once the chain is idle. Only delete if no later
    // caller has overwritten the tail — otherwise we'd unlink the chain
    // and let a same-user race past it.
    void myCompletion.finally(() => {
      if (this.#userCostQueue.get(matrixUserId) === myCompletion) {
        this.#userCostQueue.delete(matrixUserId);
      }
    });
    return await myWork;
  }

  // Take several advisory locks in one transaction, in the order given, and
  // run `fn` holding all of them. Postgres keeps every xact-lock a transaction
  // takes until it ends, so the set is released together on commit or
  // rollback; there is no partial hold to unwind if a later key blocks.
  //
  // Each key is its own statement rather than one set-returning call, because
  // the order keys are taken in is what prevents deadlock and a single
  // statement over a set does not promise the order it evaluates them in. A
  // single-file write — the common case — is one statement either way.
  //
  // The timing line is the signal this lock is judged on: `waitMs` is how long
  // the writer queued behind other writers of these same files, `holdMs` how
  // long it kept them from running. A write that spent a minute working and
  // one that spent it queued look identical from request latency alone; they
  // differ here. A section that releases early holds for less than it runs
  // for, and `holdMs` is the shorter of the two — which is the whole point of
  // the field: it is what this caller cost the next one.
  //
  // Resolves when the locks are gone rather than when the section finishes,
  // handing back the section's remaining work so the caller can wait on it
  // afterwards. Those are the same moment unless the section released early,
  // and separating them is what lets the in-process queue advance on the lock
  // rather than on the work.
  async #runWithAdvisoryXactLocks<T>(
    lockPlan: readonly { key: string; mode: 'shared' | 'exclusive' }[],
    context: { realmUrl: string; fileCount: number; enqueuedAt: number },
    fn: (releaseLocks: () => void) => Promise<T>,
  ): Promise<{ work: Promise<T> }> {
    let work: Promise<T> | undefined;
    await this.withConnection(async (queryFn) => {
      await queryFn(['BEGIN']);
      let holdStart: number | undefined;
      try {
        for (const { key, mode } of lockPlan) {
          await queryFn([
            mode === 'shared'
              ? `SELECT pg_advisory_xact_lock_shared(`
              : `SELECT pg_advisory_xact_lock(`,
            param(key),
            `::bigint)`,
          ]);
        }
        holdStart = Date.now();
        const releasedEarly = new Deferred<void>();
        work = fn(() => releasedEarly.fulfill());
        // Whichever comes first. The rejection arm exists so a section that
        // fails before releasing still rolls back here, the way it always
        // has, rather than committing and reporting the failure from a
        // transaction that already ended — and attaching it is also what
        // keeps a rejection that nobody has awaited yet from surfacing as an
        // unhandled one in the window between the commit and the caller.
        const failure = await Promise.race([
          work.then(
            () => undefined,
            (error: unknown) => ({ error }),
          ),
          releasedEarly.promise.then(() => undefined),
        ]);
        if (failure) {
          throw failure.error;
        }
        await queryFn(['COMMIT']);
      } catch (err: unknown) {
        try {
          await queryFn(['ROLLBACK']);
        } catch (rollbackErr: unknown) {
          // Rollback failed — the xact-locks are still released when the
          // connection's transaction is aborted (pg auto-rollbacks on client
          // release), so there is no stale-lock problem. Logged for
          // visibility, and the original error is what propagates.
          log.warn(
            `ROLLBACK after advisory-lock error for ${context.realmUrl} failed: ${String(rollbackErr)}`,
          );
        }
        throw err;
      } finally {
        const now = Date.now();
        // Measured from before the in-process queue rather than from the
        // transaction, so it covers everything between the call and the hold:
        // waiting behind a same-file writer in memory, checking out a pool
        // client, and blocking in postgres. Timing only the last of those
        // would report no contention in exactly the case the queue exists for,
        // where the wait is spent in memory and never reaches the lock.
        //
        // A caller that never reached the hold waited for the whole of its
        // time here and held for none of it, which is what a failed
        // acquisition should read as rather than as a zero-length wait.
        const waitMs = (holdStart ?? now) - context.enqueuedAt;
        const holdMs = holdStart === undefined ? 0 : now - holdStart;
        // `files` is what the write named, and `scope` says whether it got a
        // key each (`files`), fell back to the realm past the ceiling
        // (`realm`), or named no file and holds only the realm guard
        // (`guard`) — so a long `waitMs` reads as the ceiling or a realm
        // lifecycle operation rather than as contention over one card.
        let scope =
          lockPlan[0]?.mode === 'exclusive'
            ? 'realm'
            : context.fileCount === 0
              ? 'guard'
              : 'files';
        lockLog.info(
          `writeLock realm=${context.realmUrl} waitMs=${waitMs} holdMs=${holdMs} files=${context.fileCount} scope=${scope}`,
        );
      }
    });
    // Only reachable once the transaction ended without the section having
    // failed inside it, which is where `work` is assigned.
    return { work: work! };
  }

  async #runWithAdvisoryXactLock<T>(
    lockKey: string,
    contextLabel: string,
    fn: (txQuerier: Querier) => Promise<T>,
  ): Promise<T> {
    return await this.withConnection(async (queryFn) => {
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
          // client release), so we don't have a stale-lock problem. Log
          // for visibility and rethrow the original error.
          log.warn(
            `ROLLBACK after advisory-lock error for ${contextLabel} failed: ${String(rollbackErr)}`,
          );
        }
        throw err;
      }
    });
  }

  // One transaction on one pinned pool connection: BEGIN, `fn`, COMMIT, with
  // withConnection issuing the ROLLBACK when `fn` or the COMMIT throws. `fn`'s
  // statements must go through `txQuerier`; anything it runs through
  // `execute` checks out a different client and is outside the transaction.
  //
  // Postgres resolves a deadlock by aborting one participant (40P01), and a
  // serialization failure (40001) means the same thing: this attempt lost,
  // and running it again is expected to succeed. Both roll back and run `fn`
  // again from the start, up to `maxAttempts`. Any other error is thrown
  // straight away.
  async withTransaction<T>(
    fn: (txQuerier: Querier) => Promise<T>,
    opts?: TransactionOptions,
  ): Promise<T> {
    let maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.withConnection(async (queryFn) => {
          await queryFn(['BEGIN']);
          let result = await fn(queryFn);
          await queryFn(['COMMIT']);
          return result;
        });
      } catch (err: unknown) {
        let code = (err as { code?: unknown })?.code;
        if (
          attempt >= maxAttempts ||
          typeof code !== 'string' ||
          !RETRYABLE_TRANSACTION_SQLSTATES.has(code)
        ) {
          throw err;
        }
        log.warn(
          `transaction${opts?.label ? ` for ${opts.label}` : ''} rolled back on SQLSTATE ${code} (attempt ${attempt} of ${maxAttempts}); retrying: ${(err as Error).message}`,
        );
        // A short randomized pause so the transaction that won the deadlock
        // can finish before this one takes its locks again.
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * (25 + Math.random() * 50)),
        );
      }
    }
  }

  async withConnection<T>(
    fn: (
      query: (e: Expression) => Promise<Record<string, PgPrimitive>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    await this.started;

    let client = await this.pool.connect();
    let stopRecording = recordConnectionErrors(client, this.url, 'warn');
    let query = async (expression: Expression) => {
      let sql = expressionToSql(this.kind, expression);
      log.debug('search: %s trace: %j', sql.text, sql.values);
      let { rows } = await client.query(sql);
      return rows;
    };
    let released = false;
    try {
      return await fn(query);
    } catch (e) {
      // Clean up any in-progress transaction before returning the client to
      // the pool. Without this, a connection left in a dirty transaction
      // state will cause "SET TRANSACTION ISOLATION LEVEL must be called
      // before any query" errors for the next caller that picks it up.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // ROLLBACK failed — the connection is in an unrecoverable state.
        // Destroy it instead of returning it to the pool.
        log.error(
          'ROLLBACK failed during connection cleanup, destroying client: %s',
          rollbackError,
        );
        client.release(true);
        released = true;
        throw e;
      }
      client.release();
      released = true;
      throw e;
    } finally {
      stopRecording();
      if (!released) {
        client.release();
      }
    }
  }

  async getColumnNames(tableName: string): Promise<string[]> {
    await this.started;

    let result = await this.execute(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      {
        bind: [tableName],
      },
    );
    return result.map((row) => row.column_name) as string[];
  }

  private async migrateDb(enableLogging: boolean) {
    const config = postgresConfig();
    let client = new Client(
      Object.assign({}, config, { database: 'postgres' }),
    );
    recordConnectionErrors(
      client,
      'the migration bootstrap connection',
      'warn',
    );
    try {
      await client.connect();
      let response = await client.query(
        `select count(*)=1 as has_database from pg_database where datname=$1`,
        [config.database],
      );
      if (!response.rows[0].has_database) {
        try {
          await client.query(`create database ${config.database}`);
        } catch (err: any) {
          if (!err.message?.includes('violates unique constraint')) {
            throw err;
          }
          // our read and create are not atomic. If somebody elses created it in
          // between, we're fine with that.
        }
      }
    } finally {
      client.end();
    }

    // Temporary migration-name fix so renamed files don't rerun; remove after all environments
    // have picked up the corrected filenames and run the fix migration.
    await this.fixMigrationNames(config);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await migrate({
          direction: 'up',
          migrationsTable: 'migrations',
          singleTransaction: true,
          checkOrder: false,
          databaseUrl: {
            user: config.user,
            host: config.host,
            database: config.database,
            password: config.password,
            port: config.port,
          },
          count: Infinity,
          dir: join(import.meta.dirname, 'migrations'),
          // Ignore the eslint config and the `package.json` that pins this dir
          // to `type:commonjs` (the CJS migration files use `exports.up`); both
          // sit in the migrations dir but aren't migrations.
          ignorePattern: '.*\\.eslintrc\\.js|package\\.json',
          log: enableLogging ? (...args) => log.info(...args) : () => undefined,
        });
        await this.fixupEnvironmentModePermissions(config);
        return;
      } catch (err: any) {
        if (!err.message?.includes('Another migration is already running')) {
          throw err;
        }
        log.info(`saw another migration running, will retry`);
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
      }
    }
  }

  // In environment mode, migrations seed realm_user_permissions with hardcoded
  // localhost:4201/4202 URLs. Rewrite them to the Traefik hostnames so realm
  // ownership lookups work.
  private async fixupEnvironmentModePermissions(config: Config) {
    let branch = process.env.BOXEL_ENVIRONMENT;
    if (!branch) {
      return;
    }
    let slug = branch
      .toLowerCase()
      .replace(/\//g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    let client = new Client(config);
    recordConnectionErrors(
      client,
      'the environment-mode permission fixup',
      'warn',
    );
    try {
      await client.connect();
      let realmServerUrl = `http://realm-server.${slug}.localhost`;
      let realmTestUrl = `http://realm-test.${slug}.localhost`;
      // Match both http and https canonicals — realm-server speaks HTTPS in
      // local dev now, so a DB seeded after the CS-11114 flip stores
      // `https://localhost:42XX/...` permission rows; older rows can still
      // be on `http://`. The regex collapses both into the env-mode
      // Traefik hostname.
      let result = await client.query(
        `UPDATE realm_user_permissions
         SET realm_url = regexp_replace(realm_url, '^https?://localhost:4201/', $1)
         WHERE realm_url ~ '^https?://localhost:4201/'`,
        [`${realmServerUrl}/`],
      );
      if (result.rowCount && result.rowCount > 0) {
        log.info(
          `Environment mode: rewrote ${result.rowCount} permission URL(s) from localhost:4201 to ${realmServerUrl}`,
        );
      }
      let result2 = await client.query(
        `UPDATE realm_user_permissions
         SET realm_url = regexp_replace(realm_url, '^https?://localhost:4202/', $1)
         WHERE realm_url ~ '^https?://localhost:4202/'`,
        [`${realmTestUrl}/`],
      );
      if (result2.rowCount && result2.rowCount > 0) {
        log.info(
          `Environment mode: rewrote ${result2.rowCount} permission URL(s) from localhost:4202 to ${realmTestUrl}`,
        );
      }
    } finally {
      await client.end();
    }
  }

  private async fixMigrationNames(config: Config) {
    if (!migrationRenames.length) {
      return;
    }

    let client = new Client(config);
    recordConnectionErrors(client, 'the migration-rename fixup', 'warn');
    try {
      await client.connect();
      let { rows } = await client.query(
        'SELECT to_regclass($1) AS table_name',
        ['migrations'],
      );

      if (!rows[0]?.table_name) {
        return;
      }

      await client.query(buildUpdateMigrationSql(migrationRenames));
    } finally {
      await client.end();
    }
  }
}

function safeName(name: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`potentially unsafe name in SQL: ${name}`);
  }
  return name;
}
