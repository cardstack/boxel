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
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type { StdioOptions } from 'node:child_process';

import fsExtra from 'fs-extra';
import jwt from 'jsonwebtoken';
import { Client as PgClient } from 'pg';
import './setup-logger';
import { logger } from './logger';

type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';
const { copySync, ensureDirSync } = fsExtra;

type RealmPermissions = Record<string, RealmAction[]>;

type FactorySupportContext = {
  matrixURL: string;
  matrixRegistrationSecret: string;
};

type SynapseInstance = {
  synapseId: string;
  port: number;
  registrationSecret: string;
};

export interface FactoryRealmOptions {
  realmDir?: string;
  realmURL?: URL;
  realmServerURL?: URL;
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
  realmServerURL: string;
  templateDatabaseName: string;
}

export interface StartedFactoryRealm {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  databaseName: string;
  childPids: number[];
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
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

type StartedCompatRealmProxy = {
  listenPort: number;
  setTargetPort(targetPort: number): void;
  stop(): Promise<void>;
};

type RunningFactoryStack = {
  prerender: {
    stop(): Promise<void>;
  };
  realmServer: SpawnedProcess;
  realmServerURL: URL;
  workerManager: SpawnedProcess;
  compatProxy?: StartedCompatRealmProxy;
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
  rootDir: string;
};

const packageRoot = resolve(process.cwd());
const workspaceRoot = resolve(packageRoot, '..', '..');
const realmServerDir = resolve(packageRoot, '..', 'realm-server');
const hostDir = resolve(packageRoot, '..', 'host');
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

const CACHE_VERSION = 8;
const DEFAULT_REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_REALM_PORT ?? 0,
);
const DEFAULT_COMPAT_REALM_SERVER_PORT = Number(
  process.env.SOFTWARE_FACTORY_COMPAT_REALM_PORT ?? 0,
);
const DEFAULT_WORKER_MANAGER_PORT = Number(
  process.env.SOFTWARE_FACTORY_WORKER_MANAGER_PORT ?? 0,
);
const CONFIGURED_REALM_URL = process.env.SOFTWARE_FACTORY_REALM_URL
  ? new URL(process.env.SOFTWARE_FACTORY_REALM_URL)
  : undefined;
const CONFIGURED_REALM_SERVER_URL = process.env
  .SOFTWARE_FACTORY_REALM_SERVER_URL
  ? new URL(process.env.SOFTWARE_FACTORY_REALM_SERVER_URL)
  : undefined;
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
const DEFAULT_PRERENDER_PORT = Number(
  process.env.SOFTWARE_FACTORY_PRERENDER_PORT ?? 4231,
);
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
const FIXTURE_SOURCE_REALM_URL_PLACEHOLDER = 'https://sf.boxel.test/';
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
const DEFAULT_BASE_REALM_PERMISSIONS: RealmPermissions =
  DEFAULT_SOURCE_REALM_PERMISSIONS;
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
const harnessLog = logger('software-factory:harness');
const supportLog = logger('software-factory:harness:support');
const templateLog = logger('software-factory:harness:template');
const realmLog = logger('software-factory:harness:realm');

