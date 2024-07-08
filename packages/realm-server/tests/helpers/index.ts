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
  type MatrixConfig,
  type Queue,
  type IndexRunner,
  insertPermissions,
} from '@cardstack/runtime-common';
import { makeFastBootIndexRunner } from '../../fastboot';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { RealmServer } from '../../server';
import PgAdapter from '../../pg-adapter';
import PgQueue from '../../pg-queue';
import { Server } from 'http';

export * from '@cardstack/runtime-common/helpers/indexer';

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4441/';
const testMatrix: MatrixConfig = {
  url: new URL(`http://localhost:8008`),
  username: 'node-test_realm',
  password: 'password',
};

let basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let fastbootState:
  | { getRunner: IndexRunner; getIndexHTML: () => Promise<string> }
  | undefined;

export async function prepareTestDB() {
  process.env.PGDATABASE = `test_db_${Math.floor(10000000 * Math.random())}`;
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
    await dbAdapter.startClient();
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

export async function createRealm({
  dir,
  fileSystem = {},
  realmURL = testRealm,
  permissions = { '*': ['read'] },
  virtualNetwork,
  queue,
  dbAdapter,
  matrixConfig = testMatrix,
  deferStartUp,
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
}): Promise<Realm> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

  if (!fastbootState) {
    fastbootState = await makeFastBootIndexRunner(
      new URL('http://localhost:4200/'),
      manager.getOptions.bind(manager),
    );
  }
  let indexRunner = fastbootState.getRunner;
  for (let [filename, contents] of Object.entries(fileSystem)) {
    if (typeof contents === 'string') {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }

  let adapter = new NodeAdapter(dir);
  let realm = new Realm(
    {
      url: realmURL,
      adapter,
      getIndexHTML: fastbootState.getIndexHTML,
      matrix: matrixConfig,
      realmSecretSeed: "shhh! it's a secret",
      virtualNetwork,
      dbAdapter,
      queue,
      onIndexer: async (indexer) => {
        let worker = new Worker({
          realmURL: new URL(realmURL!),
          indexer,
          queue,
          realmAdapter: adapter,
          runnerOptsManager: manager,
          loader: realm.loaderTemplate,
          indexRunner,
        });
        await worker.run();
      },
      assetsURL: new URL(`http://example.com/notional-assets-host/`),
    },
    { deferStartUp },
  );
  return realm;
}

export function setupBaseRealmServer(
  hooks: NestedHooks,
  virtualNetwork: VirtualNetwork,
) {
  let baseRealmServer: Server;
  setupDB(hooks, {
    before: async (dbAdapter, queue) => {
      baseRealmServer = await runBaseRealmServer(
        virtualNetwork,
        queue,
        dbAdapter,
      );
    },
    after: async () => {
      baseRealmServer.close();
    },
  });
}

export async function runBaseRealmServer(
  virtualNetwork: VirtualNetwork,
  queue: Queue,
  dbAdapter: PgAdapter,
  permissions: RealmPermissions = { '*': ['read'] },
) {
  let localBaseRealmURL = new URL(localBaseRealm);
  virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

  let testBaseRealm = await createRealm({
    dir: basePath,
    realmURL: baseRealm.url,
    virtualNetwork,
    queue,
    dbAdapter,
    permissions,
  });
  virtualNetwork.mount(testBaseRealm.maybeExternalHandle);
  await testBaseRealm.ready;
  let testBaseRealmServer = new RealmServer([testBaseRealm], virtualNetwork);
  return testBaseRealmServer.listen(parseInt(localBaseRealmURL.port));
}

export async function runTestRealmServer({
  dir,
  fileSystem,
  realmURL,
  virtualNetwork,
  queue,
  dbAdapter,
  matrixConfig,
  permissions = { '*': ['read'] },
}: {
  dir: string;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL: URL;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  queue: Queue;
  dbAdapter: PgAdapter;
  matrixConfig?: MatrixConfig;
}) {
  let testRealm = await createRealm({
    dir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork,
    matrixConfig,
    queue,
    dbAdapter,
  });
  virtualNetwork.mount(testRealm.maybeExternalHandle);
  await testRealm.ready;
  let testRealmServer = await new RealmServer(
    [testRealm],
    virtualNetwork,
  ).listen(parseInt(realmURL.port));
  return {
    testRealm,
    testRealmServer,
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
