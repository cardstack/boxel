import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

import { Client as PgClient } from 'pg';
import type { RealmAction } from '../../runtime-common/index';

type RealmPermissions = Record<string, RealmAction[]>;

type FactorySupportContext = {
  matrixURL: string;
  matrixRegistrationSecret: string;
  prerenderURL: string;
};

type SynapseInstance = {
  synapseId: string;
  port: number;
  registrationSecret: string;
};

export interface FactoryRealmOptions {
  realmDir?: string;
  realmURL?: URL;
  permissions?: RealmPermissions;
  useCache?: boolean;
  cacheSalt?: string;
  templateDatabaseName?: string;
  context?: FactoryTestContext | FactorySupportContext;
  runtimeController?: FactoryRealmRuntimeController;
}

export interface FactoryRealmTemplate {
  cacheKey: string;
  templateDatabaseName: string;
  fixtureHash: string;
  cacheHit: boolean;
}

export interface FactoryTestContext extends FactorySupportContext {
  cacheKey: string;
  fixtureHash: string;
  realmDir: string;
  realmURL: string;
  templateDatabaseName: string;
}

export interface StartedFactoryRealm {
  realmDir: string;
  realmURL: URL;
  databaseName: string;
  cardURL(path: string): string;
  createBearerToken(user?: string, permissions?: RealmAction[]): string;
  authorizationHeaders(
    user?: string,
    permissions?: RealmAction[],
  ): Record<string, string>;
  stop(): Promise<void>;
}

export interface FactoryRealmRuntimeController {
  startRuntime(config: {
    realmDir: string;
    realmURL: URL;
    databaseName: string;
    migrateDB: boolean;
    fullIndexOnStartup: boolean;
    permissions: RealmPermissions;
  }): Promise<void>;
  stopRuntime(): Promise<void>;
  stop(): Promise<void>;
}

type FactoryGlobalContextHandle = {
  context: FactoryTestContext;
  stop(): Promise<void>;
};

type SpawnedProcess = ChildProcess & {
  send(message: unknown): boolean;
};

type RunningFactoryStack = {
  realmServer: SpawnedProcess;
};

const packageRoot = resolve(process.cwd());
const workspaceRoot = resolve(packageRoot, '..', '..');
const realmServerDir = resolve(packageRoot, '..', 'realm-server');
const boxelIconsDir = resolve(packageRoot, '..', 'boxel-icons');
const prepareTestPgScript = resolve(
  realmServerDir,
  'tests',
  'scripts',
  'prepare-test-pg.sh',
);
const softwareFactoryRealmScript = resolve(
  realmServerDir,
  'scripts',
  'software-factory-realm.ts',
);

const CACHE_VERSION = 4;
const REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205,
);
const DEFAULT_REALM_URL = new URL(
  process.env.SOFTWARE_FACTORY_REALM_URL ??
    `http://localhost:${REALM_SERVER_PORT}/test/`,
);
const DEFAULT_REALM_DIR = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);
const DEFAULT_HOST_URL = process.env.HOST_URL ?? 'http://localhost:4200/';
const DEFAULT_ICONS_URL = process.env.ICONS_URL ?? 'http://localhost:4206/';
const DEFAULT_PG_PORT = process.env.SOFTWARE_FACTORY_PGPORT ?? '55436';
const DEFAULT_PG_HOST = process.env.SOFTWARE_FACTORY_PGHOST ?? '127.0.0.1';
const DEFAULT_PG_USER = process.env.SOFTWARE_FACTORY_PGUSER ?? 'postgres';
const DEFAULT_MIGRATED_TEMPLATE_DB =
  process.env.SOFTWARE_FACTORY_MIGRATED_TEMPLATE_DB ??
  'boxel_migrated_template';
const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';
const REALM_SECRET_SEED = "shhh! it's a secret";
const REALM_SERVER_SECRET_SEED = "mum's the word";
const GRAFANA_SECRET = "shhh! it's a secret";
const DEFAULT_MATRIX_SERVER_USERNAME =
  process.env.SOFTWARE_FACTORY_MATRIX_SERVER_USERNAME ?? 'realm_server';
