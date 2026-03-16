import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type { StdioOptions } from 'node:child_process';

import fsExtra from 'fs-extra';
import jwt from 'jsonwebtoken';
import { Client as PgClient } from 'pg';

type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';
const { copySync, ensureDirSync } = fsExtra;

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

type FactoryGlobalContextHandle = {
  context: FactoryTestContext;
  stop(): Promise<void>;
};

type SpawnedProcess = ChildProcess & {
  send(message: string): boolean;
};

type RunningFactoryStack = {
  realmServer: SpawnedProcess;
  workerManager: SpawnedProcess;
  compatProxy?: {
    stop(): Promise<void>;
  };
  rootDir: string;
};

const packageRoot = resolve(process.cwd());
const workspaceRoot = resolve(packageRoot, '..', '..');
const realmServerDir = resolve(packageRoot, '..', 'realm-server');
const baseRealmDir = resolve(packageRoot, '..', 'base');
const skillsRealmDir = resolve(packageRoot, '..', 'skills-realm', 'contents');
const sourceRealmDir = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_SOURCE_REALM_DIR ?? 'realm',
);
const boxelIconsDir = resolve(packageRoot, '..', 'boxel-icons');
const prepareTestPgScript = resolve(
  realmServerDir,
  'tests',
  'scripts',
  'prepare-test-pg.sh',
);

const CACHE_VERSION = 6;
const REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4205,
);
const COMPAT_REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_COMPAT_REALM_PORT ?? 4201,
);
const WORKER_MANAGER_PORT = Number(
  process.env.SOFTWARE_FACTORY_WORKER_MANAGER_PORT ?? 4232,
);
const DEFAULT_REALM_URL = new URL(
  process.env.SOFTWARE_FACTORY_REALM_URL ??
    `http://localhost:${REALM_SERVER_PORT}/test/`,
);
const LOCAL_SOFTWARE_FACTORY_SOURCE_URL = new URL(
  `http://localhost:${REALM_SERVER_PORT}/public-software-factory-source/`,
);
const DEFAULT_REALM_DIR = resolve(
  packageRoot,
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'test-fixtures/darkfactory-adopter',
);
const DEFAULT_HOST_URL = process.env.HOST_URL ?? 'http://localhost:4200/';
const DEFAULT_ICONS_URL = process.env.ICONS_URL ?? 'http://localhost:4206/';
const DEFAULT_ICONS_PROBE_URL = new URL(
  '@cardstack/boxel-icons/v1/icons/code.js',
  DEFAULT_ICONS_URL,
).href;
const DEFAULT_PG_PORT = process.env.SOFTWARE_FACTORY_PGPORT ?? '55436';
const DEFAULT_PG_HOST = process.env.SOFTWARE_FACTORY_PGHOST ?? '127.0.0.1';
const DEFAULT_PG_USER = process.env.SOFTWARE_FACTORY_PGUSER ?? 'postgres';
const DEFAULT_MIGRATED_TEMPLATE_DB =
  process.env.SOFTWARE_FACTORY_MIGRATED_TEMPLATE_DB ??
  'boxel_migrated_template';
const DEFAULT_REALM_LOG_LEVELS =
  process.env.SOFTWARE_FACTORY_REALM_LOG_LEVELS ??
  '*=info,realm:requests=warn,realm-index-updater=debug,index-runner=debug,index-perf=debug,index-writer=debug,worker=debug,worker-manager=debug,realm=debug,perf=debug';
const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';
const REALM_SECRET_SEED = "shhh! it's a secret";
const REALM_SERVER_SECRET_SEED = "mum's the word";
const GRAFANA_SECRET = "shhh! it's a secret";
const DEFAULT_MATRIX_SERVER_USERNAME =
  process.env.SOFTWARE_FACTORY_MATRIX_SERVER_USERNAME ?? 'realm_server';
