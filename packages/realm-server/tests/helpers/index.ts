import {
  writeFileSync,
  writeJSONSync,
  readdirSync,
  statSync,
  ensureDirSync,
  copySync,
} from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { join } from 'path';
import { createHash } from 'crypto';
import type {
  LooseSingleCardDocument,
  RealmPermissions,
  User,
  Subscription,
  Plan,
  RealmAdapter,
  DefinitionLookup,
} from '@cardstack/runtime-common';
import {
  Realm,
  baseRealm,
  VirtualNetwork,
  Worker,
  insertPermissions,
  IndexWriter,
  asExpressions,
  query,
  insert,
  param,
  unixTime,
  uuidv4,
  RealmPaths,
  PUBLISHED_DIRECTORY_NAME,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  type MatrixConfig,
  type QueuePublisher,
  type QueueRunner,
  type Definition,
  type Prerenderer,
  CachingDefinitionLookup,
} from '@cardstack/runtime-common';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse';
import { RealmServer } from '../../server';

import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import type { Server } from 'http';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  Prerenderer as LocalPrerenderer,
  type Prerenderer as TestPrerenderer,
} from '../../prerender';

import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import { createRemotePrerenderer } from '../../prerender/remote-prerenderer';
import { createPrerenderHttpServer } from '../../prerender/prerender-app';
import { buildCreatePrerenderAuth } from '../../prerender/auth';
import { Client as PgClient } from 'pg';

const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
const migratedTestDatabaseTemplate = 'boxel_migrated_template';

export const testRealmServerMatrixUsername = 'node-test_realm-server';
export const testRealmServerMatrixUserId = `@${testRealmServerMatrixUsername}:localhost`;

export type RealmRequest = {
  get(path: string): Test;
  post(path: string): Test;
  put(path: string): Test;
  patch(path: string): Test;
  delete(path: string): Test;
  head(path: string): Test;
};

export function withRealmPath(
  request: SuperTest<Test>,
  realmURL: URL,
): RealmRequest {
  let realmPath = realmURL.pathname.replace(/\/?$/, '/');
  let prefixPath = (path: string) => {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    if (path.startsWith(realmPath)) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${realmPath}${path.slice(1)}`;
    }
    return `${realmPath}${path}`;
  };
  return {
    get: (path: string) => request.get(prefixPath(path)),
    post: (path: string) => request.post(prefixPath(path)),
    put: (path: string) => request.put(prefixPath(path)),
    patch: (path: string) => request.patch(prefixPath(path)),
    delete: (path: string) => request.delete(prefixPath(path)),
    head: (path: string) => request.head(prefixPath(path)),
  };
}

export { testRealmHref, testRealmURL };

const REALM_EVENT_TS_SKEW_BUFFER_MS = 2000;

export async function waitUntil<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {},
): Promise<T> {
  let timeout = options.timeout ?? 1000;
  let interval = options.interval ?? 250;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(
    'Timeout waiting for condition' +
      (options.timeoutMessage ? `: ${options.timeoutMessage}` : ''),
  );
}

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4201/base';
export const matrixURL = new URL('http://localhost:8008');
const testPrerenderHost = '127.0.0.1';
const testPrerenderPort = 4460;
const testPrerenderURL = `http://${testPrerenderHost}:${testPrerenderPort}`;

export const testRealmInfo = {
  name: 'Test Realm',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  interactHome: null,
  hostHome: null,
  visibility: 'public',
  realmUserId: testRealmServerMatrixUserId,
  publishable: null,
  lastPublishedAt: null,
};

export const realmServerTestMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm-server',
};
export const realmServerSecretSeed = "mum's the word";
export const realmSecretSeed = `shhh! it's a secret`;
export const grafanaSecret = `shhh! it's a secret`;
export const matrixRegistrationSecret: string =
  getSynapseConfig()!.registration_shared_secret; // as long as synapse has been started at least once, this will always exist
export const testCreatePrerenderAuth =
  buildCreatePrerenderAuth(realmSecretSeed);

let prerenderServer: Server | undefined;
let prerenderServerStart: Promise<void> | undefined;
const trackedServers = new Set<Server>();
const trackedPrerenderers = new Set<TestPrerenderer>();
const trackedDbAdapters = new Set<PgAdapter>();
const trackedQueuePublishers = new Set<QueuePublisher>();
const trackedQueueRunners = new Set<QueueRunner>();

export function cleanWhiteSpace(text: string) {
  return text
    .replace(/<!---->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createVirtualNetwork() {
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  return virtualNetwork;
}

export function prepareTestDB(): void {
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
}

function pgAdminConnectionConfig() {
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: 'postgres',
  };
}

function quotePgIdentifier(identifier: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`unsafe postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function withPgDatabaseEnv<T>(
  databaseName: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  let previousDatabase = process.env.PGDATABASE;
  process.env.PGDATABASE = databaseName;
  try {
    return await fn();
  } finally {
    if (previousDatabase == null) {
      delete process.env.PGDATABASE;
    } else {
      process.env.PGDATABASE = previousDatabase;
    }
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

async function cloneTestDBFromTemplate(templateDatabaseName: string, databaseName?: string): Promise<void> {
  let database = databaseName ?? process.env.PGDATABASE;
  if (!database) {
    throw new Error(
      'PGDATABASE must be set before cloning a test database (call prepareTestDB())',
    );
  }

  if (database === templateDatabaseName) {
    throw new Error(
      `refusing to create test DB using the same name as template database '${templateDatabaseName}'`,
    );
  }

  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(database)} TEMPLATE ${quotePgIdentifier(
        templateDatabaseName,
      )}`,
    );
  } catch (e: any) {
    if (e?.message?.includes('does not exist')) {
      throw new Error(
        `template database '${templateDatabaseName}' is missing. Run packages/realm-server/tests/scripts/prepare-test-pg.sh first.`,
      );
    }
    throw e;
  } finally {
    await client.end();
  }
}