const DEFAULT_MATRIX_BROWSER_USERNAME =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
const DEFAULT_BROWSER_MATRIX_URL =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_URL ?? 'http://localhost:8008/';
const INCLUDE_SKILLS = process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1';
const DEFAULT_PERMISSIONS: RealmPermissions = {
  '*': ['read'],
  [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
};
const require = createRequire(import.meta.url);
const { sign: signJWT } =
  require('jsonwebtoken') as typeof import('jsonwebtoken');

const managedProcessStdio:
  | ['ignore', 'inherit', 'inherit', 'ipc']
  | ['ignore', 'ignore', 'ignore', 'ipc'] =
  process.env.SOFTWARE_FACTORY_DEBUG_SERVER === '1'
    ? ['ignore', 'inherit', 'inherit', 'ipc']
    : ['ignore', 'ignore', 'ignore', 'ipc'];
const TRACE_TIMINGS = process.env.SOFTWARE_FACTORY_TRACE_TIMINGS === '1';

let preparePgPromise: Promise<void> | undefined;

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!TRACE_TIMINGS) {
    return await fn();
  }

  let startedAt = nowMs();
  try {
    return await fn();
  } finally {
    let elapsedMs = nowMs() - startedAt;
    console.error(
      `[software-factory timing] ${label}: ${elapsedMs.toFixed(1)}ms`,
    );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  let record = value as Record<string, unknown>;
  let keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shouldIgnoreFixturePath(relativePath: string): boolean {
  if (relativePath === '.DS_Store') {
    return true;
  }
  return relativePath
    .split('/')
    .some((segment) =>
      [
        'node_modules',
        '.git',
        '.boxel-history',
        'playwright-report',
        'test-results',
      ].includes(segment),
    );
}

function hashRealmFixture(realmDir: string): string {
  let entries: string[] = [];

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let absolutePath = join(currentDir, entry.name);
      let relativePath = relative(realmDir, absolutePath).replace(/\\/g, '/');
      if (shouldIgnoreFixturePath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let stats = statSync(absolutePath);
      let contentsHash = createHash('sha256')
        .update(readFileSync(absolutePath))
        .digest('hex');
      entries.push(`${relativePath}:${stats.size}:${contentsHash}`);
    }
  }

  visit(realmDir);
  entries.sort();
  return hashString(entries.join('|'));
}

function templateDatabaseNameForCacheKey(cacheKey: string): string {
  return `sf_tpl_${cacheKey.slice(0, 24)}`;
}

function builderDatabaseNameForCacheKey(cacheKey: string): string {
  return `sf_bld_${cacheKey.slice(0, 16)}`;
}

