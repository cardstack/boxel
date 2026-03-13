// @ts-nocheck
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { Client as PgClient } from 'pg';

const require = createRequire(import.meta.url);
require('decorator-transforms/globals');
const ContentTagGlobal = require('content-tag');
if (!(globalThis as any).ContentTagGlobal) {
  (globalThis as any).ContentTagGlobal = ContentTagGlobal;
}
if (!(globalThis as any).__environment) {
  (globalThis as any).__environment = 'test';
}
const {
  PgQueuePublisher,
  PgQueueRunner,
} = require('../../postgres/pg-queue.ts');
const {
  CachingDefinitionLookup,
} = require('../../runtime-common/definition-lookup.ts');
const { IndexWriter } = require('../../runtime-common/index-writer.ts');
const { Worker } = require('../../runtime-common/worker.ts');
const {
  MatrixClient,
  passwordFromSeed,
} = require('../../runtime-common/matrix-client.ts');
const { RealmServer } = require('../../realm-server/server.ts');
const { registerUser } = require('../../realm-server/synapse.ts');
const {
  createRemotePrerenderer,
} = require('../../realm-server/prerender/remote-prerenderer.ts');
const {
  createPrerenderHttpServer,
} = require('../../realm-server/prerender/prerender-app.ts');
const {
  closeServer,
  createRealm,
  createTestPgAdapter,
  createVirtualNetwork,
  getIndexHTML,
  grafanaSecret,
  matrixRegistrationSecret,
  matrixURL,
  realmSecretSeed,
  realmServerSecretSeed,
  testCreatePrerenderAuth,
  waitUntil,
} = require('../../realm-server/tests/helpers/index.ts');

type LooseSingleCardDocument = any;
type QueuePublisher = any;
type QueueRunner = any;
type RealmPermissions = Record<string, string[]>;

const DEFAULT_REALM_PORT = Number(
  process.env.SOFTWARE_FACTORY_REALM_PORT ?? 4444,
);
const DEFAULT_REALM_URL = new URL(
  process.env.SOFTWARE_FACTORY_REALM_URL ??
    `http://127.0.0.1:${DEFAULT_REALM_PORT}/`,
);
const DEFAULT_REALM_DIR = resolve(
  process.cwd(),
  process.env.SOFTWARE_FACTORY_REALM_DIR ?? 'demo-realm',
);
const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';
const DEFAULT_HOST_URL = process.env.HOST_URL ?? 'http://localhost:4200/';
const DEFAULT_BASE_REALM_URL =
  process.env.SOFTWARE_FACTORY_BASE_REALM_URL ?? 'http://localhost:4201/base/';
const DEFAULT_MATRIX_URL = new URL(process.env.MATRIX_URL ?? matrixURL.href);
const DEFAULT_MATRIX_USERNAME =
  process.env.SOFTWARE_FACTORY_MATRIX_USERNAME ?? 'software-factory-backend';
const DEFAULT_MATRIX_SERVER_USERNAME =
  process.env.SOFTWARE_FACTORY_MATRIX_SERVER_USERNAME ??
  'software-factory-realm-server';