export async function cloneTestDBFromMigratedTemplate(): Promise<void> {
  await cloneTestDBFromTemplate(migratedTestDatabaseTemplate);
}

export async function createTestPgAdapter(options?: {
  templateDatabase?: string;
  databaseName?: string;
}): Promise<PgAdapter> {
  let databaseName = options?.databaseName ?? process.env.PGDATABASE;
  if (!databaseName) {
    throw new Error(
      'PGDATABASE must be set before creating a test adapter (call prepareTestDB())',
    );
  }
  await cloneTestDBFromTemplate(
    options?.templateDatabase ?? migratedTestDatabaseTemplate,
    databaseName,
  );
  return await withPgDatabaseEnv(databaseName, async () => new PgAdapter());
}

export async function closeServer(server: Server) {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
}

function trackServer(server: Server): Server {
  trackedServers.add(server);
  server.once('close', () => trackedServers.delete(server));
  return server;
}

export async function closeTrackedServers(): Promise<void> {
  let servers = [...trackedServers].filter((server) => server.listening);
  await Promise.all(servers.map((server) => closeServer(server)));
}

export function trackPrerenderer(prerenderer: TestPrerenderer): void {
  trackedPrerenderers.add(prerenderer);
}

export function getPrerendererForTesting(options: {
  serverURL: string;
  maxPages?: number;
}): TestPrerenderer {
  let prerenderer = new LocalPrerenderer(options);
  trackPrerenderer(prerenderer);
  return prerenderer;
}

export async function stopTrackedPrerenderers(): Promise<void> {
  let prerenderers = [...trackedPrerenderers];
  trackedPrerenderers.clear();
  await Promise.all(
    prerenderers.map(async (prerenderer) => {
      try {
        await prerenderer.stop();
      } catch {
        // best-effort cleanup
      }
    }),
  );
}

