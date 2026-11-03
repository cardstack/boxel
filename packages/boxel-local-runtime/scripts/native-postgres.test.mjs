import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { initializeLocalPostgres } from '../../realm-server/lib/local-postgres.ts';
import { preparePostgresSocketDirectory } from '../src/postgres-socket.ts';

const binaryDirectory = process.env.BOXEL_TEST_POSTGRES_BIN;
test(
  'migrates and queries real isolated Postgres 16 without a TCP listener',
  { skip: !binaryDirectory, timeout: 120000 },
  async () => {
    const root = await mkdtemp('/tmp/boxel-managed-pg-');
    let child;
    let client;
    let socket;
    try {
      const dataDirectory = path.join(root, 'data');
      const password = randomBytes(32).toString('hex');
      await initializeLocalPostgres({
        binaryDirectory,
        dataDirectory,
        password,
      });
      socket = await preparePostgresSocketDirectory(root);
      child = spawn(
        path.join(binaryDirectory, 'postgres'),
        [
          '-D',
          dataDirectory,
          '-k',
          socket,
          '-p',
          '5432',
          '-h',
          '',
          '-c',
          'shared_buffers=16MB',
          '-c',
          'max_connections=20',
        ],
        { stdio: 'ignore' },
      );
      let startupError;
      child.on('error', (error) => {
        startupError = error;
      });
      const require = createRequire(
        new URL('../../postgres/package.json', import.meta.url),
      );
      const { Client } = require('pg');
      const config = {
        user: 'postgres',
        host: socket,
        port: 5432,
        database: 'postgres',
        password,
      };
      for (let attempt = 0; attempt < 200; attempt++) {
        if (startupError || child.exitCode !== null)
          throw new Error('Isolated Postgres failed to start');
        const probe = new Client(config);
        probe.on('error', () => {});
        try {
          await probe.connect();
          await probe.end();
          break;
        } catch {
          await probe.end().catch(() => {});
          if (attempt === 199)
            throw new Error('Isolated Postgres did not become ready');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const migrationModule = require('node-pg-migrate');
      const migrate = migrationModule.default ?? migrationModule;
      await migrate({
        direction: 'up',
        migrationsTable: 'migrations',
        singleTransaction: true,
        checkOrder: false,
        databaseUrl: config,
        count: Infinity,
        dir: fileURLToPath(
          new URL('../../postgres/migrations/', import.meta.url),
        ),
        ignorePattern: '.*\\.eslintrc\\.js|package\\.json',
        log: () => {},
      });
      client = new Client(config);
      await client.connect();
      assert.equal(
        (
          await client.query('show server_version_num')
        ).rows[0].server_version_num.slice(0, 2),
        '16',
      );
      assert.equal(
        (await client.query('show listen_addresses')).rows[0].listen_addresses,
        '',
      );
      assert.ok(
        Number(
          (await client.query('select count(*) from migrations')).rows[0].count,
        ) > 0,
      );
      assert.equal(
        (
          await client.query(
            "select to_regclass('public.realm_user_permissions') is not null as found",
          )
        ).rows[0].found,
        true,
      );
      await client.query(
        'create table managed_environment_acceptance (id int primary key, value text not null)',
      );
      await client.query(
        'insert into managed_environment_acceptance values ($1, $2)',
        [1, 'fork only'],
      );
      assert.deepEqual(
        (await client.query('select * from managed_environment_acceptance'))
          .rows,
        [{ id: 1, value: 'fork only' }],
      );
    } finally {
      await client?.end();
      if (child?.pid && child.exitCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
          }, 10000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill('SIGTERM');
        });
      }
      if (socket) await rm(socket, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  },
);
