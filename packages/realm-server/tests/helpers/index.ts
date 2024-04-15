import { writeFileSync, writeJSONSync, readFileSync } from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { resolve, join } from 'path';
import {
  Realm,
  LooseSingleCardDocument,
  Loader,
  baseRealm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import { makeFastBootIndexRunner } from '../../fastboot';
import { RunnerOptionsManager } from '@cardstack/runtime-common/search-index';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type IndexRunner } from '@cardstack/runtime-common/search-index';
import { RealmServer } from '../../server';
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

export async function createRealm(
  loader: Loader,
  dir: string,
  flatFiles: Record<string, string | LooseSingleCardDocument> = {},
  realmURL = testRealm,
  permissions: RealmPermissions = { '*': ['read', 'write'] },
): Promise<Realm> {
  if (!getRunner) {
    ({ getRunner } = await makeFastBootIndexRunner(
      distPath,
      manager.getOptions.bind(manager),
    ));
  }
  for (let [filename, contents] of Object.entries(flatFiles)) {
    if (typeof contents === 'string') {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }
  return new Realm({
    url: realmURL,
    adapter: new NodeAdapter(dir),
    loader,
    indexRunner: getRunner,
    runnerOptsMgr: manager,
    getIndexHTML: async () =>
      readFileSync(join(distPath, 'index.html')).toString(),
    matrix: testMatrix,
    permissions,
    realmSecretSeed: "shhh! it's a secret",
  });
}

export function setupBaseRealmServer(hooks: NestedHooks, loader: Loader) {
  let baseRealmServer: Server;
  hooks.before(async function () {
    baseRealmServer = await runBaseRealmServer(loader);
  });

  hooks.after(function () {
    baseRealmServer.close();
  });
}

export async function runBaseRealmServer(loader: Loader) {
  let localBaseRealmURL = new URL(localBaseRealm);
  loader.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);

  let testBaseRealm = await createRealm(
    loader,
    basePath,
    undefined,
    baseRealm.url,
  );
  await testBaseRealm.ready;
  let testBaseRealmServer = new RealmServer([testBaseRealm]);
  return testBaseRealmServer.listen(parseInt(localBaseRealmURL.port));
}

export async function runTestRealmServer(
  loader: Loader,
  dir: string,
  flatFiles: Record<string, string | LooseSingleCardDocument> = {},
  testRealmURL: URL,
  permissions?: RealmPermissions,
) {
  let testRealm = await createRealm(
    loader,
    dir,
    flatFiles,
    testRealmURL.href,
    permissions,
  );
  await testRealm.ready;
  let testRealmServer = await new RealmServer([testRealm]).listen(
    parseInt(testRealmURL.port),
  );
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
