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

import postgresConfig from './pg-config';

const log = logger('pg-adapter');

function config() {
  return postgresConfig({
    database: 'boxel',
  });
}

type Config = ReturnType<typeof config>;

export default class PgAdapter implements DBAdapter {
  #isClosed = false;
  private pool: Pool;
  private started = this.#startClient();
  private config: Config;

  constructor() {
    this.config = config();
    let { user, host, database, password, port } = this.config;
    log.info(`connecting to DB ${this.url}`);
    this.pool = new Pool({
      user,
      host,
      database,
      password,
      port,
    });
    // This is for testing purposes so that we can debug the DB
    (globalThis as any).__dbAdapter = this;
  }

  get isClosed() {
    return this.#isClosed;
  }

  get url() {
    let { user, host, database, port } = this.config;
    return `${user}@${host}:${port}/${database}`;
  }

  async #startClient() {
    await this.migrateDb();
  }

  async close() {
    log.info(`closing ${this.url}`);
    this.#isClosed = true;
    await this.started;
    await this.pool.end();
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
      let sql = expressionToSql(expression);
      log.debug('search: %s trace: %j', sql.text, sql.values);
      let { rows } = await client.query(sql);
      return rows;
    };
    try {
      return await fn(query);
    } finally {
      client.release();
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

  private async migrateDb() {
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
          log: (...args) => log.info(...args),
        });
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
}

function safeName(name: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`potentially unsafe name in SQL: ${name}`);
  }
  return name;
}