function runtimeDatabaseName(): string {
  return `sf_run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function pgAdminConnectionConfig(database = 'postgres') {
  return {
    host: DEFAULT_PG_HOST,
    port: Number(DEFAULT_PG_PORT),
    user: DEFAULT_PG_USER,
    password: process.env.PGPASSWORD || undefined,
    database,
  };
}

function quotePgIdentifier(identifier: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`unsafe postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function waitUntil<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {},
): Promise<T> {
  let timeout = options.timeout ?? 30_000;
  let interval = options.interval ?? 250;
  let start = Date.now();
  while (Date.now() - start < timeout) {
    let result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(options.timeoutMessage ?? 'Timed out waiting for condition');
}

async function canConnectToPg(): Promise<boolean> {
  let client = new PgClient({
    ...pgAdminConnectionConfig(),
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // best effort cleanup
    }
  }
}

function runCommand(command: string, args: string[], cwd: string) {
  let result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PGHOST: DEFAULT_PG_HOST,
      PGPORT: DEFAULT_PG_PORT,
      PGUSER: DEFAULT_PG_USER,
    },
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(' ')}`);
  }
}

function cleanupStaleSynapseContainers() {
  let result = spawnSync(
    'docker',
    [
      'ps',
      '-aq',
      '--filter',
      'name=synapsedocker-',
      '--filter',
      'name=boxel-synapse',
    ],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    return;
  }

  let containerIds = result.stdout
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);

  if (containerIds.length === 0) {
    return;
  }

  spawnSync('docker', ['rm', '-f', ...containerIds], {
    cwd: workspaceRoot,
    stdio: 'ignore',
  });
}

function maybeRequire(specifier: string) {
  if (typeof require === 'function') {
    return require(specifier);
  }
  return undefined;
}

async function loadSynapseModule() {
  return (maybeRequire('../../matrix/docker/synapse/index') ??
    (await import('../../matrix/docker/synapse/index'))) as {
    registerUser: (
      synapse: SynapseInstance,
      username: string,
      password: string,
      admin?: boolean,
      displayName?: string,
    ) => Promise<unknown>;
    synapseStart: (
      opts?: { suppressRegistrationSecretFile?: true },
      stopExisting?: boolean,
    ) => Promise<SynapseInstance>;
    synapseStop: (id: string) => Promise<void>;
  };
}

async function loadIsolatedRealmServerModule() {
  return (maybeRequire('../../matrix/helpers/isolated-realm-server') ??
    (await import('../../matrix/helpers/isolated-realm-server'))) as {
    startPrerenderServer: () => Promise<{
      url: string;
      stop(): Promise<void>;
    }>;
  };
}

async function ensureHostReady(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(DEFAULT_HOST_URL);
  } catch (error) {
    throw new Error(
      `Host app is not reachable at ${DEFAULT_HOST_URL}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Host app is not ready at ${DEFAULT_HOST_URL}: status ${response.status}`,
    );
  }
}

async function ensureIconsReady(): Promise<{
  stop?: () => Promise<void>;
}> {
  try {
    let response = await fetch(DEFAULT_ICONS_URL);
    if (response.ok) {
      return {};
    }
  } catch {
    // fall through and start the local icon server
  }

  let child = spawn('pnpm', ['serve'], {
    cwd: boxelIconsDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs = `${logs}${String(chunk)}`.slice(-20_000);
  });
  child.stderr?.on('data', (chunk) => {
    logs = `${logs}${String(chunk)}`.slice(-20_000);
  });

  await waitUntil(
    async () => {
      try {
        let response = await fetch(DEFAULT_ICONS_URL);
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: 30_000,
      interval: 250,
      timeoutMessage: `Timed out waiting for icons server at ${DEFAULT_ICONS_URL}\n${logs}`,
    },
  );

  return {
    async stop() {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          // best effort cleanup
        }
      }
    },
  };
}

async function ensurePgReady(): Promise<void> {
  if (!preparePgPromise) {
    preparePgPromise = (async () => {
      if (await canConnectToPg()) {
        return;
      }
      runCommand('bash', [prepareTestPgScript], workspaceRoot);
      await waitUntil(() => canConnectToPg(), {
        timeout: 30_000,
        interval: 250,
        timeoutMessage: `Timed out waiting for Postgres on ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
      });
    })().catch((error) => {
      preparePgPromise = undefined;
      throw error;
    });
  }

  await preparePgPromise;
}

async function databaseExists(databaseName: string): Promise<boolean> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    let result = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [databaseName],
    );
    return Boolean(result.rows[0]?.exists);
  } finally {
    await client.end();
  }
}

async function dropDatabase(databaseName: string): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
    );
  } finally {
    await client.end();
  }
}

