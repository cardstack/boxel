import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
} from '@cardstack/runtime-common';
import migrate from 'node-pg-migrate';
import { join } from 'path';
import { Pool, Client } from 'pg';

import postgresConfig from './pg-config';

function config() {
  return postgresConfig({
    database: `boxel${process.env.NODE_ENV ? '_' + process.env.NODE_ENV : ''}`,
  });
}

export default class PgAdapter implements DBAdapter {
  private pool: Pool;

  constructor() {
    let { user, host, database, password, port } = config();
    console.log(`connecting to DB ${user}@${host}:${port}/${database}`);
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
    try {
      let { rows } = await client.query({ text: sql, values: opts?.bind });
      return rows;
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.result.message}:\n${sql}${
          opts?.bind ? ' with bindings: ' + JSON.stringify(opts?.bind) : ''
        }`,
        e,
      );
      throw e;
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
      log: (...args) => console.log(...args),
    });
  }
}