function formatElapsedMs(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

async function logTimed<T>(
  log: ReturnType<typeof logger>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  let startedAt = Date.now();
  log.debug(`${label}: starting`);
  try {
    let result = await callback();
    log.debug(
      `${label}: finished in ${formatElapsedMs(Date.now() - startedAt)}`,
    );
    return result;
  } catch (error) {
    log.warn(
      `${label}: failed after ${formatElapsedMs(Date.now() - startedAt)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
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

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    let server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine allocated port'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function resolveFactoryRealmServerURL(
  realmServerURL?: URL,
): Promise<URL> {
  if (realmServerURL) {
    return new URL(realmServerURL.href);
  }

  if (CONFIGURED_REALM_SERVER_URL) {
    return new URL(CONFIGURED_REALM_SERVER_URL.href);
  }

  let port =
    DEFAULT_COMPAT_REALM_SERVER_PORT === 0
      ? await findAvailablePort()
      : DEFAULT_COMPAT_REALM_SERVER_PORT;
  return new URL(`http://localhost:${port}/`);
}

async function resolveFactoryRealmLocation(options: {
  realmURL?: URL;
  realmServerURL?: URL;
}): Promise<{
  realmURL: URL;
  realmServerURL: URL;
}> {
  let realmURL = options.realmURL
    ? new URL(options.realmURL.href)
    : CONFIGURED_REALM_URL
      ? new URL(CONFIGURED_REALM_URL.href)
      : undefined;
  let realmServerURL = options.realmServerURL
    ? new URL(options.realmServerURL.href)
    : CONFIGURED_REALM_SERVER_URL
      ? new URL(CONFIGURED_REALM_SERVER_URL.href)
      : undefined;

  if (!realmURL && !realmServerURL) {
    realmServerURL = await resolveFactoryRealmServerURL();
    realmURL = new URL('test/', realmServerURL);
  } else if (!realmServerURL) {
    throw new Error(
      'An explicit realm server URL is required when a realm URL is provided. Set options.realmServerURL or SOFTWARE_FACTORY_REALM_SERVER_URL.',
    );
  } else if (!realmURL) {
    realmURL = new URL('test/', realmServerURL);
  }

  return {
    realmURL,
    realmServerURL,
  };
}

function baseRealmURLFor(realmServerURL: URL): URL {
  return new URL('base/', realmServerURL);
}

function skillsRealmURLFor(realmServerURL: URL): URL {
  return new URL('skills/', realmServerURL);
}

function sourceRealmURLFor(realmServerURL: URL): URL {
  return new URL('software-factory/', realmServerURL);
}

function withPort(url: URL, port: number): URL {
  let next = new URL(url.href);
  next.port = String(port);
  return next;
}

function realmRelativePath(realmURL: URL, realmServerURL: URL): string {
  if (realmURL.origin !== realmServerURL.origin) {
    throw new Error(
      `Realm URL ${realmURL.href} does not share an origin with realm server URL ${realmServerURL.href}`,
    );
  }

  let serverPath = realmServerURL.pathname.endsWith('/')
    ? realmServerURL.pathname
    : `${realmServerURL.pathname}/`;
  if (!realmURL.pathname.startsWith(serverPath)) {
    throw new Error(
      `Realm URL ${realmURL.href} is not mounted under realm server URL ${realmServerURL.href}`,
    );
  }

  return realmURL.pathname.slice(serverPath.length);
}

function realmURLWithinServer(realmServerURL: URL, realmPath: string): URL {
  return new URL(realmPath || '.', realmServerURL);
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

async function waitForJsonFile<T>(
  file: string,
  getLogs: () => string,
  options: {
    timeout?: number;
    label: string;
    process?: SpawnedProcess;
  },
): Promise<T> {
  let timeout = options.timeout ?? DEFAULT_REALM_STARTUP_TIMEOUT_MS;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch (error) {
      let nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }

    if (options.process && options.process.exitCode !== null) {
      throw new Error(
        `${options.label} exited early with code ${options.process.exitCode}\n${getLogs()}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${options.label} metadata in ${file}\n${getLogs()}`,
  );
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

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findHostDistPackageDir(): string | undefined {
  let siblingRoot = resolve(workspaceRoot, '..');
  let candidates = [
    process.env.SOFTWARE_FACTORY_HOST_DIST_PACKAGE_DIR,
    resolve(siblingRoot, 'boxel', 'packages', 'host'),
    ...readdirSync(siblingRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(siblingRoot, entry.name, 'packages', 'host')),
    hostDir,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolve(value));

  let seen = new Set<string>();
  for (let candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (fileExists(join(candidate, 'dist', 'index.html'))) {
      return candidate;
    }
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
      opts?: {
        suppressRegistrationSecretFile?: true;
        dynamicHostPort?: true;
      },
      stopExisting?: boolean,
    ) => Promise<SynapseInstance>;
    synapseStop: (id: string) => Promise<void>;
  };
}

async function loadMatrixEnvironmentConfigModule() {
  let moduleSpecifier = '../../matrix/helpers/environment-config.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    getSynapseURL: (synapse?: { baseUrl?: string; port?: number }) => string;
  };
}

async function ensureHostReady(matrixURL: string): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureHostReady ${DEFAULT_HOST_URL}`,
    async () => {
      let response: Response;
      try {
        response = await fetch(DEFAULT_HOST_URL);
        if (response.ok) {
          return {};
        }
      } catch (error) {
        supportLog.debug(
          `host app not reachable at ${DEFAULT_HOST_URL}, starting fallback host service: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      let hostPackageDir = findHostDistPackageDir();
      let command = ['start'];
      let cwd = hostDir;
      if (hostPackageDir) {
        supportLog.debug(`serving built host dist from ${hostPackageDir}`);
        command = ['serve:dist'];
        cwd = hostPackageDir;
      } else {
        supportLog.warn(
          'no built host dist found; falling back to pnpm start in packages/host',
        );
      }

      let child = spawn('pnpm', command, {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MATRIX_URL: matrixURL,
        },
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
              `host app exited early with code ${child.exitCode}\n${logs}`,
            );
          }
          try {
            let readyResponse = await fetch(DEFAULT_HOST_URL);
            return readyResponse.ok;
          } catch {
            return false;
          }
        },
        {
          timeout: 180_000,
          interval: 500,
          timeoutMessage: `Timed out waiting for host app at ${DEFAULT_HOST_URL}\n${logs}`,
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
    },
  );
}