async function cloneDatabaseFromTemplate(
  templateDatabaseName: string,
  databaseName: string,
): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(databaseName)} TEMPLATE ${quotePgIdentifier(
        templateDatabaseName,
      )}`,
    );
  } finally {
    await client.end();
  }
}

async function createTemplateSnapshot(
  sourceDatabaseName: string,
  templateDatabaseName: string,
): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [templateDatabaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quotePgIdentifier(templateDatabaseName)}`,
    );
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(templateDatabaseName)} TEMPLATE ${quotePgIdentifier(
        sourceDatabaseName,
      )}`,
    );
    await client.query(
      `ALTER DATABASE ${quotePgIdentifier(templateDatabaseName)} WITH IS_TEMPLATE true`,
    );
  } finally {
    await client.end();
  }
}

async function seedRealmPermissions(
  databaseName: string,
  realmURL: URL,
  permissions: RealmPermissions,
): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig(databaseName));
  try {
    await client.connect();
    await client.query('BEGIN');

    for (let [username, actions] of Object.entries(permissions)) {
      if (!actions || actions.length === 0) {
        await client.query(
          `DELETE FROM realm_user_permissions
           WHERE realm_url = $1 AND username = $2`,
          [realmURL.href, username],
        );
        continue;
      }

      if (username !== '*') {
        await client.query(
          `INSERT INTO users (matrix_user_id)
           VALUES ($1)
           ON CONFLICT (matrix_user_id) DO NOTHING`,
          [username],
        );
      }

      await client.query(
        `INSERT INTO realm_user_permissions (
          realm_url,
          username,
          read,
          write,
          realm_owner
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (realm_url, username) DO UPDATE
        SET read = EXCLUDED.read,
            write = EXCLUDED.write,
            realm_owner = EXCLUDED.realm_owner`,
        [
          realmURL.href,
          username,
          actions.includes('read'),
          actions.includes('write'),
          actions.includes('realm-owner'),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // best effort cleanup
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function waitForQueueIdle(databaseName: string): Promise<void> {
  await waitUntil(
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        let {
          rows: [{ count: unfulfilledJobs }],
        } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'unfulfilled'`,
        );
        let {
          rows: [{ count: activeReservations }],
        } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM job_reservations WHERE completed_at IS NULL`,
        );
        return unfulfilledJobs === 0 && activeReservations === 0;
      } finally {
        await client.end();
      }
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMessage: `Timed out waiting for queue to become idle in ${databaseName}`,
    },
  );
}

function browserPassword(username: string): string {
  let cleanUsername = username.replace(/^@/, '').replace(/:.*$/, '');
  return createHash('sha256')
    .update(cleanUsername)
    .update(REALM_SECRET_SEED)
    .digest('hex');
}

async function ensureSupportUsers(synapse: SynapseInstance): Promise<void> {
  let { registerUser } = await loadSynapseModule();

  for (let username of [
    DEFAULT_MATRIX_SERVER_USERNAME,
    DEFAULT_MATRIX_BROWSER_USERNAME,
    'test_realm',
    'base_realm',
    ...(INCLUDE_SKILLS ? ['skills_realm'] : []),
  ]) {
    await registerUser(synapse, username, browserPassword(username));
  }
}

function parseFactoryContext(): FactoryTestContext | undefined {
  let raw = process.env.SOFTWARE_FACTORY_CONTEXT;
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as FactoryTestContext;
}

function hasTemplateDatabaseName(
  context: FactorySupportContext | FactoryTestContext,
): context is FactoryTestContext {
  return 'templateDatabaseName' in context;
}

function buildRealmToken(
  realmURL: URL,
  user = DEFAULT_REALM_OWNER,
  permissions = DEFAULT_PERMISSIONS[DEFAULT_REALM_OWNER] ?? [
    'read',
    'write',
    'realm-owner',
  ],
): string {
  return signJWT(
    {
      user,
      realm: realmURL.href,
      permissions,
      sessionRoom: `software-factory-session-room-for-${user}`,
      realmServerURL: new URL(realmURL.origin).href,
    },
    REALM_SECRET_SEED,
    { expiresIn: '7d' },
  );
}

function createProcessExitPromise(
  proc: SpawnedProcess,
  label: string,
): Promise<never> {
  return new Promise((_, reject) => {
    proc.once('exit', (code, signal) => {
      reject(
        new Error(
          `${label} exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    });
    proc.once('error', reject);
  });
}

function isMessageType(
  message: unknown,
  type: string,
): message is { type: string; error?: string } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    (message as { type: unknown }).type === type
  );
}

async function waitForReady(
  proc: SpawnedProcess,
  label: string,
): Promise<void> {
  let timedOut = await Promise.race([
    new Promise<void>((resolve) => {
      let onMessage = (message: unknown) => {
        if (message === 'ready') {
          proc.off('message', onMessage);
          resolve();
        }
      };
      proc.on('message', onMessage);
    }),
    createProcessExitPromise(proc, label),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 120_000)),
  ]);

  if (timedOut) {
    throw new Error(`Timed out waiting for ${label} to start`);
  }
}

