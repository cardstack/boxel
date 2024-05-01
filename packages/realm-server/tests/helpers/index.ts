import { writeFileSync, writeJSONSync, readFileSync } from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { resolve, join } from 'path';
import {
  Realm,
  LooseSingleCardDocument,
  baseRealm,
  RealmPermissions,
  VirtualNetwork,
  Worker,
  type Queue,
} from '@cardstack/runtime-common';
import { makeFastBootIndexRunner } from '../../fastboot';
import { RunnerOptionsManager } from '@cardstack/runtime-common/search-index';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type IndexRunner } from '@cardstack/runtime-common/search-index';
import { RealmServer } from '../../server';
import PgAdapter from '../../pg-adapter';
import PgQueue from '../../pg-queue';
import { Server } from 'http';

export * from '@cardstack/runtime-common/helpers/indexer';

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4441/';
const testMatrix = {
  url: new URL(`http://localhost:8008`),
  username: 'node-test_realm',
  password: 'password',
};
let distPath = resolve(__dirname, '..', '..', '..', 'host', 'dist');
let basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let getRunner: IndexRunner | undefined;

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

  // we need to pair before and after, and beforeEach and afterEach. within this
  // setup function we can't mix before and beforeEach
  if (args.before) {
    if (args.beforeEach) {
      throw new Error(
        `cannot pair a "beforeEach" hook with a "before" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
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
    if (args.before) {
      throw new Error(
        `cannot pair a "beforeEach" hook with a "before" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
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
  permissions = { '*': ['read', 'write'] },
  virtualNetwork,
  queue,
  dbAdapter,
}: {
  dir: string;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL?: string;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  queue: Queue;
  dbAdapter: PgAdapter;
}): Promise<Realm> {
  if (!getRunner) {
    ({ getRunner } = await makeFastBootIndexRunner(
      distPath,
      manager.getOptions.bind(manager),
    ));
  }
  let indexRunner = getRunner;
  for (let [filename, contents] of Object.entries(fileSystem)) {
    if (typeof contents === 'string') {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }

  let adapter = new NodeAdapter(dir);
  return new Realm({
    url: realmURL,
    adapter,
    indexRunner,
    runnerOptsMgr: manager,
    getIndexHTML: async () =>
      readFileSync(join(distPath, 'index.html')).toString(),
    matrix: testMatrix,
    permissions,
    realmSecretSeed: "shhh! it's a secret",
    virtualNetwork,
    ...((globalThis as any).__enablePgIndexer?.() ? { dbAdapter, queue } : {}),
    onIndexer: async (indexer) => {
      let worker = new Worker({
        realmURL: new URL(realmURL!),
        indexer,
        queue,
        realmAdapter: adapter,
        runnerOptsManager: manager,
        loader: virtualNetwork.createLoader(),
        indexRunner,
      });
      await worker.run();
    },
  });
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
) {
  let localBaseRealmURL = new URL(localBaseRealm);
  virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

  let testBaseRealm = await createRealm({
    dir: basePath,
    realmURL: baseRealm.url,
    virtualNetwork,
    queue,
    dbAdapter,
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
  permissions,
  virtualNetwork,
  queue,
  dbAdapter,
}: {
  dir: string;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL: URL;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  queue: Queue;
  dbAdapter: PgAdapter;
}) {
  let testRealm = await createRealm({
    dir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork,
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