async function waitForHttpReady(url: string, timeoutMs = 60_000) {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url} to become ready`);
}

async function stopChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      child.removeAllListeners('exit');
      child.removeAllListeners('error');
    };

    child.once('exit', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
    child.once('error', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });

    timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, 5_000);

    child.kill(signal);
  });
}

async function startHarnessPrerenderServer(options: {
  boxelHostURL: string;
  port?: number;
}): Promise<{
  url: string;
  stop(): Promise<void>;
}> {
  let port = options.port ?? DEFAULT_PRERENDER_PORT;
  if (port === 0) {
    port = await findAvailablePort();
  }
  let url = `http://localhost:${port}`;
  let silent = process.env.SOFTWARE_FACTORY_PRERENDER_SILENT !== '0';
  let child = spawn(
    'ts-node',
    [
      '--transpileOnly',
      'prerender/prerender-server',
      `--port=${port}`,
      ...(silent ? ['--silent'] : []),
    ],
    {
      cwd: realmServerDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        NODE_NO_WARNINGS: '1',
        BOXEL_HOST_URL: options.boxelHostURL,
        LOG_LEVELS:
          process.env.SOFTWARE_FACTORY_PRERENDER_LOG_LEVELS ??
          process.env.LOG_LEVELS,
      },
    },
  );

  child.stdout?.on('data', (data: Buffer) => {
    console.log(`prerender: ${data.toString()}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    console.error(`prerender: ${data.toString()}`);
  });

  let exitPromise = new Promise<never>((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(
        new Error(
          `prerender server exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    });
    child.once('error', reject);
  });

  await Promise.race([waitForHttpReady(url), exitPromise]);

  return {
    url,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

async function ensureIconsReady(): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureIconsReady ${DEFAULT_ICONS_PROBE_URL}`,
    async () => {
      try {
        let response = await fetch(DEFAULT_ICONS_PROBE_URL);
        if (response.ok) {
          supportLog.debug('icons server already available');
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

      supportLog.debug('started local icons server');
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
    },
  );
}

async function ensurePgReady(): Promise<void> {
  if (!preparePgPromise) {
    preparePgPromise = logTimed(
      supportLog,
      `ensurePgReady ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
      async () => {
        if (await canConnectToPg()) {
          supportLog.debug('postgres already available');
          return;
        }
        runCommand('bash', [prepareTestPgScript], workspaceRoot);
        await waitUntil(() => canConnectToPg(), {
          timeout: 30_000,
          interval: 250,
          timeoutMessage: `Timed out waiting for Postgres on ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
        });
      },
    ).catch((error) => {
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
  await logTimed(templateLog, `dropDatabase ${databaseName}`, async () => {
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
  });
}

async function cloneDatabaseFromTemplate(
  templateDatabaseName: string,
  databaseName: string,
): Promise<void> {
  await logTimed(
    templateLog,
    `cloneDatabaseFromTemplate ${templateDatabaseName} -> ${databaseName}`,
    async () => {
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
    },
  );
}

async function createTemplateSnapshot(
  sourceDatabaseName: string,
  templateDatabaseName: string,
): Promise<void> {
  await logTimed(
    templateLog,
    `createTemplateSnapshot ${sourceDatabaseName} -> ${templateDatabaseName}`,
    async () => {
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
    },
  );
}

async function seedRealmPermissions(
  databaseName: string,
  realmURL: URL,
  permissions: RealmPermissions,
): Promise<void> {
  await logTimed(
    templateLog,
    `seedRealmPermissions ${databaseName} ${realmURL.href}`,
    async () => {
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
    },
  );
}

async function resetRealmState(
  databaseName: string,
  realmURL: URL,
): Promise<void> {
  await logTimed(
    templateLog,
    `resetRealmState ${databaseName} ${realmURL.href}`,
    async () => {
      let client = new PgClient(pgAdminConnectionConfig(databaseName));
      try {
        await client.connect();
        await client.query('BEGIN');

        await client.query(
          `DELETE FROM modules WHERE resolved_realm_url = $1`,
          [realmURL.href],
        );
        await client.query(`DELETE FROM boxel_index WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(
          `DELETE FROM boxel_index_working WHERE realm_url = $1`,
          [realmURL.href],
        );
        await client.query(`DELETE FROM realm_versions WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(`DELETE FROM realm_file_meta WHERE realm_url = $1`, [
          realmURL.href,
        ]);
        await client.query(
          `DELETE FROM published_realms
       WHERE source_realm_url = $1 OR published_realm_url = $1`,
          [realmURL.href],
        );

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
    },
  );
}

async function resetMountedRealmState(
  databaseName: string,
  realmURLs: URL[],
): Promise<void> {
  await logTimed(
    templateLog,
    `resetMountedRealmState ${databaseName} (${realmURLs.length} realms)`,
    async () => {
      for (let realmURL of realmURLs) {
        await resetRealmState(databaseName, realmURL);
      }
    },
  );
}

async function resetQueueState(databaseName: string): Promise<void> {
  await logTimed(templateLog, `resetQueueState ${databaseName}`, async () => {
    let client = new PgClient(pgAdminConnectionConfig(databaseName));
    try {
      await client.connect();
      await client.query('BEGIN');
      await client.query(`DELETE FROM job_reservations`);
      await client.query(`DELETE FROM jobs`);
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
  });
}

async function waitForQueueIdle(databaseName: string): Promise<void> {
  await logTimed(templateLog, `waitForQueueIdle ${databaseName}`, async () => {
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
  });
}

async function ensureSupportUsers(synapse: SynapseInstance): Promise<void> {
  await logTimed(supportLog, 'ensureSupportUsers', async () => {
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
  });
}
function browserPassword(username: string): string {
  let cleanUsername = username.replace(/^@/, '').replace(/:.*$/, '');
  return createHash('sha256')
    .update(cleanUsername)
    .update(REALM_SECRET_SEED)
    .digest('hex');
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
  realmServerURL: URL,
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
      realmServerURL: realmServerURL.href,
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

function describeCompatProxyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let parts: string[] = [];
  let current: unknown = error;

  while (current) {
    if (current instanceof Error) {
      let code =
        'code' in current && typeof current.code === 'string'
          ? ` (${current.code})`
          : '';
      parts.push(`${current.message}${code}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  return parts.join(' <- ');
}

async function startCompatRealmProxy({
  listenPort,
}: {
  listenPort: number;
}): Promise<StartedCompatRealmProxy> {
  realmLog.debug(`startCompatRealmProxy: requested listenPort=${listenPort}`);
  let targetPort: number | undefined;
  let server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (targetPort == null) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('software-factory compat proxy target is not ready');
        return;
      }
      let incomingURL = new URL(
        req.url ?? '/',
        `${
          req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
        }://${req.headers.host ?? `127.0.0.1:${actualListenPort}`}`,
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
        headers['x-boxel-forwarded-url'] = incomingURL.href;
        let response = await fetch(upstreamURL, {
          method: req.method,
          headers,
          body: body as BodyInit | undefined,
          // Preserve upstream redirects so the client follows them against the
          // public compat URL with a fresh forwarded URL header.
          redirect: 'manual',
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
        let description = describeCompatProxyError(error);
        realmLog.warn(
          `startCompatRealmProxy: upstream fetch failed for ${upstreamURL.href}: ${description}`,
        );
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(
          `software-factory compat proxy failed for ${upstreamURL.href}: ${description}`,
        );
      }
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });
  let address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine compat proxy port');
  }
  let actualListenPort = address.port;
  realmLog.debug(`startCompatRealmProxy: listening on ${actualListenPort}`);
  return {
    listenPort: actualListenPort,
    setTargetPort(nextTargetPort: number) {
      targetPort = nextTargetPort;
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${nextTargetPort} ready`,
      );
    },
    async stop() {
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${targetPort ?? 'unset'} stopping`,
      );
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

function rewriteFixtureSourceModuleUrls(
  destination: string,
  sourceRealmURL: URL,
): void {
  let rewrittenFiles = 0;

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      let contents = readFileSync(absolutePath, 'utf8');
      if (!contents.includes(FIXTURE_SOURCE_REALM_URL_PLACEHOLDER)) {
        continue;
      }

      writeFileSync(
        absolutePath,
        contents
          .split(FIXTURE_SOURCE_REALM_URL_PLACEHOLDER)
          .join(sourceRealmURL.href),
      );
      rewrittenFiles++;
    }
  }

  visit(destination);
  if (rewrittenFiles > 0) {
    realmLog.debug(
      `rewriteFixtureSourceModuleUrls: rewrote ${rewrittenFiles} files to ${sourceRealmURL.href}`,
    );
  }
}

function copyRealmFixture(
  realmDir: string,
  destination: string,
  sourceRealmURL: URL,
): void {
  copySync(realmDir, destination, {
    preserveTimestamps: true,
    filter(src) {
      let relativePath = relative(realmDir, src).replace(/\\/g, '/');
      return relativePath === '' || !shouldIgnoreFixturePath(relativePath);
    },
  });
  rewriteFixtureSourceModuleUrls(destination, sourceRealmURL);
}

async function startIsolatedRealmStack({
  realmDir,
  realmURL,
  realmServerURL,
  databaseName,
  context,
  migrateDB,
  fullIndexOnStartup,
}: {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  databaseName: string;
  context: FactorySupportContext;
  migrateDB: boolean;
  fullIndexOnStartup: boolean;
}): Promise<RunningFactoryStack> {
  return await logTimed(
    realmLog,
    `startIsolatedRealmStack ${databaseName} ${realmURL.href}`,
    async () => {
      let rootDir = mkdtempSync(join(tmpdir(), 'software-factory-realms-'));
      let testRealmDir = join(rootDir, 'test');
      let workerManagerMetadataFile = join(
        rootDir,
        'worker-manager.runtime.json',
      );
      let realmServerMetadataFile = join(rootDir, 'realm-server.runtime.json');
      let actualRealmServerPort =
        DEFAULT_REALM_SERVER_PORT === 0
          ? await findAvailablePort()
          : DEFAULT_REALM_SERVER_PORT;
      let actualRealmServerURL = withPort(
        realmServerURL,
        actualRealmServerPort,
      );
      let actualRealmPath = realmRelativePath(realmURL, realmServerURL);
      let actualRealmURL = realmURLWithinServer(
        actualRealmServerURL,
        actualRealmPath,
      );
      let legacyRealmServerURL = new URL('http://localhost:4205/');
      let legacyRealmURL = new URL('test/', legacyRealmServerURL);
      let publicBaseRealmURL = baseRealmURLFor(realmServerURL);
      let actualBaseRealmURL = baseRealmURLFor(actualRealmServerURL);
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);
      let actualSourceRealmURL = sourceRealmURLFor(actualRealmServerURL);
      let legacySourceRealmURL = sourceRealmURLFor(legacyRealmServerURL);
      let skillsRealmURL = skillsRealmURLFor(realmServerURL);
      let actualSkillsRealmURL = skillsRealmURLFor(actualRealmServerURL);
      let legacySkillsRealmURL = skillsRealmURLFor(legacyRealmServerURL);
      ensureDirSync(testRealmDir);
      copyRealmFixture(realmDir, testRealmDir, sourceRealmURL);
      realmLog.debug(
        `startIsolatedRealmStack: copied fixture ${realmDir} -> ${testRealmDir}`,
      );
      let compatProxy = await startCompatRealmProxy({
        listenPort: Number(realmServerURL.port),
      });
      let prerender = await startHarnessPrerenderServer({
        boxelHostURL: realmServerURL.href.replace(/\/$/, ''),
      });

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
        PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${compatProxy.listenPort}`,
        PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${compatProxy.listenPort}`,
        SOFTWARE_FACTORY_WORKER_MANAGER_METADATA_FILE:
          workerManagerMetadataFile,
        SOFTWARE_FACTORY_REALM_SERVER_METADATA_FILE: realmServerMetadataFile,
      };

      let workerArgs = [
        '--transpileOnly',
        'worker-manager',
        `--port=${DEFAULT_WORKER_MANAGER_PORT}`,
        `--matrixURL=${context.matrixURL}`,
        `--prerendererUrl=${prerender.url}`,
        `--fromUrl=${realmURL.href}`,
        `--toUrl=${actualRealmURL.href}`,
        `--fromUrl=${publicBaseRealmURL.href}`,
        `--toUrl=${actualBaseRealmURL.href}`,
        '--fromUrl=https://cardstack.com/base/',
        `--toUrl=${publicBaseRealmURL.href}`,
        `--fromUrl=${sourceRealmURL.href}`,
        `--toUrl=${actualSourceRealmURL.href}`,
      ];
      if (INCLUDE_SKILLS) {
        workerArgs.push(
          `--fromUrl=${skillsRealmURL.href}`,
          `--toUrl=${actualSkillsRealmURL.href}`,
        );
      }
      workerArgs.push(
        `--fromUrl=${legacyRealmURL.href}`,
        `--toUrl=${actualRealmURL.href}`,
        `--fromUrl=${legacySourceRealmURL.href}`,
        `--toUrl=${actualSourceRealmURL.href}`,
      );
      if (INCLUDE_SKILLS) {
        workerArgs.push(
          `--fromUrl=${legacySkillsRealmURL.href}`,
          `--toUrl=${actualSkillsRealmURL.href}`,
        );
      }
      if (migrateDB) {
        workerArgs.splice(5, 0, '--migrateDB');
      }

      realmLog.debug(
        `startIsolatedRealmStack: starting worker-manager for ${databaseName}`,
      );
      let workerManager = spawn('ts-node', workerArgs, {
        cwd: realmServerDir,
        env,
        stdio: managedProcessStdio,
      }) as SpawnedProcess;
      let getWorkerLogs = captureProcessLogs(workerManager);
      let workerManagerRuntime = await waitForJsonFile<{
        pid: number;
        port: number;
        url: string;
      }>(workerManagerMetadataFile, getWorkerLogs, {
        label: 'worker manager',
        process: workerManager,
      });

      let serverArgs = [
        '--transpileOnly',
        'main',
        `--port=${actualRealmServerPort}`,
        `--serverURL=${realmServerURL.href}`,
        `--matrixURL=${context.matrixURL}`,
        `--realmsRootPath=${rootDir}`,
        `--workerManagerUrl=${workerManagerRuntime.url}`,
        `--prerendererUrl=${prerender.url}`,
        '--username=base_realm',
        `--path=${baseRealmDir}`,
        `--fromUrl=${publicBaseRealmURL.href}`,
        `--toUrl=${actualBaseRealmURL.href}`,
        '--username=software_factory_realm',
        `--path=${sourceRealmDir}`,
        `--fromUrl=${sourceRealmURL.href}`,
        `--toUrl=${actualSourceRealmURL.href}`,
        '--username=test_realm',
        `--path=${testRealmDir}`,
        `--fromUrl=${realmURL.href}`,
        `--toUrl=${actualRealmURL.href}`,
      ];
      if (INCLUDE_SKILLS) {
        serverArgs.splice(
          16,
          0,
          '--username=skills_realm',
          `--path=${skillsRealmDir}`,
          `--fromUrl=${skillsRealmURL.href}`,
          `--toUrl=${actualSkillsRealmURL.href}`,
        );
      }
      serverArgs.push(
        `--fromUrl=${legacyRealmURL.href}`,
        `--toUrl=${actualRealmURL.href}`,
        `--fromUrl=${legacySourceRealmURL.href}`,
        `--toUrl=${actualSourceRealmURL.href}`,
      );
      if (INCLUDE_SKILLS) {
        serverArgs.push(
          `--fromUrl=${legacySkillsRealmURL.href}`,
          `--toUrl=${actualSkillsRealmURL.href}`,
        );
      }

      realmLog.debug(`startIsolatedRealmStack: starting realm server`);
      let realmServer = spawn('ts-node', serverArgs, {
        cwd: realmServerDir,
        env,
        stdio: managedProcessStdio,
      }) as SpawnedProcess;
      let getServerLogs = captureProcessLogs(realmServer);
      let realmServerRuntime: {
        pid: number;
        port: number;
      };

      try {
        realmServerRuntime = await waitForJsonFile<{
          pid: number;
          port: number;
        }>(realmServerMetadataFile, getServerLogs, {
          label: 'realm server',
          process: realmServer,
        });
        compatProxy.setTargetPort(realmServerRuntime.port);
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
          await prerender.stop();
        } catch {
          // best effort cleanup
        }
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
        prerender,
        realmServer,
        realmServerURL,
        ports: {
          publicPort: compatProxy.listenPort,
          realmServerPort: realmServerRuntime.port,
          workerManagerPort: workerManagerRuntime.port,
        },
        workerManager,
        rootDir,
      };
    },
  );
}