export async function closeTrackedDbAdapters(): Promise<void> {
  let adapters = [...trackedDbAdapters];
  trackedDbAdapters.clear();
  for (let adapter of adapters) {
    if (!adapter.isClosed) {
      try {
        await adapter.close();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

export async function destroyTrackedQueuePublishers(): Promise<void> {
  let publishers = [...trackedQueuePublishers];
  trackedQueuePublishers.clear();
  for (let publisher of publishers) {
    try {
      await publisher.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

export async function destroyTrackedQueueRunners(): Promise<void> {
  let runners = [...trackedQueueRunners];
  trackedQueueRunners.clear();
  for (let runner of runners) {
    try {
      await runner.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

async function waitForQueueIdle(
  dbAdapter: PgAdapter,
  timeout = 30000,
): Promise<void> {
  await waitUntil(
    async () => {
      let [{ count: unfulfilledJobs }] = (await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'unfulfilled'`,
      )) as { count: number }[];
      let [{ count: activeReservations }] = (await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM job_reservations WHERE completed_at IS NULL`,
      )) as { count: number }[];
      return unfulfilledJobs === 0 && activeReservations === 0;
    },
    {
      timeout,
      interval: 50,
      timeoutMessage: 'waiting for queue to become idle',
    },
  );
}

interface CachedPermissionedRealmTemplateEntry {
  refs: number;
  ready: Promise<void>;
}

const permissionedRealmTemplateCache = new Map<
  string,
  CachedPermissionedRealmTemplateEntry
>();
const permissionedRealmTemplateNamePrefix = `rs_tpl_${process.pid}_`;
const permissionedRealmBuilderDbNamePrefix = `rs_bld_${process.pid}_`;
const prerendererCacheIds = new WeakMap<object, number>();
let nextPrerendererCacheId = 1;

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

function hashCacheKeyPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function templateDatabaseNameForCacheKey(cacheKey: string): string {
  return `${permissionedRealmTemplateNamePrefix}${cacheKey.slice(0, 24)}`;
}

function builderDatabaseNameForCacheKey(cacheKey: string): string {
  return `${permissionedRealmBuilderDbNamePrefix}${cacheKey.slice(0, 24)}`;
}

function prerendererCacheKeyPart(prerenderer?: Prerenderer): string | null {
  if (!prerenderer) {
    return null;
  }
  let key = prerenderer as unknown as object;
  let id = prerendererCacheIds.get(key);
  if (!id) {
    id = nextPrerendererCacheId++;
    prerendererCacheIds.set(key, id);
  }
  return `injected:${id}`;
}

async function startTestPrerenderServer(): Promise<string> {
  if (prerenderServer?.listening) {
    return testPrerenderURL;
  }
  if (prerenderServerStart) {
    await prerenderServerStart;
    return testPrerenderURL;
  }
  let server = createPrerenderHttpServer({
    silent: Boolean(process.env.SILENT_PRERENDERER),
    maxPages: 1,
  });
  prerenderServer = server;
  trackServer(server);
  prerenderServerStart = new Promise<void>((resolve, reject) => {
    let onError = (error: Error) => {
      server.off('error', onError);
      prerenderServer = undefined;
      prerenderServerStart = undefined;
      if (server.listening) {
        server.close(() => reject(error));
      } else {
        reject(error);
      }
    };
    server.once('error', onError);
    server.listen(testPrerenderPort, testPrerenderHost, () => {
      server.off('error', onError);
      prerenderServerStart = undefined;
      resolve();
    });
  });
  await prerenderServerStart;
  return testPrerenderURL;
}

export async function stopTestPrerenderServer() {
  if (prerenderServer && prerenderServer.listening) {
    if (hasStopPrerenderer(prerenderServer)) {
      await prerenderServer.__stopPrerenderer?.();
    }
    await closeServer(prerenderServer);
  }
  prerenderServer = undefined;
  prerenderServerStart = undefined;
}

interface StoppablePrerenderServer extends Server {
  __stopPrerenderer?: () => Promise<void>;
}

function hasStopPrerenderer(
  server: Server,
): server is StoppablePrerenderServer {
  return (
    typeof (server as StoppablePrerenderServer).__stopPrerenderer === 'function'
  );
}

export async function getTestPrerenderer(): Promise<Prerenderer> {
  let url = await startTestPrerenderServer();
  return createRemotePrerenderer(url);
}

type BeforeAfterCallback = (
  dbAdapter: PgAdapter,
  publisher: QueuePublisher,
  runner: QueueRunner,
) => Promise<void>;

type TestDatabaseTemplateProvider = string | (() => string | undefined);

export function setupDB(
  hooks: NestedHooks,
  args: {
    before?: BeforeAfterCallback;
    after?: BeforeAfterCallback;
    beforeEach?: BeforeAfterCallback;
    afterEach?: BeforeAfterCallback;
    templateDatabase?: TestDatabaseTemplateProvider;
  } = {},
) {
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let runner: QueueRunner;

  const runBeforeHook = async () => {
    prepareTestDB();
    let templateDatabase =
      typeof args.templateDatabase === 'function'
        ? args.templateDatabase()
        : args.templateDatabase;
    dbAdapter = await createTestPgAdapter({
      templateDatabase,
    });
    trackedDbAdapters.add(dbAdapter);
    publisher = new PgQueuePublisher(dbAdapter);
    trackedQueuePublishers.add(publisher);
    runner = new PgQueueRunner({ adapter: dbAdapter, workerId: 'test-worker' });
    trackedQueueRunners.add(runner);
  };

  const runAfterHook = async () => {
    await publisher?.destroy();
    if (publisher) {
      trackedQueuePublishers.delete(publisher);
    }
    await runner?.destroy();
    if (runner) {
      trackedQueueRunners.delete(runner);
    }
    await dbAdapter?.close();
    if (dbAdapter) {
      trackedDbAdapters.delete(dbAdapter);
    }
  };

  // we need to pair before/after and beforeEach/afterEach. within this setup
  // function we can't mix before/after with beforeEach/afterEach as that will
  // result in an unbalanced DB lifecycle (e.g. creating a DB in the before hook and
  // destroying in the afterEach hook)
  if (args.before) {
    if (args.beforeEach || args.afterEach) {
      throw new Error(
        `cannot pair a "before" hook with a "beforeEach" or "afterEach" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
      );
    }
    hooks.before(async function () {
      await runBeforeHook();
      await args.before!(dbAdapter, publisher, runner);
    });

    hooks.after(async function () {
      await args.after?.(dbAdapter, publisher, runner);
      await runAfterHook();
    });
  }

  if (args.beforeEach) {
    if (args.before || args.after) {
      throw new Error(
        `cannot pair a "beforeEach" hook with a "before" or "after" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
      );
    }
    hooks.beforeEach(async function () {
      await runBeforeHook();
      await args.beforeEach!(dbAdapter, publisher, runner);
    });

    hooks.afterEach(async function () {
      await args.afterEach?.(dbAdapter, publisher, runner);
      await runAfterHook();
    });
  }
}

export async function getIndexHTML() {
  let url = process.env.HOST_URL ?? 'http://localhost:4200/';
  let request = await fetch(url);
  return await request.text();
}

export async function createRealm({
  dir,
  definitionLookup,
  fileSystem = {},
  realmURL = testRealm,
  permissions = { '*': ['read'] },
  virtualNetwork,
  runner,
  publisher,
  dbAdapter,
  withWorker,
  prerenderer: providedPrerenderer,
  enableFileWatcher = false,
  cardSizeLimitBytes,
  fileSizeLimitBytes,
}: {
  dir: string;
  definitionLookup: DefinitionLookup;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL?: string;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  matrixConfig?: MatrixConfig;
  publisher: QueuePublisher;
  runner?: QueueRunner;
  dbAdapter: PgAdapter;
  deferStartUp?: true;
  prerenderer?: Prerenderer;
  enableFileWatcher?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
  // if you are creating a realm  to test it directly without a server, you can
  // also specify `withWorker: true` to also include a worker with your realm
  withWorker?: true;
}): Promise<{ realm: Realm; adapter: RealmAdapter }> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

  for (let username of Object.keys(permissions)) {
    if (username !== '*') {
      await ensureTestUser(dbAdapter, username);
    }
  }

  for (let [filename, contents] of Object.entries(fileSystem)) {
    if (typeof contents === 'string') {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }

  let adapter = new NodeAdapter(dir, enableFileWatcher);
  let worker: Worker | undefined;
  if (withWorker) {
    if (!runner) {
      throw new Error(`must provider a QueueRunner when using withWorker`);
    }
    let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      dbAdapter,
      queuePublisher: publisher,
      virtualNetwork,
      matrixURL: realmServerTestMatrix.url,
      secretSeed: realmSecretSeed,
      realmServerMatrixUsername: testRealmServerMatrixUsername,
      prerenderer,
      createPrerenderAuth: testCreatePrerenderAuth,
    });
  }
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });
  let realm = new Realm({
    url: realmURL,
    adapter,
    secretSeed: realmSecretSeed,
    virtualNetwork,
    dbAdapter,
    queue: publisher,
    matrixClient,
    realmServerURL: new URL(new URL(realmURL).origin).href,
    definitionLookup,
    cardSizeLimitBytes:
      cardSizeLimitBytes ??
      Number(
        process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
      ),
    fileSizeLimitBytes:
      fileSizeLimitBytes ??
      Number(
        process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
      ),
  });
  if (worker) {
    virtualNetwork.mount(realm.handle);
    await worker.run();
  }
  return { realm, adapter };
}

export async function runTestRealmServer({
  testRealmDir,
  realmsRootPath,
  fileSystem,
  realmURL,
  virtualNetwork,
  publisher,
  runner,
  dbAdapter,
  matrixConfig,
  matrixURL,
  permissions = { '*': ['read'] },
  enableFileWatcher = false,
  cardSizeLimitBytes,
  fileSizeLimitBytes,
  domainsForPublishedRealms = {
    boxelSpace: 'localhost',
    boxelSite: 'localhost',
  },
  prerenderer: providedPrerenderer,
}: {
  testRealmDir: string;
  realmsRootPath: string;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL: URL;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  publisher: QueuePublisher;
  runner: QueueRunner;
  dbAdapter: PgAdapter;
  matrixURL: URL;
  matrixConfig?: MatrixConfig;
  enableFileWatcher?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
  prerenderer?: Prerenderer;
}) {
  let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
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
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
    createPrerenderAuth: testCreatePrerenderAuth,
  });
  await worker.run();
  let { realm: testRealm, adapter: testRealmAdapter } = await createRealm({
    dir: testRealmDir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork,
    matrixConfig,
    publisher,
    dbAdapter,
    enableFileWatcher,
    definitionLookup,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  });

  await testRealm.logInToMatrix();

  virtualNetwork.mount(testRealm.handle);
  let realms = [testRealm];
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });

  let testRealmServer = new RealmServer({
    realms,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue: publisher,
    getIndexHTML,
    grafanaSecret,
    serverURL: new URL(realmURL.origin),
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
    domainsForPublishedRealms,
    definitionLookup,
    prerenderer,
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(realmURL.port));
  trackServer(testRealmHttpServer);
  await testRealmServer.start();
  return {
    testRealmDir,
    testRealm,
    testRealmServer,
    testRealmHttpServer,
    testRealmAdapter,
    matrixClient,
  };
}

// Use when a single RealmServer instance must expose multiple realms
// (e.g. server endpoints that federate across realms like /_search).
export async function runTestRealmServerWithRealms({
  realmsRootPath,
  realms,
  virtualNetwork,
  publisher,
  runner,
  dbAdapter,
  matrixURL,
  enableFileWatcher = false,
  domainsForPublishedRealms = {
    boxelSpace: 'localhost',
    boxelSite: 'localhost',
  },
  prerenderer: providedPrerenderer,
}: {
  realmsRootPath: string;
  realms: {
    realmURL: URL;
    fileSystem?: Record<string, string | LooseSingleCardDocument>;
    permissions?: RealmPermissions;
    matrixConfig?: MatrixConfig;
  }[];
  virtualNetwork: VirtualNetwork;
  publisher: QueuePublisher;
  runner: QueueRunner;
  dbAdapter: PgAdapter;
  matrixURL: URL;
  enableFileWatcher?: boolean;
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
  prerenderer?: Prerenderer;
}) {
  ensureDirSync(realmsRootPath);

  let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
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
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
    createPrerenderAuth: testCreatePrerenderAuth,
  });
  await worker.run();

  let createdRealms: Realm[] = [];
  let realmAdapters: RealmAdapter[] = [];
  let matrixUsers = ['test_realm', 'node-test_realm'];

  for (let [index, realmConfig] of realms.entries()) {
    let realmDir = join(realmsRootPath, `realm_${index}`);
    ensureDirSync(realmDir);
    let { realm, adapter } = await createRealm({
      dir: realmDir,
      fileSystem: realmConfig.fileSystem,
      realmURL: realmConfig.realmURL.href,
      permissions: realmConfig.permissions,
      virtualNetwork,
      matrixConfig: realmConfig.matrixConfig ?? {
        url: matrixURL,
        username: matrixUsers[index] ?? matrixUsers[0],
      },
      publisher,
      dbAdapter,
      enableFileWatcher,
      definitionLookup,
    });
    await realm.logInToMatrix();
    virtualNetwork.mount(realm.handle);
    createdRealms.push(realm);
    realmAdapters.push(adapter);
  }

  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });

  let serverURL = new URL(realms[0].realmURL.origin);
  let testRealmServer = new RealmServer({
    realms: createdRealms,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue: publisher,
    getIndexHTML,
    grafanaSecret,
    serverURL,
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
    domainsForPublishedRealms,
    definitionLookup,
    prerenderer,
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(serverURL.port));
  trackServer(testRealmHttpServer);
  await testRealmServer.start();

  return {
    realms: createdRealms,
    realmAdapters,
    testRealmServer,
    testRealmHttpServer,
    matrixClient,
  };
}

