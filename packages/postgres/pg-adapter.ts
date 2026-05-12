import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
  type Expression,
  expressionToSql,
  logger,
} from '@cardstack/runtime-common';
import migrate from 'node-pg-migrate';
import { join } from 'path';
import { Pool, Client, type Notification } from 'pg';

import { postgresConfig } from './pg-config';
import migrationNameFixes from './scripts/migration-name-fixes.js';

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
          dir: join(__dirname, 'migrations'),
          ignorePattern: '.*\\.eslintrc\\.js',
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