const DEFAULT_MATRIX_BROWSER_USERNAME =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
const INCLUDE_SKILLS = process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1';
const DEFAULT_PERMISSIONS: RealmPermissions = {
  '*': ['read'],
  [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
};
const DEFAULT_SOURCE_REALM_PERMISSIONS: RealmPermissions = {
  '*': ['read'],
  [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
};
const managedProcessStdio: StdioOptions =
  process.env.SOFTWARE_FACTORY_DEBUG_SERVER === '1'
    ? (['ignore', 'inherit', 'inherit', 'ipc'] as const)
    : (['ignore', 'pipe', 'pipe', 'ipc'] as const);
const DEFAULT_REALM_STARTUP_TIMEOUT_MS = Number(
  process.env.SOFTWARE_FACTORY_REALM_STARTUP_TIMEOUT_MS ?? 120_000,
);
const FULL_INDEX_REALM_STARTUP_TIMEOUT_MS = Number(
  process.env.SOFTWARE_FACTORY_FULL_INDEX_REALM_STARTUP_TIMEOUT_MS ?? 600_000,
);

let preparePgPromise: Promise<void> | undefined;

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
  let moduleSpecifier = '../../matrix/docker/synapse/index.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
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

async function loadMatrixEnvironmentConfigModule() {
  let moduleSpecifier = '../../matrix/helpers/environment-config.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    getSynapseURL: () => string;
  };
}

async function loadIsolatedRealmServerModule() {
  let moduleSpecifier = '../../matrix/helpers/isolated-realm-server.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
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
    let response = await fetch(DEFAULT_ICONS_PROBE_URL);
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
      if (child.exitCode !== null) {
        throw new Error(
          `icons server exited early with code ${child.exitCode}\n${logs}`,
        );
      }
      try {
        let response = await fetch(DEFAULT_ICONS_PROBE_URL);
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: 30_000,
      interval: 250,
      timeoutMessage: `Timed out waiting for icons server at ${DEFAULT_ICONS_PROBE_URL}\n${logs}`,
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

  await registerUser(
    synapse,
    DEFAULT_MATRIX_SERVER_USERNAME,
    browserPassword(DEFAULT_MATRIX_SERVER_USERNAME),
  );
  await registerUser(
    synapse,
    DEFAULT_MATRIX_BROWSER_USERNAME,
    browserPassword(DEFAULT_MATRIX_BROWSER_USERNAME),
  );
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
  return jwt.sign(
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

function appendProcessLogs(buffer: string, chunk: Buffer | string): string {
  return `${buffer}${String(chunk)}`.slice(-100_000);
}

function captureProcessLogs(proc: SpawnedProcess) {
  let stdout = '';
  let stderr = '';

  proc.stdout?.on('data', (chunk) => {
    stdout = appendProcessLogs(stdout, chunk);
  });
  proc.stderr?.on('data', (chunk) => {
    stderr = appendProcessLogs(stderr, chunk);
  });

  return () => {
    let logs = [];
    if (stdout) {
      logs.push(`stdout:\n${stdout}`);
    }
    if (stderr) {
      logs.push(`stderr:\n${stderr}`);
    }
    return logs.join('\n\n');
  };
}

async function waitForReady(
  proc: SpawnedProcess,
  label: string,
  timeoutMs = 120_000,
  getLogs?: () => string,
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
    new Promise<true>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
  ]);

  if (timedOut) {
    let logOutput = getLogs?.();
    throw new Error(
      `Timed out waiting for ${label} to start${
        logOutput ? `\n\n${logOutput}` : ''
      }`,
    );
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

async function readIncomingRequestBody(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  let chunks: Buffer[] = [];
  for await (let chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function startCompatRealmProxy({
  listenPort,
  targetPort,
}: {
  listenPort: number;
  targetPort: number;
}): Promise<
  | {
      stop(): Promise<void>;
    }
  | undefined
> {
  if (listenPort === targetPort) {
    return undefined;
  }

  let server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      let incomingURL = new URL(
        req.url ?? '/',
        `http://127.0.0.1:${listenPort}`,
      );
      let upstreamURL = new URL(
        `${incomingURL.pathname}${incomingURL.search}`,
        `http://localhost:${targetPort}`,
      );

      try {
        let body = await readIncomingRequestBody(req);
        let headers = Object.fromEntries(
          Object.entries(req.headers).filter(
            ([key]) => key.toLowerCase() !== 'host',
          ),
        ) as Record<string, string>;
        let response = await fetch(upstreamURL, {
          method: req.method,
          headers,
          body: body as BodyInit | undefined,
        });

        let responseHeaders = new Headers(response.headers);
        let location = responseHeaders.get('location');
        if (location) {
          responseHeaders.set(
            'location',
            location
              .replace(
                `http://localhost:${targetPort}/`,
                `http://127.0.0.1:${listenPort}/`,
              )
              .replace(
                `http://localhost:${targetPort}/`,
                `http://localhost:${listenPort}/`,
              ),
          );
        }

        res.statusCode = response.status;
        responseHeaders.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(
          `software-factory compat proxy failed for ${upstreamURL.href}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  );

  let started = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, '127.0.0.1', () => resolve());
      });
      started = true;
      break;
    } catch (error) {
      let nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EADDRINUSE') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  if (!started) {
    return undefined;
  }

  return {
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function copyRealmFixture(realmDir: string, destination: string): void {
  copySync(realmDir, destination, {
    preserveTimestamps: true,
    filter(src) {
      let relativePath = relative(realmDir, src).replace(/\\/g, '/');
      return relativePath === '' || !shouldIgnoreFixturePath(relativePath);
    },
  });
}

async function startIsolatedRealmStack({
  realmDir,
  realmURL,
  databaseName,
  context,
  migrateDB,
  fullIndexOnStartup,
}: {
  realmDir: string;
  realmURL: URL;
  databaseName: string;
  context: FactorySupportContext;
  migrateDB: boolean;
  fullIndexOnStartup: boolean;
}): Promise<RunningFactoryStack> {
  let rootDir = mkdtempSync(join(tmpdir(), 'software-factory-realms-'));
  let testRealmDir = join(rootDir, 'test');
  ensureDirSync(testRealmDir);
  copyRealmFixture(realmDir, testRealmDir);

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
    LOG_LEVELS: DEFAULT_REALM_LOG_LEVELS,
    PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
    PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${REALM_SERVER_PORT}`,
  };

  let workerArgs = [
    '--transpileOnly',
    'worker-manager',
    `--port=${WORKER_MANAGER_PORT}`,
    `--matrixURL=${context.matrixURL}`,
    `--prerendererUrl=${context.prerenderURL}`,
    `--fromUrl=${realmURL.href}`,
    `--toUrl=${realmURL.href}`,
    '--fromUrl=https://cardstack.com/base/',
    `--toUrl=http://localhost:${REALM_SERVER_PORT}/base/`,
  ];
  if (INCLUDE_SKILLS) {
    workerArgs.push(
      `--fromUrl=http://localhost:${REALM_SERVER_PORT}/skills/`,
      `--toUrl=http://localhost:${REALM_SERVER_PORT}/skills/`,
    );
  }
  if (migrateDB) {
    workerArgs.splice(5, 0, '--migrateDB');
  }

  let workerManager = spawn('ts-node', workerArgs, {
    cwd: realmServerDir,
    env,
    stdio: managedProcessStdio,
  }) as SpawnedProcess;
  let getWorkerLogs = captureProcessLogs(workerManager);

  let serverArgs = [
    '--transpileOnly',
    'main',
    `--port=${REALM_SERVER_PORT}`,
    `--matrixURL=${context.matrixURL}`,
    `--realmsRootPath=${rootDir}`,
    `--workerManagerPort=${WORKER_MANAGER_PORT}`,
    `--prerendererUrl=${context.prerenderURL}`,
    `--path=${testRealmDir}`,
    '--username=test_realm',
    `--fromUrl=${realmURL.href}`,
    `--toUrl=${realmURL.href}`,
    '--username=base_realm',
    `--path=${baseRealmDir}`,
    '--fromUrl=https://cardstack.com/base/',
    `--toUrl=http://localhost:${REALM_SERVER_PORT}/base/`,
    '--username=software_factory_realm',
    `--path=${sourceRealmDir}`,
    `--fromUrl=${LOCAL_SOFTWARE_FACTORY_SOURCE_URL.href}`,
    `--toUrl=${LOCAL_SOFTWARE_FACTORY_SOURCE_URL.href}`,
  ];
  if (INCLUDE_SKILLS) {
    serverArgs.splice(
      11,
      0,
      '--username=skills_realm',
      `--path=${skillsRealmDir}`,
      `--fromUrl=http://localhost:${REALM_SERVER_PORT}/skills/`,
      `--toUrl=http://localhost:${REALM_SERVER_PORT}/skills/`,
    );
  }

  let realmServer = spawn('ts-node', serverArgs, {
    cwd: realmServerDir,
    env,
    stdio: managedProcessStdio,
  }) as SpawnedProcess;
  let getServerLogs = captureProcessLogs(realmServer);
  let compatProxy = await startCompatRealmProxy({
    listenPort: COMPAT_REALM_SERVER_PORT,
    targetPort: REALM_SERVER_PORT,
  });

  try {
    await Promise.race([
      waitForReady(
        realmServer,
        'realm server',
        fullIndexOnStartup
          ? FULL_INDEX_REALM_STARTUP_TIMEOUT_MS
          : DEFAULT_REALM_STARTUP_TIMEOUT_MS,
        () =>
          [
            'realm server logs:',
            getServerLogs(),
            'worker manager logs:',
            getWorkerLogs(),
          ]
            .filter((entry) => entry && entry.trim().length > 0)
            .join('\n\n'),
      ),
      createProcessExitPromise(workerManager, 'worker manager'),
    ]);
  } catch (error) {
    try {
      await stopManagedProcess(realmServer);
    } catch {
      // best effort cleanup
    }
    try {
      await stopManagedProcess(workerManager);
    } catch {
      // best effort cleanup
    }
    try {
      await compatProxy?.stop();
    } catch {
      // best effort cleanup
    }
    rmSync(rootDir, { recursive: true, force: true });
    throw error;
  }

  return {
    compatProxy,
    realmServer,
    workerManager,
    rootDir,
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

  try {
    await stopManagedProcess(stack.workerManager);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stack.compatProxy?.stop();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    rmSync(stack.rootDir, { recursive: true, force: true });
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
  let hasMigratedTemplate = await databaseExists(DEFAULT_MIGRATED_TEMPLATE_DB);

  await dropDatabase(templateDatabaseName);
  await dropDatabase(builderDatabaseName);

  if (hasMigratedTemplate) {
    await cloneDatabaseFromTemplate(
      DEFAULT_MIGRATED_TEMPLATE_DB,
      builderDatabaseName,
    );
  }

  await seedRealmPermissions(builderDatabaseName, realmURL, permissions);
  await seedRealmPermissions(
    builderDatabaseName,
    LOCAL_SOFTWARE_FACTORY_SOURCE_URL,
    DEFAULT_SOURCE_REALM_PERMISSIONS,
  );

  let stack = await startIsolatedRealmStack({
    realmDir,
    realmURL,
    databaseName: builderDatabaseName,
    context,
    migrateDB: !hasMigratedTemplate,
    fullIndexOnStartup: true,
  });

  try {
    await waitForQueueIdle(builderDatabaseName);
  } finally {
    await stopIsolatedRealmStack(stack);
  }

  await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
  await dropDatabase(builderDatabaseName);
}

export async function startFactorySupportServices(): Promise<{
  context: FactorySupportContext;
  stop(): Promise<void>;
}> {
  await ensurePgReady();
  await ensureHostReady();
  let icons = await ensureIconsReady();
  cleanupStaleSynapseContainers();
  let { synapseStart, synapseStop } = await loadSynapseModule();
  let { getSynapseURL } = await loadMatrixEnvironmentConfigModule();
  let { startPrerenderServer } = await loadIsolatedRealmServerModule();

  let synapse = await synapseStart(
    { suppressRegistrationSecretFile: true },
    true,
  );
  await ensureSupportUsers(synapse);
  let prerender = await startPrerenderServer();
  let matrixURL = process.env.SOFTWARE_FACTORY_MATRIX_URL ?? getSynapseURL();

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
  let support = await startFactorySupportServices();
  try {
    let template = await ensureFactoryRealmTemplate({
      ...options,
      realmDir,
      realmURL,
      context: support.context,
    });

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
  let databaseName = runtimeDatabaseName();

  let ownedGlobalContext: FactoryGlobalContextHandle | undefined;
  let context = options.context ?? parseFactoryContext();
  if (!context) {
    ownedGlobalContext = await startFactoryGlobalContext({
      ...options,
      realmDir,
      realmURL,
    });
    context = ownedGlobalContext.context;
  }

  if (!templateDatabaseName) {
    templateDatabaseName = hasTemplateDatabaseName(context)
      ? context.templateDatabaseName
      : (
          await ensureFactoryRealmTemplate({
            ...options,
            realmDir,
            realmURL,
            context,
          })
        ).templateDatabaseName;
  }

  let stack: RunningFactoryStack;
  try {
    await dropDatabase(databaseName);
    await cloneDatabaseFromTemplate(templateDatabaseName, databaseName);
    await seedRealmPermissions(
      databaseName,
      LOCAL_SOFTWARE_FACTORY_SOURCE_URL,
      DEFAULT_SOURCE_REALM_PERMISSIONS,
    );

    stack = await startIsolatedRealmStack({
      realmDir,
      realmURL,
      databaseName,
      context,
      migrateDB: false,
      fullIndexOnStartup: false,
    });
  } catch (error) {
    let cleanupError: unknown;

    try {
      await dropDatabase(databaseName);
    } catch (cleanupFailure) {
      cleanupError ??= cleanupFailure;
    }

    try {
      await ownedGlobalContext?.stop();
    } catch (cleanupFailure) {
      cleanupError ??= cleanupFailure;
    }

    if (cleanupError) {
      throw cleanupError;
    }

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
        await stopIsolatedRealmStack(stack);
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