// Spins up one RealmServer per realm. Use for cross-realm behavior that doesn't
// require a shared server (authorization, permissions, etc.).
export function setupPermissionedRealms(
  hooks: NestedHooks,
  {
    mode = 'beforeEach',
    realms: realmsArg,
    onRealmSetup,
    prerenderer,
  }: {
    mode?: 'beforeEach' | 'before';
    realms: {
      realmURL: string;
      permissions: RealmPermissions;
      fileSystem?: Record<string, string | LooseSingleCardDocument>;
    }[];
    prerenderer?: Prerenderer;
    onRealmSetup?: (args: {
      dbAdapter: PgAdapter;
      realms: {
        realm: Realm;
        realmPath: string;
        realmHttpServer: Server;
        realmAdapter: RealmAdapter;
      }[];
    }) => void;
  },
) {
  // We want 2 different realm users to test authorization between them - these
  // names are selected because they are already available in the test
  // environment (via register-realm-users.ts)
  let realms: {
    realm: Realm;
    realmPath: string;
    realmHttpServer: Server;
    realmAdapter: RealmAdapter;
  }[] = [];
  let _dbAdapter: PgAdapter;
  setupDB(hooks, {
    [mode]: async (
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) => {
      _dbAdapter = dbAdapter;
      for (let realmArg of realmsArg.values()) {
        let {
          testRealmDir: realmPath,
          testRealm: realm,
          testRealmHttpServer: realmHttpServer,
          testRealmAdapter: realmAdapter,
        } = await runTestRealmServer({
          virtualNetwork: await createVirtualNetwork(),
          testRealmDir: dirSync().name,
          realmsRootPath: dirSync().name,
          realmURL: new URL(realmArg.realmURL),
          fileSystem: realmArg.fileSystem,
          permissions: realmArg.permissions,
          matrixURL,
          dbAdapter,
          publisher,
          runner,
          prerenderer,
        });
        realms.push({
          realm,
          realmPath,
          realmHttpServer,
          realmAdapter,
        });
      }
      onRealmSetup?.({
        dbAdapter: _dbAdapter!,
        realms,
      });
    },
  });

  hooks[mode === 'beforeEach' ? 'afterEach' : 'after'](async function () {
    for (let realm of realms) {
      realm.realm.__testOnlyClearCaches();
      await closeServer(realm.realmHttpServer);
    }
    realms = [];
  });
}