async function waitForTypedProcessMessage(
  proc: SpawnedProcess,
  {
    label,
    successType,
    errorType = 'runtime-error',
    timeoutMs = 120_000,
  }: {
    label: string;
    successType: string;
    errorType?: string;
    timeoutMs?: number;
  },
): Promise<void> {
  let timedOut = await Promise.race([
    new Promise<void>((resolve, reject) => {
      let onMessage = (message: unknown) => {
        if (isMessageType(message, successType)) {
          proc.off('message', onMessage);
          resolve();
          return;
        }
        if (isMessageType(message, errorType)) {
          proc.off('message', onMessage);
          reject(
            new Error(
              `${label} failed: ${message.error ?? 'unknown runtime error'}`,
            ),
          );
        }
      };
      proc.on('message', onMessage);
    }),
    createProcessExitPromise(proc, label),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
  ]);

  if (timedOut) {
    throw new Error(`Timed out waiting for ${label}`);
  }
}

async function stopManagedProcess(proc: SpawnedProcess): Promise<void> {
  if (proc.exitCode !== null) {
    return;
  }
  let stopped = new Promise<void>((resolve) => {
    let onMessage = (message: unknown) => {
      if (message === 'stopped') {
        proc.off('message', onMessage);
        resolve();
      }
    };
    proc.on('message', onMessage);
  });
  proc.send('stop');
  await Promise.race([
    stopped,
    new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
  ]);
  proc.send('kill');
}

async function startIsolatedRealmStack({
  realmDir,
  realmURL,
  databaseName,
  context,
  migrateDB,
  fullIndexOnStartup,
  permissions,
}: {
  realmDir: string;
  realmURL: URL;
  databaseName: string;
  context: FactorySupportContext;
  migrateDB: boolean;
  fullIndexOnStartup: boolean;
  permissions: RealmPermissions;
}): Promise<RunningFactoryStack> {
  let env = {
    ...process.env,
    PGHOST: DEFAULT_PG_HOST,
    PGPORT: DEFAULT_PG_PORT,
    PGUSER: DEFAULT_PG_USER,
    PGDATABASE: databaseName,
    NODE_NO_WARNINGS: '1',
    NODE_ENV: 'test',
    REALM_SERVER_SECRET_SEED,
    REALM_SECRET_SEED,
    GRAFANA_SECRET,
    MATRIX_URL: context.matrixURL,
    MATRIX_REGISTRATION_SHARED_SECRET: context.matrixRegistrationSecret,
    REALM_SERVER_MATRIX_USERNAME: DEFAULT_MATRIX_SERVER_USERNAME,
    REALM_SERVER_FULL_INDEX_ON_STARTUP: String(fullIndexOnStartup),
    LOW_CREDIT_THRESHOLD: '2000',
    PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
    PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
    SOFTWARE_FACTORY_REALM_DIR: realmDir,
    SOFTWARE_FACTORY_REALM_URL: realmURL.href,
    SOFTWARE_FACTORY_DATABASE_NAME: databaseName,
    SOFTWARE_FACTORY_MATRIX_URL: context.matrixURL,
    SOFTWARE_FACTORY_MATRIX_REGISTRATION_SECRET:
      context.matrixRegistrationSecret,
    SOFTWARE_FACTORY_PRERENDER_URL: context.prerenderURL,
    SOFTWARE_FACTORY_PERMISSIONS: JSON.stringify(permissions),
    SOFTWARE_FACTORY_FULL_INDEX_ON_STARTUP: String(fullIndexOnStartup),
    SOFTWARE_FACTORY_AUTO_MIGRATE: String(migrateDB),
  };

  let realmServer = spawn(
    'ts-node',
    ['--transpileOnly', softwareFactoryRealmScript],
    {
      cwd: realmServerDir,
      env,
      stdio: managedProcessStdio,
    },
  ) as SpawnedProcess;

  try {
    await timed('start isolated realm stack', async () => {
      await waitForReady(realmServer, 'realm server');
    });
  } catch (error) {
    try {
      await stopManagedProcess(realmServer);
    } catch {
      // best effort cleanup
    }
    throw error;
  }

  return {
    realmServer,
  };
}

