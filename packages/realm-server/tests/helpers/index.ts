import {
  writeFileSync,
  writeJSONSync,
  readdirSync,
  statSync,
  ensureDirSync,
  copySync,
} from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { resolve, join } from 'path';
import type {
  LooseSingleCardDocument,
  RealmPermissions,
  User,
  Subscription,
  Plan,
  RealmAdapter,
} from '@cardstack/runtime-common';
import {
  Realm,
  baseRealm,
  VirtualNetwork,
  Worker,
  RunnerOptionsManager,
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
  type IndexRunner,
  type Definition,
  type Prerenderer,
} from '@cardstack/runtime-common';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse';
import { makeFastBootIndexRunner } from '../../fastboot';
import { RealmServer } from '../../server';

import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import type { Server } from 'http';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';

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

const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;

export const testRealmServerMatrixUsername = 'node-test_realm-server';
export const testRealmServerMatrixUserId = `@${testRealmServerMatrixUsername}:localhost`;

export { testRealmHref, testRealmURL };

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
export const localBaseRealm = 'http://localhost:4441/';
export const matrixURL = new URL('http://localhost:8008');
const testPrerenderHost = '127.0.0.1';
const testPrerenderPort = 4450;
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
  visibility: 'public',
  realmUserId: testMatrix.username,
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

let prerenderServer: Server | undefined;
let prerenderServerStart: Promise<void> | undefined;

const basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let fastbootState:
  | { getRunner: IndexRunner; getIndexHTML: () => Promise<string> }
  | undefined;

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

async function startTestPrerenderServer(): Promise<string> {
  if (prerenderServer?.listening) {
    return testPrerenderURL;
  }
  if (prerenderServerStart) {
    await prerenderServerStart;
    return testPrerenderURL;
  }
  let server = createPrerenderHttpServer({
    secretSeed: realmSecretSeed,
    silent: Boolean(process.env.SILENT_PRERENDERER),
  });
  prerenderServer = server;
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

async function getTestPrerenderer(
  usePrerenderer?: boolean,
): Promise<Prerenderer> {
  if (!usePrerenderer) {
    return {
      async prerenderCard() {
        throw new Error(`prerenderer not enabled`);
      },
      async prerenderModule() {
        throw new Error(`prerenderer not enabled`);
      },
    };
  }
  // in node context this is a boolean
  (globalThis as any).__useHeadlessChromePrerender = true;
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
) {
  let dbAdapter: PgAdapter;
  let publisher: QueuePublisher;
  let runner: QueueRunner;

  const runBeforeHook = async () => {
    prepareTestDB();
    dbAdapter = new PgAdapter({ autoMigrate: true });
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({ adapter: dbAdapter, workerId: 'test-worker' });
  };

  const runAfterHook = async () => {
    await publisher?.destroy();
    await runner?.destroy();
    if (dbAdapter) {
      await clearSessionRooms(dbAdapter);
    }
    await dbAdapter?.close();
    await stopTestPrerenderServer();
    delete (globalThis as any).__useHeadlessChromePrerender;
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

export async function getFastbootState() {
  if (!fastbootState) {
    fastbootState = await makeFastBootIndexRunner(
      new URL(process.env.HOST_URL ?? 'http://localhost:4200/'),
      manager.getOptions.bind(manager),
    );
  }
  return fastbootState;
}

export async function createRealm({
  dir,
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
  usePrerenderer,
}: {
  dir: string;
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
  usePrerenderer?: boolean;
}): Promise<{ realm: Realm; adapter: RealmAdapter }> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

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
    let indexRunner = (await getFastbootState()).getRunner;
    let prerenderer = await getTestPrerenderer(usePrerenderer);
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      dbAdapter,
      queuePublisher: publisher,
      runnerOptsManager: manager,
      indexRunner,
      virtualNetwork,
      matrixURL: matrixConfig.url,
      secretSeed: realmSecretSeed,
      realmServerMatrixUsername: testRealmServerMatrixUsername,
      prerenderer,
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
  });
  if (worker) {
    virtualNetwork.mount(realm.handle);
    await worker.run();
  }
  return { realm, adapter };
}

