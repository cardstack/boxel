import {
  writeFileSync,
  writeJSONSync,
  readFileSync,
  utimesSync,
  readdirSync,
  statSync,
  ensureDirSync,
} from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { dirname, isAbsolute, join } from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { Client } from 'pg';
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
  clearSessionRooms,
  upsertSessionRoom,
  type MatrixConfig,
  type QueuePublisher,
  type QueueRunner,
  type Definition,
  type Prerenderer,
  CachingDefinitionLookup,
} from '@cardstack/runtime-common';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';
import { dirSync, file, setGracefulCleanup, type DirResult } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse';
import { RealmServer } from '../../server';

import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
  postgresConfig,
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
import { glob } from 'glob';
import { template } from 'lodash';

const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;
const processStartTimeMs = Date.now();

const TEMPLATE_DB_PREFIX = 'test_template';

export const testRealmServerMatrixUsername = 'node-test_realm-server';
export const testRealmServerMatrixUserId = `@${testRealmServerMatrixUsername}:localhost`;

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
export const localBaseRealm = 'http://localhost:4201/';
export const matrixURL = new URL('http://localhost:8008');
const testPrerenderHost = '127.0.0.1';
const testPrerenderPort = 4460;
const testPrerenderURL = `http://${testPrerenderHost}:${testPrerenderPort}`;
const testMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm',
};
export const testRealmInfo = {
  name: 'Test Realm',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  interactHome: null,
  hostHome: null,
  visibility: 'public',
  realmUserId: testMatrix.username,
  publishable: null,
  lastPublishedAt: null,
};

