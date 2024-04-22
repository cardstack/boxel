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
import { Pool, Client, type Notification, type PoolClient } from 'pg';

import postgresConfig from './pg-config';

const log = logger('pg-adapter');

function config() {
  return postgresConfig({
    database: 'boxel',
  });
}

export default class PgAdapter implements DBAdapter {
  private pool: Pool;

  constructor() {
    let { user, host, database, password, port } = config();
    log.info(`connecting to DB ${user}@${host}:${port}/${database}`);
    this.pool = new Pool({
      user,
      host,
      database,
      password,
      port,
    });
  }

  async startClient() {
    await this.migrateDb();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  async execute(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Record<string, PgPrimitive>[]> {
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
    // we have found that LISTEN/NOTIFY doesn't work reliably on connections from the
    // Pool, and this is substantiated by commentary on GitHub:
    //   https://github.com/brianc/node-postgres/issues/1543#issuecomment-353622236
    // So for listen purposes, we establish a completely separate connection.
    let c = config();
    let client = new Client({
      user: c.user,
      host: c.host,
      database: c.database,
      password: c.password,
      port: c.port,
    });
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
    fn: (connection: {
      client: PoolClient;
      query: (e: Expression) => Promise<Record<string, PgPrimitive>[]>;
    }) => Promise<T>,
  ): Promise<T> {
    let client = await this.pool.connect();
    let query = async (expression: Expression) => {
      let sql = expressionToSql(expression);
      log.debug('search: %s trace: %j', sql.text, sql.values);
      let { rows } = await client.query(sql);
      return rows;
    };
    try {
      return await fn({ query, client });
    } finally {
      client.release();
    }
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
        await client.query(`create database ${config.database}`);
      }
    } finally {
      client.end();
    }

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
  }
}

function safeName(name: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`potentially unsafe name in SQL: ${name}`);
  }
  return name;
}
