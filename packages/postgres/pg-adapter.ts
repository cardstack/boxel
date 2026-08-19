import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
  type Expression,
  type Querier,
  expressionToSql,
  logger,
  param,
} from '@cardstack/runtime-common';
import { createHash } from 'crypto';
import nodePgMigrate, { type RunnerOption } from 'node-pg-migrate';
import { join } from 'path';
import { Pool, Client, type Notification } from 'pg';

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

const log = logger('pg-adapter');

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
  // cancelRunningJobsInConcurrencyGroup); when callers pass `txQuerier` to
  // those helpers, all their writes commit or roll back together with the
  // advisory lock's own transaction. Queries `fn` issues through the shared
  // dbAdapter still go via separate pool connections and are NOT part of
  // this transaction. The data-plane mutation paths in runtime-common
  // (CS-11125) intentionally do not consume `txQuerier`: their inner work
  // (writing files via the FS adapter, enqueuing indexing jobs, broadcasting
  // NOTIFY events) is not transactional with the lock-holder's connection.
  // The lock there serves only to serialize concurrent same-URL writers
  // across replicas, not to group DB statements into a single tx.
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
  // that also takes the lock must invoke the unlocked inner variant (e.g.
  // realm.ts uses `_batchWriteUnlocked` inside its own withWriteLock).
  async withWriteLock<T>(
    realmUrl: string,
    fn: (txQuerier: Querier | undefined) => Promise<T>,
  ): Promise<T> {
    const lockKey = hashRealmUrlForAdvisoryLock(realmUrl);
    return await this.#runWithAdvisoryXactLock(lockKey, realmUrl, fn);
  }

  // Per-matrix-user serialization barrier for billable upstream proxy calls.
  // Two concurrent requests from the same matrix user — including across
  // replicas with no stickiness — must not both kick off an upstream call
  // before the prior request's cost row has landed in the credits ledger.
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
  // by indexing / federated-search), and the critical section spans the
  // upstream LLM call (potentially tens of seconds on streaming). Without
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
  // Inner DB calls (validateCredits, saveUsageCost) run via the shared
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

  async withConnection<T>(
    fn: (
      query: (e: Expression) => Promise<Record<string, PgPrimitive>[]>,
    ) => Promise<T>,
  ): Promise<T> {
    await this.started;

    let client = await this.pool.connect();
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