const DEFAULT_MATRIX_BROWSER_USERNAME =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
const DEFAULT_PERMISSIONS: RealmPermissions = {
  '*': ['read'],
  [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
};
const TEST_PG_PORT = process.env.PGPORT ?? '55436';
const TEST_PG_HOST = process.env.PGHOST ?? '127.0.0.1';
const TEST_PG_USER = process.env.PGUSER ?? 'postgres';
const CACHE_VERSION = 1;

let prepareTestPgPromise: Promise<void> | undefined;
let ensureMatrixUsersPromise: Promise<void> | undefined;
let ensurePrerequisitesPromise: Promise<void> | undefined;

export interface FactoryRealmOptions {
  realmDir?: string;
  realmURL?: URL;
  permissions?: RealmPermissions;
  useCache?: boolean;
  cacheSalt?: string;
  templateDatabaseName?: string;
}

export interface FactoryRealmTemplate {
  cacheKey: string;
  templateDatabaseName: string;
  fixtureHash: string;
  cacheHit: boolean;
}

export interface StartedFactoryRealm {
  realmDir: string;
  realmURL: URL;
  databaseName: string;
  cardURL(path: string): string;
  createBearerToken(user?: string, permissions?: string[]): string;
  authorizationHeaders(
    user?: string,
    permissions?: string[],
  ): Record<string, string>;
  stop(): Promise<void>;
}

function applyTestPgEnv() {
  process.env.PGHOST = TEST_PG_HOST;
  process.env.PGPORT = TEST_PG_PORT;
  process.env.PGUSER = TEST_PG_USER;
}

function pgAdminConnectionConfig(database = 'postgres') {
  return {
    host: TEST_PG_HOST,
    port: Number(TEST_PG_PORT),
    user: TEST_PG_USER,
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

async function runCommand(command: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    let child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        PGHOST: TEST_PG_HOST,
        PGPORT: TEST_PG_PORT,
        PGUSER: TEST_PG_USER,
      },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`command failed: ${command} ${args.join(' ')} (${code})`),
        );
      }
    });
  });
}