export function setupBaseRealmServer(
  hooks: NestedHooks,
  matrixURL: URL,
  options: { usePrerenderer?: boolean } = {},
) {
  let baseRealmServer: Server | undefined;
  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      let dir = dirSync();
      baseRealmServer = await runBaseRealmServer(
        createVirtualNetwork(),
        publisher,
        runner,
        dbAdapter,
        matrixURL,
        dir.name,
        { '*': ['read'] },
        options,
      );
    },
    after: async () => {
      if (baseRealmServer) {
        await closeServer(baseRealmServer);
        baseRealmServer = undefined;
      }
    },
  });
}

export async function runBaseRealmServer(
  virtualNetwork: VirtualNetwork,
  publisher: QueuePublisher,
  runner: QueueRunner,
  dbAdapter: PgAdapter,
  matrixURL: URL,
  realmsRootPath: string,
  permissions: RealmPermissions = { '*': ['read'] },
  options: { usePrerenderer?: boolean } = {},
) {
  let { usePrerenderer = false } = options;
  let localBaseRealmURL = new URL(localBaseRealm);
  virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

  let { getRunner: indexRunner, getIndexHTML } = await getFastbootState();
  let prerenderer = await getTestPrerenderer(usePrerenderer);
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    dbAdapter,
    queuePublisher: publisher,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
  });
  let { realm: testBaseRealm } = await createRealm({
    dir: basePath,
    realmURL: baseRealm.url,
    virtualNetwork,
    publisher,
    dbAdapter,
    permissions,
  });
  // the base realm is public readable so it doesn't need a private network
  virtualNetwork.mount(testBaseRealm.handle);
  await worker.run();
  await testBaseRealm.start();
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });
  let testBaseRealmServer = new RealmServer({
    realms: [testBaseRealm],
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
    serverURL: new URL(localBaseRealmURL.origin),
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
  });
  return testBaseRealmServer.listen(parseInt(localBaseRealmURL.port));
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
  usePrerenderer = false,
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
  usePrerenderer?: boolean;
}) {
  let { getRunner: indexRunner, getIndexHTML } = await getFastbootState();
  let prerenderer = await getTestPrerenderer(usePrerenderer);
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    dbAdapter,
    queuePublisher: publisher,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
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
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(realmURL.port));
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
    let response = await realmSetup.request
      .post('/_server-session')
      .send(JSON.stringify({ user: userId }))
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json');

    let json = response.body;

    let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

    if (!rooms.includes(json.room)) {
      await matrixClient.joinRoom(json.room);
    }

    await matrixClient.sendEvent(json.room, 'm.room.message', {
      body: `auth-response: ${json.challenge}`,
      msgtype: 'm.text',
    });

    response = await realmSetup.request
      .post('/_server-session')
      .send(JSON.stringify({ user: userId, challenge: json.challenge }))
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json');

    testAuthRoomId = json.room;

    await upsertSessionRoom(
      realmSetup.dbAdapter,
      realmSetup.testRealm.url,
      userId,
      json.room,
    );
  });

  return {
    matrixClient,
    getMessagesSince: async function (since: number) {
      let allMessages = await matrixClient.roomMessages(testAuthRoomId!);
      let messagesAfterSentinel = allMessages.filter(
        (m) => m.origin_server_ts > since,
      );

      return messagesAfterSentinel;
    },
  };
}

export async function waitForRealmEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
) {
  await waitUntil(async () => {
    let matrixMessages = await getMessagesSince(since);
    return matrixMessages.length > 0;
  });
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
  let testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;

  setGracefulCleanup();

  setupDB(hooks, {
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

      // If a fileSystem is provided, use it to populate the test realm, otherwise copy the default cards
      if (!fileSystem) {
        copySync(join(__dirname, '..', 'cards'), testRealmDir);
      }

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
  });

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
    usePrerenderer,
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
    usePrerenderer?: true;
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
          usePrerenderer,
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