async function stopIsolatedRealmStack(
  stack: RunningFactoryStack,
): Promise<void> {
  await logTimed(realmLog, 'stopIsolatedRealmStack', async () => {
    let cleanupError: unknown;

    try {
      await stack.prerender.stop();
    } catch (error) {
      cleanupError ??= error;
    }

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
  });
}

async function buildTemplateDatabase({
  realmDir,
  realmURL,
  realmServerURL,
  permissions,
  context,
  cacheKey,
  templateDatabaseName,
}: {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  permissions: RealmPermissions;
  context: FactorySupportContext;
  cacheKey: string;
  templateDatabaseName: string;
}): Promise<void> {
  await logTimed(
    templateLog,
    `buildTemplateDatabase ${templateDatabaseName}`,
    async () => {
      let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);
      let hasMigratedTemplate = await databaseExists(
        DEFAULT_MIGRATED_TEMPLATE_DB,
      );

      templateLog.debug(
        `buildTemplateDatabase: builder=${builderDatabaseName} migratedTemplate=${hasMigratedTemplate}`,
      );
      await dropDatabase(templateDatabaseName);
      await dropDatabase(builderDatabaseName);

      if (hasMigratedTemplate) {
        await cloneDatabaseFromTemplate(
          DEFAULT_MIGRATED_TEMPLATE_DB,
          builderDatabaseName,
        );
      }
      let baseRealmURL = baseRealmURLFor(realmServerURL);
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);

      await resetMountedRealmState(builderDatabaseName, [
        realmURL,
        baseRealmURL,
        sourceRealmURL,
      ]);
      await resetQueueState(builderDatabaseName);
      await seedRealmPermissions(builderDatabaseName, realmURL, permissions);
      await seedRealmPermissions(
        builderDatabaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );
      await seedRealmPermissions(
        builderDatabaseName,
        sourceRealmURL,
        DEFAULT_SOURCE_REALM_PERMISSIONS,
      );

      let stack = await startIsolatedRealmStack({
        realmDir,
        realmURL,
        realmServerURL,
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
    },
  );
}