export function buildCardFileSystem(entries: string[]): Record<string, string> {
  let cardsDir = join(__dirname, '..', 'cards');
  let fileSystem: Record<string, string> = {};

  for (let entry of entries) {
    let normalized = entry.replace(/^\.\//, '');
    if (isAbsolute(entry) || normalized.split('/').includes('..')) {
      throw new Error(`Card entry must be within ../cards: ${entry}`);
    }

    let matches: string[] = [];
    let fullPath = join(cardsDir, normalized);

    try {
      let stats = statSync(fullPath);
      if (stats.isDirectory()) {
        matches = glob.sync(`${normalized}/**/*`, {
          cwd: cardsDir,
          nodir: true,
          dot: true,
        });
      } else {
        matches = [normalized];
      }
    } catch {
      matches = glob.sync(normalized, { cwd: cardsDir, dot: true });
    }

    if (matches.length === 0) {
      throw new Error(`No card files matched: ${entry}`);
    }

    for (let match of matches) {
      let matchPath = join(cardsDir, match);
      let stats = statSync(matchPath);
      if (stats.isDirectory()) {
        let nestedMatches = glob.sync(`${match}/**/*`, {
          cwd: cardsDir,
          nodir: true,
          dot: true,
        });
        for (let nested of nestedMatches) {
          if (!fileSystem[nested]) {
            fileSystem[nested] = readFileSync(join(cardsDir, nested), 'utf8');
          }
        }
      } else if (!fileSystem[match]) {
        fileSystem[match] = readFileSync(matchPath, 'utf8');
      }
    }
  }

  return fileSystem;
}

function stableStringify(value: unknown): string {
  let seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
      let sorted: Record<string, unknown> = {};
      for (let key of Object.keys(val).sort()) {
        sorted[key] = (val as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return val;
  });
}

function safeDbName(name: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe database name: ${name}`);
  }
  return name;
}

function adminDbConfig() {
  let config = postgresConfig();
  return { ...config, database: 'postgres' };
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = '';
    let child = spawn(command, args, { env });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      }
    });
  });
}

async function createTemplateDb(options: {
  sourceDbName: string;
  templateDbName: string;
}): Promise<void> {
  let client = new Client(adminDbConfig());
  let start = process.hrtime.bigint();
  let dumpPath = `/tmp/${options.templateDbName}.dump`;
  await client.connect();
  try {
    let existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [options.templateDbName],
    );
    if (existing.rowCount > 0) {
      return;
    }

    let templateDbName = safeDbName(options.templateDbName);
    let sourceDbName = safeDbName(options.sourceDbName);
    await client.query(`CREATE DATABASE ${templateDbName}`);

    await runCommand(
      'docker',
      [
        'exec',
        'boxel-pg',
        'pg_dump',
        '--format=custom',
        '--file',
        dumpPath,
        '--username',
        'postgres',
        sourceDbName,
      ],
      process.env,
    );

    await runCommand(
      'docker',
      [
        'exec',
        'boxel-pg',
        'pg_restore',
        '--no-owner',
        '--no-privileges',
        '--username',
        'postgres',
        '--dbname',
        templateDbName,
        dumpPath,
      ],
      process.env,
    );

    await client.query(`ALTER DATABASE ${templateDbName} IS_TEMPLATE true`);
    await client.query(
      `ALTER DATABASE ${templateDbName} WITH ALLOW_CONNECTIONS false`,
    );
  } finally {
    let durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `[template-db] create template ${options.templateDbName} took ${durationMs.toFixed(
        1,
      )}ms`,
    );
    try {
      await runCommand(
        'docker',
        ['exec', 'boxel-pg', 'rm', '-f', dumpPath],
        process.env,
      );
    } catch {
      // ignore cleanup failures
    }
    await client.end();
  }
}

async function restoreDbFromTemplate(options: {
  targetDbName: string;
  templateDbName: string;
}): Promise<boolean> {
  let client = new Client(adminDbConfig());
  let start = process.hrtime.bigint();
  await client.connect();
  try {
    let existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [options.templateDbName],
    );
    if (existing.rowCount === 0) {
      return false;
    }

    let templateDbName = safeDbName(options.templateDbName);
    let targetDbName = safeDbName(options.targetDbName);
    await client.query(
      `CREATE DATABASE ${targetDbName} WITH TEMPLATE ${templateDbName}`,
    );
    return true;
  } finally {
    let durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `[template-db] restore ${options.targetDbName} from ${options.templateDbName} took ${durationMs.toFixed(
        1,
      )}ms`,
    );
    await client.end();
  }
}

async function dropTestDb(dbName: string): Promise<void> {
  let client = new Client(adminDbConfig());
  await client.connect();
  try {
    let safeName = safeDbName(dbName);
    await client.query(`DROP DATABASE IF EXISTS ${safeName} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

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

async function stopTestPrerenderServer() {
  if (prerenderServer && prerenderServer.listening) {
    await closeServer(prerenderServer);
  }
  prerenderServer = undefined;
  prerenderServerStart = undefined;
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

export function setupDB(
  hooks: NestedHooks,
  args: {
    before?: BeforeAfterCallback;
    after?: BeforeAfterCallback;
    beforeEach?: BeforeAfterCallback;
    afterEach?: BeforeAfterCallback;
  } = {},
  templateDbName?: string,
) {
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let runner: QueueRunner;

  const runBeforeHook = async () => {
    prepareTestDB();
    if (templateDbName) {
      let targetDbName =
        process.env.PGDATABASE ??
        `test_db_${Math.floor(10000000 * Math.random())}`;
      try {
        let restored = await restoreDbFromTemplate({
          targetDbName,
          templateDbName,
        });
        if (!restored) {
          console.warn(
            `[template-db] template not found: ${templateDbName}, continuing without restore`,
          );
        }
      } catch (error) {
        console.warn(
          `[template-db] failed to restore from ${templateDbName}, continuing without restore`,
          error,
        );
      }
    }
    dbAdapter = new PgAdapter({ autoMigrate: true });
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
    if (dbAdapter) {
      await clearSessionRooms(dbAdapter);
    }
    await dbAdapter?.close();
    if (dbAdapter) {
      trackedDbAdapters.delete(dbAdapter);
    }

    if (process.env.PGDATABASE) {
      try {
        await dropTestDb(process.env.PGDATABASE);
      } catch (error) {
        console.warn(
          `[test-setup] failed to drop test db ${process.env.PGDATABASE}`,
          error,
        );
      }
    }
    await stopTestPrerenderServer();
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
  matrixConfig = testMatrix,
  withWorker,
  enableFileWatcher = false,
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
  enableFileWatcher?: boolean;
  // if you are creating a realm  to test it directly without a server, you can
  // also specify `withWorker: true` to also include a worker with your realm
  withWorker?: true;
}): Promise<{ realm: Realm; adapter: RealmAdapter }> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

  for (let [filename, contents] of Object.entries(fileSystem)) {
    let fullPath = join(dir, filename);
    ensureDirSync(dirname(fullPath));

    if (typeof contents === 'string') {
      writeFileSync(fullPath, contents);
    } else {
      writeJSONSync(fullPath, contents);
    }

    let mtime = new Date(processStartTimeMs);
    utimesSync(fullPath, mtime, mtime);
  }

  let adapter = new NodeAdapter(dir, enableFileWatcher);
  let worker: Worker | undefined;
  let prerenderer = await getTestPrerenderer();
  if (withWorker) {
    if (!runner) {
      throw new Error(`must provider a QueueRunner when using withWorker`);
    }
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      dbAdapter,
      queuePublisher: publisher,
      virtualNetwork,
      matrixURL: matrixConfig.url,
      secretSeed: realmSecretSeed,
      realmServerMatrixUsername: testRealmServerMatrixUsername,
      prerenderer,
      createPrerenderAuth: testCreatePrerenderAuth,
    });
  }
  let realmServerMatrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });
  let realm = new Realm({
    url: realmURL,
    adapter,
    matrix: matrixConfig,
    secretSeed: realmSecretSeed,
    virtualNetwork,
    dbAdapter,
    queue: publisher,
    realmServerMatrixClient,
    definitionLookup,
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
  domainsForPublishedRealms = {
    boxelSpace: 'localhost',
    boxelSite: 'localhost',
  },
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
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
}) {
  let prerenderer = await getTestPrerenderer();
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
  } as User;
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
    request: SuperTest<Test>;
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
    let userId = matrixClient.getUserId()!;

    let realmSetup = getRealmSetup();
    let openIdToken = await matrixClient.getOpenIdToken();
    if (!openIdToken) {
      throw new Error('matrixClient did not return an OpenID token');
    }

    let response = await realmSetup.request
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

    let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

    if (!rooms.includes(payload.sessionRoom)) {
      await matrixClient.joinRoom(payload.sessionRoom);
    }

    testAuthRoomId = payload.sessionRoom;

    await upsertSessionRoom(
      realmSetup.dbAdapter,
      realmSetup.testRealm.url,
      userId,
      payload.sessionRoom,
    );
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