async function canConnectToTestPg(): Promise<boolean> {
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

async function ensureTestPgPrepared() {
  applyTestPgEnv();
  if (!prepareTestPgPromise) {
    prepareTestPgPromise = (async () => {
      if (await canConnectToTestPg()) {
        return;
      }
      let script = resolve(
        process.cwd(),
        '../realm-server/tests/scripts/prepare-test-pg.sh',
      );
      await runCommand('bash', [script], process.cwd());
    })().catch((error) => {
      prepareTestPgPromise = undefined;
      throw error;
    });
  }
  await prepareTestPgPromise;
}

async function ensureServiceReady(
  name: string,
  request: Promise<Response>,
  url: string,
): Promise<void> {
  let response: Response;
  try {
    response = await request;
  } catch (error) {
    throw new Error(
      `${name} is not reachable at ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `${name} is not ready at ${url}: status ${response.status}`,
    );
  }
}

async function ensureFactoryPrerequisites(): Promise<void> {
  if (!ensurePrerequisitesPromise) {
    ensurePrerequisitesPromise = (async () => {
      await ensureServiceReady(
        'Host app',
        fetch(DEFAULT_HOST_URL),
        DEFAULT_HOST_URL,
      );
      let baseInfoURL = new URL('_info', DEFAULT_BASE_REALM_URL).href;
      await ensureServiceReady(
        'Base realm',
        fetch(baseInfoURL, {
          method: 'QUERY',
          headers: {
            Accept: 'application/vnd.api+json',
          },
        }),
        baseInfoURL,
      );
      let matrixVersionsURL = new URL(
        '_matrix/client/versions',
        DEFAULT_MATRIX_URL,
      ).href;
      await ensureServiceReady(
        'Matrix server',
        fetch(matrixVersionsURL),
        matrixVersionsURL,
      );
    })().catch((error) => {
      ensurePrerequisitesPromise = undefined;
      throw error;
    });
  }

  await ensurePrerequisitesPromise;
}

async function ensureFactoryMatrixUser(username: string): Promise<void> {
  let password = await passwordFromSeed(username, realmSecretSeed);
  let loginResponse = await fetch(
    new URL('_matrix/client/v3/login', DEFAULT_MATRIX_URL),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier: {
          type: 'm.id.user',
          user: username,
        },
        password,
        type: 'm.login.password',
      }),
    },
  );

  if (loginResponse.ok) {
    return;
  }

  if (loginResponse.status !== 403) {
    throw new Error(
      `Unable to probe matrix user ${username}: ${loginResponse.status} ${await loginResponse.text()}`,
    );
  }

  try {
    await registerUser({
      matrixURL: DEFAULT_MATRIX_URL,
      displayname: username,
      username,
      password,
      registrationSecret: matrixRegistrationSecret,
    });
  } catch (error) {
    let message = String(error);
    if (
      !message.includes('M_USER_IN_USE') &&
      !message.includes('User ID already taken') &&
      !message.includes('already taken')
    ) {
      throw error;
    }
  }

  let registeredClient = new MatrixClient({
    matrixURL: DEFAULT_MATRIX_URL,
    username,
    seed: realmSecretSeed,
  });
  await registeredClient.login();
}

async function ensureFactoryMatrixUsers(): Promise<void> {
  if (
    !matrixRegistrationSecret ||
    matrixRegistrationSecret === 'software-factory-no-matrix'
  ) {
    return;
  }
  if (!ensureMatrixUsersPromise) {
    ensureMatrixUsersPromise = (async () => {
      await ensureFactoryMatrixUser(DEFAULT_MATRIX_USERNAME);
      await ensureFactoryMatrixUser(DEFAULT_MATRIX_SERVER_USERNAME);
      await ensureFactoryMatrixUser(DEFAULT_MATRIX_BROWSER_USERNAME);
    })().catch((error) => {
      ensureMatrixUsersPromise = undefined;
      throw error;
    });
  }
  await ensureMatrixUsersPromise;
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

function readRealmFixture(
  realmDir: string,
): Record<string, string | LooseSingleCardDocument> {
  let fileSystem: Record<string, string | LooseSingleCardDocument> = {};

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
      let raw = readFileSync(absolutePath, 'utf8');
      if (relativePath.endsWith('.json')) {
        try {
          fileSystem[relativePath] = JSON.parse(raw) as LooseSingleCardDocument;
          continue;
        } catch {
          // fall back to a plain text file if JSON parsing fails
        }
      }
      fileSystem[relativePath] = raw;
    }
  }

  visit(realmDir);
  return fileSystem;
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
  return `sf_bld_${process.pid}_${cacheKey.slice(0, 16)}`;
}

function runtimeDatabaseName(): string {
  return `sf_run_${process.pid}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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

async function waitForQueueIdle(
  databaseName: string,
  timeout = 30000,
): Promise<void> {
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
      timeout,
      interval: 50,
      timeoutMessage: 'waiting for queue to become idle',
    },
  );
}

async function buildTemplate(
  options: Required<
    Pick<FactoryRealmOptions, 'realmDir' | 'realmURL' | 'permissions'>
  > & {
    cacheKey: string;
    templateDatabaseName: string;
  },
): Promise<void> {
  let builderDatabaseName = builderDatabaseNameForCacheKey(options.cacheKey);
  let runtime = await startFactoryRealmServer({
    realmDir: options.realmDir,
    realmURL: options.realmURL,
    permissions: options.permissions,
    useCache: false,
    databaseName: builderDatabaseName,
  });

  try {
    await waitForQueueIdle(builderDatabaseName);
  } finally {
    await runtime.stop({ preserveDatabase: true });
  }

  await createTemplateSnapshot(
    builderDatabaseName,
    options.templateDatabaseName,
  );
  await dropDatabase(builderDatabaseName);
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

  await ensureTestPgPrepared();
  await ensureFactoryPrerequisites();
  if (await databaseExists(templateDatabaseName)) {
    return {
      cacheKey,
      templateDatabaseName,
      fixtureHash,
      cacheHit: true,
    };
  }

  await buildTemplate({
    realmDir,
    realmURL,
    permissions,
    cacheKey,
    templateDatabaseName,
  });

  return {
    cacheKey,
    templateDatabaseName,
    fixtureHash,
    cacheHit: false,
  };
}

async function buildStartedRealm(
  options: Required<
    Pick<FactoryRealmOptions, 'realmDir' | 'realmURL' | 'permissions'>
  > & {
    databaseName: string;
    templateDatabase?: string;
  },
) {
  applyTestPgEnv();
  await ensureFactoryMatrixUsers();

  let fileSystem = readRealmFixture(options.realmDir);
  let runtimeRoot = mkdtempSync(join(tmpdir(), 'software-factory-realm-'));
  let realmPath = join(runtimeRoot, 'realm');
  mkdirSync(realmPath, { recursive: true });

  let dbAdapter = await createTestPgAdapter({
    databaseName: options.databaseName,
    templateDatabase: options.templateDatabase,
  });
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;
  let prerenderer: any;
  let prerenderServer: any;
  let managedPrerenderServer = false;
  let testRealmServer: RealmServer | undefined;
  let httpServer;

  try {
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({
      adapter: dbAdapter,
      workerId: `software-factory-${process.pid}`,
    });
    ({
      prerenderer,
      server: prerenderServer,
      managed: managedPrerenderServer,
    } = await startPrerenderServer());
    let virtualNetwork = createVirtualNetwork();
    let definitionLookup = new CachingDefinitionLookup(
      dbAdapter,
      prerenderer,
      virtualNetwork,
      testCreatePrerenderAuth,
    );
    let worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      dbAdapter,
      queuePublisher: publisher,
      virtualNetwork,
      matrixURL: DEFAULT_MATRIX_URL,
      secretSeed: realmSecretSeed,
      realmServerMatrixUsername: DEFAULT_MATRIX_SERVER_USERNAME,
      prerenderer,
      createPrerenderAuth: testCreatePrerenderAuth,
    });
    await worker.run();

    let { realm } = await createRealm({
      dir: realmPath,
      definitionLookup,
      fileSystem,
      realmURL: options.realmURL.href,
      permissions: options.permissions,
      virtualNetwork,
      publisher,
      dbAdapter,
      cardSizeLimitBytes: undefined,
      fileSizeLimitBytes: undefined,
    });

    virtualNetwork.mount(realm.handle);

    testRealmServer = new RealmServer({
      realms: [realm],
      virtualNetwork,
      matrixClient: new MatrixClient({
        matrixURL: DEFAULT_MATRIX_URL,
        username: DEFAULT_MATRIX_USERNAME,
        seed: realmSecretSeed,
      }),
      realmServerSecretSeed,
      realmSecretSeed,
      matrixRegistrationSecret,
      realmsRootPath: runtimeRoot,
      dbAdapter,
      queue: publisher,
      getIndexHTML,
      grafanaSecret,
      serverURL: new URL(options.realmURL.origin),
      assetsURL: new URL(DEFAULT_HOST_URL),
      definitionLookup,
      prerenderer,
    });

    httpServer = testRealmServer.listen(Number(options.realmURL.port));
    await testRealmServer.start();

    return {
      createBearerToken: (
        user = DEFAULT_REALM_OWNER,
        permissions = DEFAULT_PERMISSIONS[DEFAULT_REALM_OWNER] ?? [
          'read',
          'write',
          'realm-owner',
        ],
      ) =>
        realm.createJWT(
          {
            user,
            realm: realm.url,
            permissions,
            sessionRoom: `software-factory-session-room-for-${user}`,
            realmServerURL: options.realmURL.href,
          },
          '7d',
        ),
      stop: async ({
        preserveDatabase = false,
      }: { preserveDatabase?: boolean } = {}) => {
        let cleanupError: unknown;

        try {
          if (httpServer?.listening) {
            await closeServer(httpServer);
          }
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          await publisher?.destroy();
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          await runner?.destroy();
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          await dbAdapter.close();
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          if (
            managedPrerenderServer &&
            prerenderServer &&
            typeof prerenderServer.__stopPrerenderer === 'function'
          ) {
            await prerenderServer.__stopPrerenderer();
          }
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          if (managedPrerenderServer && prerenderServer?.listening) {
            await closeServer(prerenderServer);
          }
        } catch (error) {
          cleanupError ??= error;
        }

        try {
          if (managedPrerenderServer) {
            await (prerenderer as { stop?: () => Promise<void> })?.stop?.();
          }
        } catch (error) {
          cleanupError ??= error;
        }

        if (!preserveDatabase) {
          try {
            await dropDatabase(options.databaseName);
          } catch (error) {
            cleanupError ??= error;
          }
        }

        try {
          rmSync(runtimeRoot, { recursive: true, force: true });
        } catch (error) {
          cleanupError ??= error;
        }

        if (cleanupError) {
          throw cleanupError;
        }
      },
    };
  } catch (error) {
    try {
      await publisher?.destroy();
    } catch {
      // best effort cleanup
    }
    try {
      await runner?.destroy();
    } catch {
      // best effort cleanup
    }
    try {
      await dbAdapter.close();
    } catch {
      // best effort cleanup
    }
    try {
      if (
        managedPrerenderServer &&
        prerenderServer &&
        typeof prerenderServer.__stopPrerenderer === 'function'
      ) {
        await prerenderServer.__stopPrerenderer();
      }
    } catch {
      // best effort cleanup
    }
    try {
      if (managedPrerenderServer && prerenderServer?.listening) {
        await closeServer(prerenderServer);
      }
    } catch {
      // best effort cleanup
    }
    try {
      if (managedPrerenderServer) {
        await (prerenderer as { stop?: () => Promise<void> })?.stop?.();
      }
    } catch {
      // best effort cleanup
    }
    try {
      await dropDatabase(options.databaseName);
    } catch {
      // best effort cleanup
    }
    rmSync(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

async function startFactoryRealmServer(
  options: FactoryRealmOptions & {
    databaseName?: string;
  } = {},
): Promise<
  StartedFactoryRealm & {
    stop(args?: { preserveDatabase?: boolean }): Promise<void>;
  }
> {
  let realmDir = resolve(options.realmDir ?? DEFAULT_REALM_DIR);
  let realmURL = new URL((options.realmURL ?? DEFAULT_REALM_URL).href);
  let permissions = options.permissions ?? DEFAULT_PERMISSIONS;
  let databaseName = options.databaseName ?? runtimeDatabaseName();

  await ensureTestPgPrepared();
  await ensureFactoryPrerequisites();

  let templateDatabase: string | undefined;
  if (options.templateDatabaseName) {
    templateDatabase = options.templateDatabaseName;
  } else if (options.useCache !== false) {
    templateDatabase = (
      await ensureFactoryRealmTemplate({
        realmDir,
        realmURL,
        permissions,
        cacheSalt: options.cacheSalt,
      })
    ).templateDatabaseName;
  }

  let runtime = await buildStartedRealm({
    realmDir,
    realmURL,
    permissions,
    databaseName,
    templateDatabase,
  });

  return {
    realmDir,
    realmURL,
    databaseName,
    cardURL(path: string) {
      return new URL(path, realmURL).href;
    },
    createBearerToken: runtime.createBearerToken,
    authorizationHeaders(user?: string, permissions?: string[]) {
      return {
        Authorization: `Bearer ${runtime.createBearerToken(user, permissions)}`,
      };
    },
    stop: runtime.stop,
  };
}

export { startFactoryRealmServer };

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

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    let server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('unable to determine free port')));
        return;
      }
      let { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startPrerenderServer(): Promise<{
  prerenderer: any;
  server: any;
  managed: boolean;
}> {
  if (process.env.SOFTWARE_FACTORY_PRERENDER_SERVER_URL) {
    return {
      prerenderer: createRemotePrerenderer(
        process.env.SOFTWARE_FACTORY_PRERENDER_SERVER_URL,
      ),
      server: undefined,
      managed: false,
    };
  }
  let port = await getFreePort();
  let server = createPrerenderHttpServer({
    silent: Boolean(process.env.SILENT_PRERENDERER),
    maxPages: 2,
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    prerenderer: createRemotePrerenderer(`http://127.0.0.1:${port}`),
    server,
    managed: true,
  };
}