export async function insertUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
  stripeCustomerEmail: string | null,
): Promise<User> {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    stripe_customer_id: stripeCustomerId,
    stripe_customer_email: stripeCustomerEmail,
  });
  let result = await query(
    dbAdapter,
    insert('users', nameExpressions, valueExpressions),
  );

  return {
    id: result[0].id,
    matrixUserId: result[0].matrix_user_id,
    stripeCustomerId: result[0].stripe_customer_id,
    stripeCustomerEmail: result[0].stripe_customer_email,
    sessionRoomId: result[0].session_room_id ?? null,
  } as User;
}

export async function ensureTestUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
) {
  await dbAdapter.execute(
    `INSERT INTO users (matrix_user_id) VALUES ($1) ON CONFLICT (matrix_user_id) DO NOTHING`,
    { bind: [matrixUserId] },
  );
}

export async function insertPlan(
  dbAdapter: PgAdapter,
  name: string,
  monthlyPrice: number,
  creditsIncluded: number,
  stripePlanId: string,
): Promise<Plan> {
  let { valueExpressions, nameExpressions: nameExpressions } = asExpressions({
    name,
    monthly_price: monthlyPrice,
    credits_included: creditsIncluded,
    stripe_plan_id: stripePlanId,
  });
  let result = await query(
    dbAdapter,
    insert('plans', nameExpressions, valueExpressions),
  );
  return {
    id: result[0].id,
    name: result[0].name,
    monthlyPrice: parseFloat(result[0].monthly_price as string),
    creditsIncluded: result[0].credits_included,
    stripePlanId: result[0].stripe_plan_id,
  } as Plan;
}

export async function fetchSubscriptionsByUserId(
  dbAdapter: PgAdapter,
  userId: string,
): Promise<Subscription[]> {
  let results = (await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
  ])) as {
    id: string;
    user_id: string;
    plan_id: string;
    started_at: number;
    ended_at: number;
    status: string;
    stripe_subscription_id: string;
  }[];

  return results.map((result) => ({
    id: result.id,
    userId: result.user_id,
    planId: result.plan_id,
    startedAt: result.started_at,
    endedAt: result.ended_at,
    status: result.status,
    stripeSubscriptionId: result.stripe_subscription_id,
  }));
}

export function mtimes(
  path: string,
  realmURL: URL,
): { [path: string]: number } {
  const mtimes: { [path: string]: number } = {};
  let paths = new RealmPaths(realmURL);

  function traverseDir(currentPath: string) {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        traverseDir(fullPath);
      } else if (entry.isFile()) {
        const stats = statSync(fullPath);
        mtimes[paths.fileURL(fullPath.substring(path.length)).href] = unixTime(
          stats.mtime.getTime(),
        );
      }
    }
  }
  traverseDir(path);
  return mtimes;
}

export async function insertJob(
  dbAdapter: PgAdapter,
  params: {
    job_type: string;
    args?: Record<string, any>;
    concurrency_group?: string | null;
    timeout?: number;
    status?: string;
    finished_at?: string | null;
    result?: Record<string, any> | null;
    priority?: number;
  },
): Promise<Record<string, any>> {
  let { valueExpressions, nameExpressions: nameExpressions } = asExpressions({
    job_type: params.job_type,
    args: params.args ?? {},
    concurrency_group: params.concurrency_group ?? null,
    timeout: params.timeout ?? 240,
    status: params.status ?? 'unfulfilled',
    finished_at: params.finished_at ?? null,
    result: params.result ?? null,
    priority: params.priority ?? 0,
  });
  let result = await query(
    dbAdapter,
    insert('jobs', nameExpressions, valueExpressions),
  );
  return {
    id: result[0].id,
    job_type: result[0].job_type,
    args: result[0].args,
    concurrency_group: result[0].concurrency_group,
    timeout: result[0].timeout,
    status: result[0].status,
    finished_at: result[0].finished_at,
    result: result[0].result,
    priority: result[0].priority,
  };
}