export function setupPermissionedRealm(
  hooks: NestedHooks,
  {
    permissions,
    fileSystem,
    onRealmSetup,
    subscribeToRealmEvents = false,
    mode = 'beforeEach',
    published = false,
  }: {
    permissions: RealmPermissions;
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
    published?: boolean;
  },
) {
  if (!fileSystem) {
    fileSystem = buildCardFileSystem(['**/*']);
  }
  let testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;

  setGracefulCleanup();

  let templateDbName = undefined;
  // Only create a template DB for non-published realms
  // based on their permissions and filesystem
  if (!published) {
    let hash = createHash('sha256')
      .update(
        stableStringify({
          permissions,
          fileSystem,
          published,
        }),
      )
      .digest('hex')
      .slice(0, 16);
    templateDbName = `${TEMPLATE_DB_PREFIX}_${hash}_${process.pid}`;
  }

  setupDB(
    hooks,
    {
      [mode]: async (
        dbAdapter: PgAdapter,
        publisher: QueuePublisher,
        runner: QueueRunner,
      ) => {
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

          dbAdapter.execute(
            `INSERT INTO
            published_realms
            (id, owner_username, source_realm_url, published_realm_url)
            VALUES
            (
              '${publishedRealmId}',
              '@user:localhost',
              'http://example.localhost/source',
              '${testRealmHref}'
            )`,
          );
        } else {
          testRealmDir = join(dir.name, 'realm_server_1', 'test');
        }

        ensureDirSync(testRealmDir);

        let virtualNetwork = createVirtualNetwork();

        testRealmServer = await runTestRealmServer({
          virtualNetwork,
          testRealmDir,
          realmsRootPath: join(dir.name, 'realm_server_1'),
          realmURL: testRealmURL,
          permissions,
          dbAdapter,
          runner,
          publisher,
          matrixURL,
          fileSystem,
          enableFileWatcher: subscribeToRealmEvents,
        });
        if (templateDbName) {
          try {
            let sourceDbName =
              process.env.PGDATABASE ??
              dbAdapter.url.split('/').pop() ??
              'boxel';
            await createTemplateDb({
              sourceDbName,
              templateDbName,
            });
          } catch (error) {
            console.warn('[template-db] failed to create template', error);
          }
        }

        let request = supertest(testRealmServer.testRealmHttpServer);

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
    },
    templateDbName,
  );

  hooks[mode === 'beforeEach' ? 'afterEach' : 'after'](async function () {
    testRealmServer.testRealm.unsubscribe();
    if (!testRealmServer.matrixClient.isLoggedIn()) {
      await testRealmServer.matrixClient.login();
    }
    await closeServer(testRealmServer.testRealmHttpServer);
    resetCatalogRealms();
  });
}