export async function startFactoryRealmRuntimeController(
  context: FactorySupportContext | FactoryTestContext = getFactoryTestContext(),
): Promise<FactoryRealmRuntimeController> {
  let env = {
    ...process.env,
    PGHOST: DEFAULT_PG_HOST,
    PGPORT: DEFAULT_PG_PORT,
    PGUSER: DEFAULT_PG_USER,
    NODE_NO_WARNINGS: '1',
    NODE_ENV: 'test',
    REALM_SERVER_SECRET_SEED,
    REALM_SECRET_SEED,
    GRAFANA_SECRET,
    MATRIX_URL: context.matrixURL,
    MATRIX_REGISTRATION_SHARED_SECRET: context.matrixRegistrationSecret,
    REALM_SERVER_MATRIX_USERNAME: DEFAULT_MATRIX_SERVER_USERNAME,
    LOW_CREDIT_THRESHOLD: '2000',
    PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
    PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
    SOFTWARE_FACTORY_MATRIX_URL: context.matrixURL,
    SOFTWARE_FACTORY_MATRIX_REGISTRATION_SECRET:
      context.matrixRegistrationSecret,
    SOFTWARE_FACTORY_PRERENDER_URL: context.prerenderURL,
  };

  let realmServer = spawn(
    'ts-node',
    ['--transpileOnly', softwareFactoryRealmScript],
    {
      cwd: realmServerDir,
      env,
      stdio: managedProcessStdio,
    },
  ) as SpawnedProcess;

  await waitForReady(realmServer, 'realm runtime controller');

  return {
    async startRuntime(config) {
      realmServer.send({
        type: 'start-runtime',
        payload: {
          realmDir: config.realmDir,
          realmURL: config.realmURL.href,
          databaseName: config.databaseName,
          permissions: config.permissions,
          fullIndexOnStartup: config.fullIndexOnStartup,
          autoMigrate: config.migrateDB,
        },
      });
      await timed('start isolated realm stack', async () => {
        await waitForTypedProcessMessage(realmServer, {
          label: 'runtime realm stack',
          successType: 'runtime-started',
        });
      });
    },
    async stopRuntime() {
      if (realmServer.exitCode !== null) {
        return;
      }
      realmServer.send({ type: 'stop-runtime' });
      await waitForTypedProcessMessage(realmServer, {
        label: 'runtime realm stack shutdown',
        successType: 'runtime-stopped',
        timeoutMs: 15_000,
      });
    },
    async stop() {
      await stopManagedProcess(realmServer);
    },
  };
}