export function setupMatrixRoom(
  hooks: NestedHooks,
  getRealmSetup: () => {
    testRealm: Realm;
    testRealmHttpServer: Server;
    request: { post(path: string): Test };
    serverRequest?: SuperTest<Test>;
    dir: DirResult;
    dbAdapter: PgAdapter;
  },
) {
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: 'node-test_realm',
    seed: realmSecretSeed,
  });

  let testAuthRoomId: string | undefined;

  hooks.beforeEach(async function () {
    await matrixClient.login();

    let realmSetup = getRealmSetup();
    let openIdToken = await matrixClient.getOpenIdToken();
    if (!openIdToken) {
      throw new Error('matrixClient did not return an OpenID token');
    }

    let response = await (realmSetup.serverRequest ?? realmSetup.request)
      .post('/_server-session')
      .send(JSON.stringify(openIdToken))
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json');

    let jwt = response.header['authorization'];
    if (!jwt) {
      throw new Error('Realm server did not send Authorization header');
    }

    let payload = JSON.parse(
      Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'),
    ) as { sessionRoom: string };
    console.log('Session room', payload.sessionRoom);

    let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

    if (!rooms.includes(payload.sessionRoom)) {
      await matrixClient.joinRoom(payload.sessionRoom);
    }

    testAuthRoomId = payload.sessionRoom;
  });

  return {
    matrixClient,
    getMessagesSince: async function (since: number) {
      let allMessages = await matrixClient.roomMessages(testAuthRoomId!);
      // Allow same-ms clock values between the test process and matrix so we don't
      // miss events that are emitted immediately after we record the start time.
      let messagesAfterSentinel = allMessages.filter(
        (m) => m.origin_server_ts >= since,
      );

      return messagesAfterSentinel;
    },
  };
}

export async function waitForRealmEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
  options: {
    predicate?: (event: RealmEvent) => boolean;
    timeout?: number;
    timeoutMessage?: string;
  } = {},
): Promise<RealmEvent> {
  let { predicate = () => true, timeout, timeoutMessage } = options;

  let event = await waitUntil<RealmEvent | undefined>(
    async () => {
      let findMatchingEvent = (messages: MatrixEvent[]) =>
        messages.find((event): event is RealmEvent => {
          if (event.type !== APP_BOXEL_REALM_EVENT_TYPE) {
            return false;
          }
          return predicate(event as RealmEvent);
        });

      let matrixMessages = await getMessagesSince(since);
      let matchingEvent = findMatchingEvent(matrixMessages);

      if (!matchingEvent) {
        let skewedSince = Math.max(0, since - REALM_EVENT_TS_SKEW_BUFFER_MS);
        if (skewedSince !== since) {
          let skewedMessages = await getMessagesSince(skewedSince);
          matchingEvent = findMatchingEvent(skewedMessages);
        }
      }

      if (matchingEvent) {
        return matchingEvent;
      }

      return undefined;
    },
    {
      timeout: timeout ?? 5000,
      timeoutMessage,
    },
  );

  return event!;
}

export function findRealmEvent(
  events: MatrixEvent[],
  eventName: string,
  indexType: string,
): RealmEvent | undefined {
  return events.find(
    (m) =>
      m.type === APP_BOXEL_REALM_EVENT_TYPE &&
      m.content.eventName === eventName &&
      (realmEventIsIndex(m.content) ? m.content.indexType === indexType : true),
  ) as RealmEvent | undefined;
}

function realmEventIsIndex(
  event: RealmEventContent,
): event is IncrementalIndexEventContent {
  return event.eventName === 'index';
}

type InternalPermissionedRealmSetupOptions = {
  permissions: RealmPermissions;
  realmURL?: URL;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  subscribeToRealmEvents?: boolean;
  prerenderer?: Prerenderer;
  published?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
};

async function startPermissionedRealmFixture(
  dbAdapter: PgAdapter,
  publisher: QueuePublisher,
  runner: QueueRunner,
  {
    permissions,
    realmURL,
    fileSystem,
    subscribeToRealmEvents = false,
    prerenderer,
    published = false,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  }: InternalPermissionedRealmSetupOptions,
): Promise<{
  testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;
  request: SuperTest<Test>;
  dir: DirResult;
}> {
  let resolvedRealmURL = realmURL ?? testRealmURL;
  let dir = dirSync();

  let testRealmDir;

  if (published) {
    let publishedRealmId = uuidv4();

    testRealmDir = join(
      dir.name,
      'realm_server_1',
      PUBLISHED_DIRECTORY_NAME,
      publishedRealmId,
    );

    await dbAdapter.execute(
      `INSERT INTO
        published_realms
        (id, owner_username, source_realm_url, published_realm_url)
        VALUES
        (
          '${publishedRealmId}',
          '@user:localhost',
          'http://example.localhost/source',
          '${resolvedRealmURL.href}'
        )`,
    );
  } else {
    testRealmDir = join(dir.name, 'realm_server_1', 'test');
  }

  ensureDirSync(testRealmDir);

  // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
  if (!fileSystem) {
    copySync(join(__dirname, '..', 'cards'), testRealmDir);
  }

  let virtualNetwork = createVirtualNetwork();

  let testRealmServer = await runTestRealmServer({
    virtualNetwork,
    testRealmDir,
    realmsRootPath: join(dir.name, 'realm_server_1'),
    realmURL: resolvedRealmURL,
    permissions,
    dbAdapter,
    runner,
    publisher,
    matrixURL,
    fileSystem,
    enableFileWatcher: subscribeToRealmEvents,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
    prerenderer,
  });

  let request = supertest(testRealmServer.testRealmHttpServer);

  return {
    testRealmServer,
    request,
    dir,
  };
}

