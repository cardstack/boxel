import { writeFileSync, writeJSONSync } from 'fs-extra';
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
  type MatrixConfig,
  type Queue,
  type IndexRunner,
} from '@cardstack/runtime-common';
import { dirSync } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse';
import { makeFastBootIndexRunner } from '../../fastboot';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { RealmServer } from '../../server';
import PgAdapter from '../../pg-adapter';
import PgQueue from '../../pg-queue';
import { Server } from 'http';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { shimExternals } from '../../lib/externals';

export * from '@cardstack/runtime-common/helpers/indexer';

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4441/';
export const matrixURL = new URL('http://localhost:8008');
const testMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm',
};

export const realmServerTestMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm-server',
};
export const secretSeed = `shhh! it's a secret`;
export const matrixRegistrationSecret: string =
  getSynapseConfig()!.registration_shared_secret; // as long as synapse has been started at least once, this will always exist

let basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let fastbootState:
  | { getRunner: IndexRunner; getIndexHTML: () => Promise<string> }
  | undefined;

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
  queue: Queue,
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
  let queue: Queue;

  const runBeforeHook = async () => {
    prepareTestDB();
    dbAdapter = new PgAdapter();
    queue = new PgQueue(dbAdapter);
  };

  const runAfterHook = async () => {
    await queue?.destroy();
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
      await args.before!(dbAdapter, queue);
    });

    hooks.after(async function () {
      await args.after?.(dbAdapter, queue);
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
      await args.beforeEach!(dbAdapter, queue);
    });

    hooks.afterEach(async function () {
      await args.afterEach?.(dbAdapter, queue);
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
  queue,
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
  queue: Queue;
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

  let getIndexHTML = (await getFastbootState()).getIndexHTML;
  let adapter = new NodeAdapter(dir);
  let worker: Worker | undefined;
  if (withWorker) {
    let indexRunner = (await getFastbootState()).getRunner;
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue,
      runnerOptsManager: manager,
      indexRunner,
      virtualNetwork,
      matrixURL: matrixConfig.url,
      secretSeed,
    });
  }
  let realm = new Realm({
    url: realmURL,
    adapter,
    getIndexHTML,
    matrix: matrixConfig,
    secretSeed,
    virtualNetwork,
    dbAdapter,
    queue,
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
  });
  if (worker) {
    virtualNetwork.mount(realm.maybeHandle);
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
    before: async (dbAdapter, queue) => {
      let dir = dirSync();
      baseRealmServer = await runBaseRealmServer(
        virtualNetwork,
        queue,
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
  queue: Queue,
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
    queue,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork,
    matrixURL,
    secretSeed,
  });
  let testBaseRealm = await createRealm({
    dir: basePath,
    realmURL: baseRealm.url,
    virtualNetwork,
    queue,
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
    seed: secretSeed,
  });
  let testBaseRealmServer = new RealmServer({
    realms: [testBaseRealm],
    virtualNetwork,
    matrixClient,
    secretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue,
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
  queue,
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
  virtualNetwork: VirtualNetwork; // this is the public network
  queue: Queue;
  dbAdapter: PgAdapter;
  matrixURL: URL;
  matrixConfig?: MatrixConfig;
}) {
  // the test worker needs a special privileged network that has the interior
  // Realm.maybeHandle mounted--this prevents the test worker from having to
  // authenticate with itself when talking to the realm whose credentials its
  // using
  let privateNetwork = createVirtualNetwork();
  let { getRunner: indexRunner, getIndexHTML } = await getFastbootState();
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    runnerOptsManager: manager,
    indexRunner,
    virtualNetwork: privateNetwork,
    matrixURL,
    secretSeed,
  });
  let testRealm = await createRealm({
    dir: testRealmDir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork: privateNetwork,
    matrixConfig,
    queue,
    dbAdapter,
  });
  virtualNetwork.mount(testRealm.handle);
  await worker.run();
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: secretSeed,
  });
  let testRealmServer = new RealmServer({
    realms: [testRealm],
    virtualNetwork,
    matrixClient,
    secretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue,
    getIndexHTML,
    serverURL: new URL(realmURL.origin),
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
    onRealmStart: (realm) => privateNetwork.mount(realm.maybeHandle),
    onRealmCreate: (realm) => privateNetwork.mount(realm.maybeHandle),
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(realmURL.port));
  await testRealmServer.start();
  return {
    testRealm,
    testRealmServer,
    testRealmHttpServer,
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