export async function startFactorySupportServices(): Promise<{
  context: FactorySupportContext;
  stop(): Promise<void>;
}> {
  return await logTimed(supportLog, 'startFactorySupportServices', async () => {
    await ensurePgReady();
    cleanupStaleSynapseContainers();
    let { synapseStart, synapseStop } = await loadSynapseModule();
    let { getSynapseURL } = await loadMatrixEnvironmentConfigModule();

    let synapseStartedAt = Date.now();
    let synapse = await synapseStart(
      { suppressRegistrationSecretFile: true, dynamicHostPort: true },
      true,
    );
    supportLog.debug(
      `synapse started in ${formatElapsedMs(Date.now() - synapseStartedAt)} on port ${synapse.port}`,
    );
    let matrixURL =
      process.env.SOFTWARE_FACTORY_MATRIX_URL ?? getSynapseURL(synapse);
    let host = await ensureHostReady(matrixURL);
    let icons = await ensureIconsReady();
    await ensureSupportUsers(synapse);

    return {
      context: {
        matrixURL,
        matrixRegistrationSecret: synapse.registrationSecret,
      },
      async stop() {
        await logTimed(supportLog, 'stopFactorySupportServices', async () => {
          await synapseStop(synapse.synapseId);
          await host.stop?.();
          await icons.stop?.();
        });
      },
    };
  });
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
  return await logTimed(harnessLog, 'startFactoryGlobalContext', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL,
      realmServerURL: options.realmServerURL,
    });
    let support = await startFactorySupportServices();
    try {
      let template = await ensureFactoryRealmTemplate({
        ...options,
        realmDir,
        realmURL,
        realmServerURL,
        context: support.context,
      });

      let context: FactoryTestContext = {
        ...support.context,
        cacheKey: template.cacheKey,
        fixtureHash: template.fixtureHash,
        realmDir,
        realmURL: realmURL.href,
        realmServerURL: realmServerURL.href,
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
  });
}