async function teardownPermissionedRealmFixture(
  testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>,
): Promise<void> {
  testRealmServer.testRealm.unsubscribe();
  if (!testRealmServer.matrixClient.isLoggedIn()) {
    await testRealmServer.matrixClient.login();
  }
  await closeServer(testRealmServer.testRealmHttpServer);
  resetCatalogRealms();
}

export function setupPermissionedRealm(
  hooks: NestedHooks,
  {
    permissions,
    realmURL,
    fileSystem,
    onRealmSetup,
    subscribeToRealmEvents = false,
    mode = 'beforeEach',
    prerenderer,
    dbTemplateDatabase,
    published = false,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  }: {
    permissions: RealmPermissions;
    realmURL?: URL;
    fileSystem?: Record<string, string | LooseSingleCardDocument>;
    onRealmSetup?: (args: {
      dbAdapter: PgAdapter;
      testRealm: Realm;
      testRealmPath: string;
      testRealmHttpServer: Server;
      testRealmAdapter: RealmAdapter;
      request: SuperTest<Test>;
      dir: DirResult;
    }) => void;
    subscribeToRealmEvents?: boolean;
    mode?: 'beforeEach' | 'before';
    prerenderer?: Prerenderer;
    // Internal hook used by cached setup wrappers
    dbTemplateDatabase?: TestDatabaseTemplateProvider;
    published?: boolean;
    cardSizeLimitBytes?: number;
    fileSizeLimitBytes?: number;
  },
) {
  let testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;

  setGracefulCleanup();

  setupDB(hooks, {
    templateDatabase: dbTemplateDatabase,
    [mode]: async (
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) => {
      let { testRealmServer: server, request, dir } =
        await startPermissionedRealmFixture(dbAdapter, publisher, runner, {
          realmURL,
          fileSystem,
          permissions,
          subscribeToRealmEvents,
          prerenderer,
          published,
          cardSizeLimitBytes,
          fileSizeLimitBytes,
        });
      testRealmServer = server;

      onRealmSetup?.({
        dbAdapter,
        testRealm: testRealmServer.testRealm,
        testRealmPath: testRealmServer.testRealmDir,
        testRealmHttpServer: testRealmServer.testRealmHttpServer,
        testRealmAdapter: testRealmServer.testRealmAdapter,
        request,
        dir,
      });
    },
  });

  hooks[mode === 'beforeEach' ? 'afterEach' : 'after'](async function () {
    await teardownPermissionedRealmFixture(testRealmServer);
  });
}

export function setupPermissionedRealmAtURL(
  hooks: NestedHooks,
  realmURL: URL,
  options: Omit<Parameters<typeof setupPermissionedRealm>[1], 'realmURL'>,
) {
  return setupPermissionedRealm(hooks, {
    ...options,
    realmURL,
  });
}

type SetupPermissionedRealmCachedOptions = Omit<
  Parameters<typeof setupPermissionedRealm>[1],
  'dbTemplateDatabase'
> & {
  useTemplateCache?: boolean;
};

function permissionedRealmTemplateCacheKey(
  options: SetupPermissionedRealmCachedOptions,
): string {
  let resolvedRealmURL = options.realmURL ?? testRealmURL;
  return hashCacheKeyPayload({
    version: 1,
    type: 'permissioned-realm',
    realmURL: resolvedRealmURL.href,
    permissions: options.permissions,
    fileSystem: options.fileSystem ?? null,
    subscribeToRealmEvents: Boolean(options.subscribeToRealmEvents),
    published: Boolean(options.published),
    cardSizeLimitBytes: options.cardSizeLimitBytes ?? null,
    fileSizeLimitBytes: options.fileSizeLimitBytes ?? null,
    prerenderer: prerendererCacheKeyPart(options.prerenderer),
  });
}

