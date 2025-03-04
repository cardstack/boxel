import { writeFileSync, writeJSONSync, readdirSync, statSync } from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { resolve, join } from 'path';
import {
  Realm,
  LooseSingleCardDocument,
  baseRealm,
  RealmPermissions,
  VirtualNetwork,
  Worker,
  RunnerOptionsManager,
  Loader,
  fetcher,
  maybeHandleScopedCSSRequest,
  insertPermissions,
  IndexWriter,
  asExpressions,
  query,
  insert,
  param,
  unixTime,
  RealmPaths,
  type MatrixConfig,
  type QueuePublisher,
  type QueueRunner,
  type IndexRunner,
} from '@cardstack/runtime-common';
import { dirSync } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse';
import { makeFastBootIndexRunner } from '../../fastboot';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { RealmServer } from '../../server';
import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import { Server } from 'http';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { shimExternals } from '../../lib/externals';
import { Plan, Subscription, User } from '@cardstack/billing/billing-queries';

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

export * from '@cardstack/runtime-common/helpers/indexer';

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4441/';
export const matrixURL = new URL('http://localhost:8008');
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
};

export const realmServerTestMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm-server',
};
export const realmServerSecretSeed = "mum's the word";
export const realmSecretSeed = `shhh! it's a secret`;
export const matrixRegistrationSecret: string =
  getSynapseConfig()!.registration_shared_secret; // as long as synapse has been started at least once, this will always exist

export const seedPath = resolve(
  join(__dirname, '..', '..', '..', 'seed-realm'),
);
const basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let fastbootState:
  | { getRunner: IndexRunner; getIndexHTML: () => Promise<string> }
  | undefined;

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function createVirtualNetworkAndLoader() {
  let virtualNetwork = createVirtualNetwork();
  let fetch = fetcher(virtualNetwork.fetch, [
    async (req, next) => {
      return (await maybeHandleScopedCSSRequest(req)) || next(req);
    },
  ]);
  let loader = new Loader(fetch, virtualNetwork.resolveImport);
  return { virtualNetwork, loader };
}

export function createVirtualNetwork() {
  let virtualNetwork = new VirtualNetwork();
  shimExternals(virtualNetwork);
  virtualNetwork.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  return virtualNetwork;
}

export function prepareTestDB(): void {
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
}

export async function closeServer(server: Server) {
  await new Promise<void>((r) => server.close(() => r()));
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
    await dbAdapter?.close();
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
  // if you are creating a realm  to test it directly without a server, you can
  // also specify `withWorker: true` to also include a worker with your realm
  withWorker?: true;
}): Promise<Realm> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

  for (let [filename, contents] of Object.entries(fileSystem)) {
    if (typeof contents === 'string') {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }

  let adapter = new NodeAdapter(dir);
  let worker: Worker | undefined;
  if (withWorker) {
    if (!runner) {
      throw new Error(`must provider a QueueRunner when using withWorker`);
    }
    let indexRunner = (await getFastbootState()).getRunner;
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      runnerOptsManager: manager,
      indexRunner,
      virtualNetwork,
      matrixURL: matrixConfig.url,
      secretSeed: realmSecretSeed,
    });
  }
  let realm = new Realm({
    url: realmURL,
    adapter,
    matrix: matrixConfig,
    secretSeed: realmSecretSeed,
    virtualNetwork,
    dbAdapter,
    queue: publisher,
  });
  if (worker) {
    virtualNetwork.mount(realm.handle);
    await worker.run();
  }
  return realm;
}

export function setupBaseRealmServer(
  hooks: NestedHooks,
  virtualNetwork: VirtualNetwork,
  matrixURL: URL,
) {
  let baseRealmServer: Server;
  setupDB(hooks, {
    before: async (dbAdapter, publisher, runner) => {
      let dir = dirSync();
      baseRealmServer = await runBaseRealmServer(
        virtualNetwork,
        publisher,
        runner,
        dbAdapter,
        matrixURL,
        dir.name,
      );
    },
    after: async () => {
      await closeServer(baseRealmServer);
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
) {
  let localBaseRealmURL = new URL(localBaseRealm);
  virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

  let { getRunner: indexRunner, getIndexHTML } = await getFastbootState();
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
  });
  let testBaseRealm = await createRealm({
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
}) {
  let { getRunner: indexRunner, getIndexHTML } = await getFastbootState();
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
  });
  await worker.run();
  let testRealm = await createRealm({
    dir: testRealmDir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork,
    matrixConfig,
    publisher,
    dbAdapter,
  });

  await testRealm.logInToMatrix();

  virtualNetwork.mount(testRealm.handle);
  let realms = [testRealm];
  let seedRealmURL: URL | undefined;
  let seedRealm: Realm | undefined;
  if (realmURL.pathname && realmURL.pathname !== '/') {
    seedRealmURL = new URL('/seed/', realmURL);
    seedRealm = await createRealm({
      dir: testRealmDir,
      fileSystem,
      realmURL: seedRealmURL.href,
      permissions,
      virtualNetwork,
      matrixConfig,
      publisher,
      dbAdapter,
    });
    virtualNetwork.mount(seedRealm.handle);
    realms.push(seedRealm);
  }
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
    seedPath,
    seedRealmURL,
    serverURL: new URL(realmURL.origin),
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(realmURL.port));
  await testRealmServer.start();
  return {
    testRealmDir,
    testRealm,
    seedRealm,
    testRealmServer,
    testRealmHttpServer,
    matrixClient,
  };
}

export function setupCardLogs(
  hooks: NestedHooks,
  apiThunk: () => Promise<typeof CardAPI>,
) {
  hooks.afterEach(async function () {
    let api = await apiThunk();
    await api.flushLogs();
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