async function stopIsolatedRealmStack(
  stack: RunningFactoryStack,
): Promise<void> {
  let cleanupError: unknown;

  try {
    await stopManagedProcess(stack.realmServer);
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

async function buildTemplateDatabase({
  realmDir,
  realmURL,
  permissions,
  context,
  cacheKey,
  templateDatabaseName,
}: {
  realmDir: string;
  realmURL: URL;
  permissions: RealmPermissions;
  context: FactorySupportContext;
  cacheKey: string;
  templateDatabaseName: string;
}): Promise<void> {
  let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);
  let hasMigratedTemplate = await timed('check migrated template exists', () =>
    databaseExists(DEFAULT_MIGRATED_TEMPLATE_DB),
  );

  await timed('drop template database', () =>
    dropDatabase(templateDatabaseName),
  );
  await timed('drop builder database', () => dropDatabase(builderDatabaseName));

  if (hasMigratedTemplate) {
    await timed('clone builder database from migrated template', () =>
      cloneDatabaseFromTemplate(
        DEFAULT_MIGRATED_TEMPLATE_DB,
        builderDatabaseName,
      ),
    );
  }

  await timed('seed realm permissions', () =>
    seedRealmPermissions(builderDatabaseName, realmURL, permissions),
  );

  let stack = await startIsolatedRealmStack({
    realmDir,
    realmURL,
    databaseName: builderDatabaseName,
    context,
    migrateDB: !hasMigratedTemplate,
    fullIndexOnStartup: true,
    permissions,
  });

  try {
    await timed('wait for queue idle', () =>
      waitForQueueIdle(builderDatabaseName),
    );
  } finally {
    await timed('stop isolated realm stack', () =>
      stopIsolatedRealmStack(stack),
    );
  }

  await timed('create template snapshot', () =>
    createTemplateSnapshot(builderDatabaseName, templateDatabaseName),
  );
  await timed('drop builder database after snapshot', () =>
    dropDatabase(builderDatabaseName),
  );
}

async function startFactorySupportServices(): Promise<{
  context: FactorySupportContext;
  stop(): Promise<void>;
}> {
  await timed('ensure pg ready', () => ensurePgReady());
  await timed('ensure host ready', () => ensureHostReady());
  let icons = await timed('ensure icons ready', () => ensureIconsReady());
  await timed('cleanup stale synapse containers', async () => {
    cleanupStaleSynapseContainers();
  });
  let { synapseStart, synapseStop } = await loadSynapseModule();
  let { startPrerenderServer } = await loadIsolatedRealmServerModule();

  let synapse = await timed('start synapse', () =>
    synapseStart({ suppressRegistrationSecretFile: true }, true),
  );
  await timed('ensure support users', () => ensureSupportUsers(synapse));
  let prerender = await timed('start prerender server', () =>
    startPrerenderServer(),
  );
  let matrixURL =
    process.env.SOFTWARE_FACTORY_MATRIX_URL ?? DEFAULT_BROWSER_MATRIX_URL;

  return {
    context: {
      matrixURL,
      matrixRegistrationSecret: synapse.registrationSecret,
      prerenderURL: prerender.url,
    },
    async stop() {
      await prerender.stop();
      await synapseStop(synapse.synapseId);
      await icons.stop?.();
    },
  };
}

export function getFactoryTestContext(): FactoryTestContext {
  let context = parseFactoryContext();
  if (!context) {
    throw new Error('SOFTWARE_FACTORY_CONTEXT is not defined');
  }
  return context;
}

export async function startFactoryGlobalContext(
  options: FactoryRealmOptions = {},
): Promise<FactoryGlobalContextHandle> {
  let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
  let realmURL = new URL((options.realmURL ?? DEFAULT_REALM_URL).href);
  let support = await timed('start support services', () =>
    startFactorySupportServices(),
  );
  try {
    let template = await timed('ensure factory realm template', () =>
      ensureFactoryRealmTemplate({
        ...options,
        realmDir,
        realmURL,
        context: support.context,
      }),
    );

    let context: FactoryTestContext = {
      ...support.context,
      cacheKey: template.cacheKey,
      fixtureHash: template.fixtureHash,
      realmDir,
      realmURL: realmURL.href,
      templateDatabaseName: template.templateDatabaseName,
    };

    return {
      context,
      stop: support.stop,
    };
  } catch (error) {
    await support.stop();
    throw error;
  }
}

export async function ensureFactoryRealmTemplate(
  options: FactoryRealmOptions = {},
): Promise<FactoryRealmTemplate> {
  let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
  let realmURL = new URL((options.realmURL ?? DEFAULT_REALM_URL).href);
  let permissions = options.permissions ?? DEFAULT_PERMISSIONS;
  let fixtureHash = hashRealmFixture(realmDir);
  let cacheKey = hashString(
    stableStringify({
      version: CACHE_VERSION,
      realmURL: realmURL.href,
      permissions,
      fixtureHash,
      cacheSalt:
        options.cacheSalt ?? process.env.SOFTWARE_FACTORY_CACHE_SALT ?? null,
    }),
  );
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);

  let ownedSupport:
    | {
        context: FactorySupportContext;
        stop(): Promise<void>;
      }
    | undefined;
  let context = options.context;
  if (!context) {
    ownedSupport = await startFactorySupportServices();
    context = ownedSupport.context;
  }

  try {
    if (await databaseExists(templateDatabaseName)) {
      return {
        cacheKey,
        templateDatabaseName,
        fixtureHash,
        cacheHit: true,
      };
    }

    await buildTemplateDatabase({
      realmDir,
      realmURL,
      permissions,
      context,
      cacheKey,
      templateDatabaseName,
    });

    return {
      cacheKey,
      templateDatabaseName,
      fixtureHash,
      cacheHit: false,
    };
  } finally {
    await ownedSupport?.stop();
  }
}