export async function ensureFactoryRealmTemplate(
  options: FactoryRealmOptions = {},
): Promise<FactoryRealmTemplate> {
  return await logTimed(harnessLog, 'ensureFactoryRealmTemplate', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let contextRealmURL =
      options.context && hasTemplateDatabaseName(options.context)
        ? new URL(options.context.realmURL)
        : undefined;
    let contextRealmServerURL =
      options.context && hasTemplateDatabaseName(options.context)
        ? new URL(options.context.realmServerURL)
        : undefined;
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL ?? contextRealmURL,
      realmServerURL: options.realmServerURL ?? contextRealmServerURL,
    });
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
        templateLog.debug(
          `ensureFactoryRealmTemplate: cache hit ${templateDatabaseName}`,
        );
        return {
          cacheKey,
          templateDatabaseName,
          fixtureHash,
          cacheHit: true,
        };
      }

      templateLog.debug(
        `ensureFactoryRealmTemplate: cache miss ${templateDatabaseName}`,
      );
      await buildTemplateDatabase({
        realmDir,
        realmURL,
        realmServerURL,
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
  });
}

export async function startFactoryRealmServer(
  options: FactoryRealmOptions = {},
): Promise<StartedFactoryRealm> {
  return await logTimed(harnessLog, 'startFactoryRealmServer', async () => {
    let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
    let existingContext = options.context ?? parseFactoryContext();
    let contextRealmURL =
      existingContext && hasTemplateDatabaseName(existingContext)
        ? new URL(existingContext.realmURL)
        : undefined;
    let contextRealmServerURL =
      existingContext && hasTemplateDatabaseName(existingContext)
        ? new URL(existingContext.realmServerURL)
        : undefined;
    let { realmURL, realmServerURL } = await resolveFactoryRealmLocation({
      realmURL: options.realmURL ?? contextRealmURL,
      realmServerURL: options.realmServerURL ?? contextRealmServerURL,
    });
    let templateDatabaseName = options.templateDatabaseName;
    let databaseName = runtimeDatabaseName();

    let ownedGlobalContext: FactoryGlobalContextHandle | undefined;
    let context = existingContext;
    if (!context) {
      ownedGlobalContext = await startFactoryGlobalContext({
        ...options,
        realmDir,
        realmURL,
        realmServerURL,
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
              realmServerURL,
              context,
            })
          ).templateDatabaseName;
    }

    realmLog.debug(
      `startFactoryRealmServer: database=${databaseName} template=${templateDatabaseName}`,
    );
    let stack: RunningFactoryStack;
    try {
      let baseRealmURL = baseRealmURLFor(realmServerURL);
      let sourceRealmURL = sourceRealmURLFor(realmServerURL);
      await dropDatabase(databaseName);
      await cloneDatabaseFromTemplate(templateDatabaseName, databaseName);
      await resetQueueState(databaseName);
      await seedRealmPermissions(
        databaseName,
        baseRealmURL,
        DEFAULT_BASE_REALM_PERMISSIONS,
      );
      await resetMountedRealmState(databaseName, [sourceRealmURL]);
      await seedRealmPermissions(
        databaseName,
        sourceRealmURL,
        DEFAULT_SOURCE_REALM_PERMISSIONS,
      );

      stack = await startIsolatedRealmStack({
        realmDir,
        realmURL,
        realmServerURL,
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
      realmServerURL,
      databaseName,
      ports: stack.ports,
      childPids: [stack.realmServer.pid, stack.workerManager.pid].filter(
        (pid): pid is number => pid != null,
      ),
      cardURL(path: string) {
        return new URL(path, realmURL).href;
      },
      createBearerToken(
        user = DEFAULT_REALM_OWNER,
        permissions?: RealmAction[],
      ) {
        return buildRealmToken(realmURL, realmServerURL, user, permissions);
      },
      authorizationHeaders(user?: string, permissions?: RealmAction[]) {
        return {
          Authorization: `Bearer ${buildRealmToken(
            realmURL,
            realmServerURL,
            user,
            permissions,
          )}`,
        };
      },
      async stop() {
        await logTimed(
          realmLog,
          `stopFactoryRealmServer ${databaseName}`,
          async () => {
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
        );
      },
    };
  });
}

export async function fetchRealmCardJson(
  path: string,
  options: FactoryRealmOptions = {},
) {
  return await logTimed(harnessLog, `fetchRealmCardJson ${path}`, async () => {
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
  });
}
