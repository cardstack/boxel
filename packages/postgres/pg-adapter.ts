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

function configuredPoolMax(): number | undefined {
  let rawValue = process.env.PG_POOL_MAX;
  if (!rawValue) {
    return undefined;
  }

  let value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export type NotificationHandler = (notification: Notification) => void;

export interface NotificationSubscription {
  unsubscribe(): Promise<void>;
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
  #subscribers = new Map<string, Set<NotificationHandler>>();

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
      ...(max ? { max } : {}),
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
    if (this.#notificationClient) {
      const client = this.#notificationClient;
      this.#notificationClient = undefined;
      this.#subscribers.clear();
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
  // channel is removed. Concurrent subscribes are safe.
  async subscribe(
    channel: string,
    handler: NotificationHandler,
  ): Promise<NotificationSubscription> {
    await this.started;
    if (this.#isClosed) {
      throw new Error('PgAdapter is closed');
    }
    const client = await this.#ensureNotificationClient();
    let set = this.#subscribers.get(channel);
    const isFirst = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.#subscribers.set(channel, set);
    }
    set.add(handler);
    if (isFirst) {
      try {
        await client.query(`LISTEN ${safeName(channel)}`);
      } catch (err) {
        // Roll back the bookkeeping so a retry is clean.
        set.delete(handler);
        if (set.size === 0) {
          this.#subscribers.delete(channel);
        }
        throw err;
      }
    }
    let unsubscribed = false;
    return {
      unsubscribe: async () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        const subs = this.#subscribers.get(channel);
        if (!subs) {
          return;
        }
        subs.delete(handler);
        if (subs.size > 0) {
          return;
        }
        this.#subscribers.delete(channel);
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
        const handlers = this.#subscribers.get(n.channel);
        if (!handlers) {
          return;
        }
        for (const h of [...handlers]) {
          try {
            h(n);
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
      let result = await client.query(
        `UPDATE realm_user_permissions
         SET realm_url = regexp_replace(realm_url, '^http://localhost:4201/', $1)
         WHERE realm_url LIKE 'http://localhost:4201/%'`,
        [`${realmServerUrl}/`],
      );
      if (result.rowCount && result.rowCount > 0) {
        log.info(
          `Environment mode: rewrote ${result.rowCount} permission URL(s) from localhost:4201 to ${realmServerUrl}`,
        );
      }
      let result2 = await client.query(
        `UPDATE realm_user_permissions
         SET realm_url = regexp_replace(realm_url, '^http://localhost:4202/', $1)
         WHERE realm_url LIKE 'http://localhost:4202/%'`,
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