export function setupPermissionedRealms(
  hooks: NestedHooks,
  {
    mode = 'beforeEach',
    realms: realmsArg,
    onRealmSetup,
  }: {
    mode?: 'beforeEach' | 'before';
    realms: {
      realmURL: string;
      permissions: RealmPermissions;
      fileSystem?: Record<string, string | LooseSingleCardDocument>;
    }[];
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
  let matrixUsers = ['test_realm', 'node-test_realm'];
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
      for (let [i, realmArg] of realmsArg.entries()) {
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
          matrixConfig: {
            url: matrixURL,
            username: matrixUsers[i] ?? matrixUsers[0],
          },
          dbAdapter,
          publisher,
          runner,
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
    },
    '7d',
  );
}

export const cardInfo = {
  notes: null,
  title: null,
  description: null,
  thumbnailURL: null,
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
  title: {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  description: {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  thumbnailURL: {
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
  'cardInfo.title': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.description': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.thumbnailURL': {
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
  'cardInfo.theme.title': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.description': {
    type: 'contains',
    isComputed: true,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.title': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.description': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.theme.title': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.title': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.description': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.theme.description': {
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
  'cardInfo.theme.cardInfo.theme.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.title': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.title': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.description': {
    type: 'contains',
    isComputed: false,
    fieldOrCard: {
      name: 'StringField',
      module: 'https://cardstack.com/base/card-api',
    },
    isPrimitive: true,
  },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.description': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.thumbnailURL': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.title': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.title':
    {
      type: 'contains',
      isComputed: false,
      fieldOrCard: {
        name: 'StringField',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.description':
    {
      type: 'contains',
      isComputed: false,
      fieldOrCard: {
        name: 'StringField',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.thumbnailURL':
    {
      type: 'contains',
      isComputed: false,
      fieldOrCard: {
        name: 'MaybeBase64Field',
        module: 'https://cardstack.com/base/card-api',
      },
      isPrimitive: true,
    },
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.description': {
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
  'cardInfo.theme.cardInfo.theme.cardInfo.theme.cardInfo.theme.thumbnailURL': {
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