export async function startFactoryRealmServer(
  options: FactoryRealmOptions = {},
): Promise<StartedFactoryRealm> {
  let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
  let realmURL = new URL((options.realmURL ?? DEFAULT_REALM_URL).href);
  let templateDatabaseName = options.templateDatabaseName;

  let ownedGlobalContext: FactoryGlobalContextHandle | undefined;
  let context = options.context ?? parseFactoryContext();
  if (!context) {
    ownedGlobalContext = await timed('start factory global context', () =>
      startFactoryGlobalContext({
        ...options,
        realmDir,
        realmURL,
      }),
    );
    context = ownedGlobalContext.context;
  }

  if (!templateDatabaseName) {
    templateDatabaseName = hasTemplateDatabaseName(context)
      ? context.templateDatabaseName
      : (
          await timed('ensure factory realm template', () =>
            ensureFactoryRealmTemplate({
              ...options,
              realmDir,
              realmURL,
              context,
            }),
          )
        ).templateDatabaseName;
  }

  let databaseName = runtimeDatabaseName();
  await timed('drop runtime database', () => dropDatabase(databaseName));
  await timed('clone runtime database from template', () =>
    cloneDatabaseFromTemplate(templateDatabaseName, databaseName),
  );

  let runtimeController = options.runtimeController;
  let stack: RunningFactoryStack | undefined;
  try {
    if (runtimeController) {
      await timed('start runtime realm stack', () =>
        runtimeController.startRuntime({
          realmDir,
          realmURL,
          databaseName,
          migrateDB: false,
          fullIndexOnStartup: false,
          permissions: options.permissions ?? DEFAULT_PERMISSIONS,
        }),
      );
    } else {
      stack = await timed('start runtime realm stack', () =>
        startIsolatedRealmStack({
          realmDir,
          realmURL,
          databaseName,
          context,
          migrateDB: false,
          fullIndexOnStartup: false,
          permissions: options.permissions ?? DEFAULT_PERMISSIONS,
        }),
      );
    }
  } catch (error) {
    await dropDatabase(databaseName).catch(() => undefined);
    await ownedGlobalContext?.stop().catch(() => undefined);
    throw error;
  }

  return {
    realmDir,
    realmURL,
    databaseName,
    cardURL(path: string) {
      return new URL(path, realmURL).href;
    },
    createBearerToken(user = DEFAULT_REALM_OWNER, permissions?: RealmAction[]) {
      return buildRealmToken(realmURL, user, permissions);
    },
    authorizationHeaders(user?: string, permissions?: RealmAction[]) {
      return {
        Authorization: `Bearer ${buildRealmToken(realmURL, user, permissions)}`,
      };
    },
    async stop() {
      let cleanupError: unknown;

      try {
        if (runtimeController) {
          await runtimeController.stopRuntime();
        } else if (stack) {
          await stopIsolatedRealmStack(stack);
        }
      } catch (error) {
        cleanupError ??= error;
      }

      try {
        await dropDatabase(databaseName);
      } catch (error) {
        cleanupError ??= error;
      }

      try {
        await ownedGlobalContext?.stop();
      } catch (error) {
        cleanupError ??= error;
      }

      if (cleanupError) {
        throw cleanupError;
      }
    },
  };
}

export async function fetchRealmCardJson(
  path: string,
  options: FactoryRealmOptions = {},
) {
  let runtime = await startFactoryRealmServer(options);
  try {
    let response = await fetch(runtime.cardURL(path), {
      headers: {
        Accept: 'application/vnd.card+json',
      },
    });
    return {
      status: response.status,
      body: await response.text(),
      url: response.url,
    };
  } finally {
    await runtime.stop();
  }
}