async function buildPermissionedRealmTemplate(
  cacheKey: string,
  options: SetupPermissionedRealmCachedOptions,
): Promise<void> {
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);

  let dbAdapter: PgAdapter | undefined;
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;
  let fixture: Awaited<ReturnType<typeof startPermissionedRealmFixture>> | undefined;

  await dropDatabase(templateDatabaseName);
  await dropDatabase(builderDatabaseName);

  try {
    dbAdapter = await createTestPgAdapter({
      databaseName: builderDatabaseName,
      templateDatabase: migratedTestDatabaseTemplate,
    });
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({ adapter: dbAdapter, workerId: 'template-worker' });

    fixture = await startPermissionedRealmFixture(dbAdapter, publisher, runner, {
      realmURL: options.realmURL,
      fileSystem: options.fileSystem,
      permissions: options.permissions,
      subscribeToRealmEvents: options.subscribeToRealmEvents,
      prerenderer: options.prerenderer,
      published: options.published,
      cardSizeLimitBytes: options.cardSizeLimitBytes,
      fileSizeLimitBytes: options.fileSizeLimitBytes,
    });

    await waitForQueueIdle(dbAdapter);
    await teardownPermissionedRealmFixture(fixture.testRealmServer);
    fixture = undefined;

    await publisher.destroy();
    publisher = undefined;
    await runner.destroy();
    runner = undefined;
    await dbAdapter.close();
    dbAdapter = undefined;

    await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
  } finally {
    if (fixture) {
      try {
        await teardownPermissionedRealmFixture(fixture.testRealmServer);
      } catch {
        // best-effort cleanup
      }
    }
    if (publisher) {
      try {
        await publisher.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (runner) {
      try {
        await runner.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (dbAdapter && !dbAdapter.isClosed) {
      try {
        await dbAdapter.close();
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await dropDatabase(builderDatabaseName);
    } catch {
      // best-effort cleanup
    }
  }
}

async function acquirePermissionedRealmTemplate(
  options: SetupPermissionedRealmCachedOptions,
): Promise<{ cacheKey: string; templateDatabaseName: string }> {
  let cacheKey = permissionedRealmTemplateCacheKey(options);
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let existing = permissionedRealmTemplateCache.get(cacheKey);
  if (existing) {
    existing.refs++;
    await existing.ready;
    return { cacheKey, templateDatabaseName };
  }

  let entry: CachedPermissionedRealmTemplateEntry = {
    refs: 1,
    ready: Promise.resolve(),
  };
  entry.ready = buildPermissionedRealmTemplate(cacheKey, options).catch(
    async (error) => {
      permissionedRealmTemplateCache.delete(cacheKey);
      try {
        await dropDatabase(templateDatabaseName);
      } catch {
        // best-effort cleanup
      }
      throw error;
    },
  );
  permissionedRealmTemplateCache.set(cacheKey, entry);
  await entry.ready;
  return { cacheKey, templateDatabaseName };
}

async function releasePermissionedRealmTemplate(cacheKey: string): Promise<void> {
  let entry = permissionedRealmTemplateCache.get(cacheKey);
  if (!entry) {
    return;
  }
  entry.refs--;
}

export function setupPermissionedRealmCached(
  hooks: NestedHooks,
  options: SetupPermissionedRealmCachedOptions,
) {
  let { useTemplateCache = true, ...setupOptions } = options;
  if (!useTemplateCache) {
    return setupPermissionedRealm(hooks, setupOptions);
  }

  let acquiredTemplateDatabase: string | undefined;
  let acquiredCacheKey: string | undefined;

  hooks.before(async function () {
    let { cacheKey, templateDatabaseName } =
      await acquirePermissionedRealmTemplate(setupOptions);
    acquiredCacheKey = cacheKey;
    acquiredTemplateDatabase = templateDatabaseName;
  });

  setupPermissionedRealm(hooks, {
    ...setupOptions,
    dbTemplateDatabase: () => acquiredTemplateDatabase,
  });

  hooks.after(async function () {
    if (acquiredCacheKey) {
      let cacheKey = acquiredCacheKey;
      acquiredCacheKey = undefined;
      acquiredTemplateDatabase = undefined;
      await releasePermissionedRealmTemplate(cacheKey);
    }
  });
}

export function setupPermissionedRealmCachedAtURL(
  hooks: NestedHooks,
  realmURL: URL,
  options: Omit<SetupPermissionedRealmCachedOptions, 'realmURL'>,
) {
  return setupPermissionedRealmCached(hooks, {
    ...options,
    realmURL,
  });
}

// Spins up one RealmServer per realm. Use for cross-realm behavior that doesn't
// require a shared server (authorization, permissions, etc.).

export function createJWT(
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
      realmServerURL: realm.realmServerURL,
    },
    '7d',
  );
}

export const cardInfo = {
  notes: null,
  name: null,
  summary: null,
  cardThumbnailURL: null,
};

export const cardDefinition: Definition['fields'] = {
  id: {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'ReadOnlyField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  cardTitle: {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  cardDescription: {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  cardThumbnailURL: {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  cardInfo: {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CardInfoField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.name': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.summary': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.cardThumbnailURL': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.notes': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MarkdownField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme': {
    type: 'linksTo',
    isComputed: false,
    fieldOrCard: {
      name: 'Theme',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.id': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'ReadOnlyField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardTitle': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardDescription': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardThumbnailURL': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CardInfoField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.name': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.summary': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.cardThumbnailURL': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.notes': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MarkdownField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cssVariables': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CSSField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cssImports': {
    type: 'containsMany',
    isComputed: false,
    fieldOrCard: {
      name: 'CssImportField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme': {
    type: 'linksTo',
    isComputed: false,
    fieldOrCard: {
      name: 'Theme',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.id': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'ReadOnlyField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardTitle': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CardInfoField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.name': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.summary': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.cardThumbnailURL': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.notes': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MarkdownField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardDescription': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cssVariables': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CSSField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cssImports': {
    type: 'containsMany',
    isComputed: false,
    fieldOrCard: {
      name: 'CssImportField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardThumbnailURL': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme': {
    type: 'linksTo',
    isComputed: false,
    fieldOrCard: {
      name: 'Theme',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.id': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'ReadOnlyField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardTitle': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CardInfoField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.name': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.summary': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.cardThumbnailURL': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.notes': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'MarkdownField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardDescription': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cssVariables': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CSSField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cssImports': {
    type: 'containsMany',
    isComputed: false,
    fieldOrCard: {
      name: 'CssImportField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardThumbnailURL': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'MaybeBase64Field',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme': {
    type: 'linksTo',
    isComputed: false,
    fieldOrCard: {
      name: 'Theme',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.id': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'ReadOnlyField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardTitle': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CardInfoField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: false,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.name': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.summary':
    {
      type: 'contains',
      isComputed: false,
      fieldOrCard: {
        name: 'StringField',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.cardThumbnailURL':
    {
      type: 'contains',
      isComputed: false,
      fieldOrCard: {
        name: 'MaybeBase64Field',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardDescription':
    {
      type: 'contains',
      isComputed: true,
      fieldOrCard: {
        name: 'StringField',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cssVariables': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'CSSField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cssImports': {
    type: 'containsMany',
    isComputed: false,
    fieldOrCard: {
      name: 'CssImportField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardThumbnailURL':
    {
      type: 'contains',
      isComputed: true,
      fieldOrCard: {
        name: 'MaybeBase64Field',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme':
    {
      type: 'linksTo',
      isComputed: false,
      fieldOrCard: {
        name: 'Theme',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: false,
    },
};
