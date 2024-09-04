import { writeFileSync, writeJSONSync, readFileSync } from 'fs-extra';
import { NodeAdapter } from '../../node-realm';
import { resolve, join } from 'path';
import {
  Realm,
  LooseSingleCardDocument,
  Loader,
  baseRealm,
} from '@cardstack/runtime-common';
import { makeFastBootIndexRunner } from '../../fastboot';
import { RunnerOptionsManager } from '@cardstack/runtime-common/search-index';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type IndexRunner } from '@cardstack/runtime-common/search-index';
import { RealmServer } from '../../server';
import { Server } from 'http';

export const testRealm = 'http://test-realm/';
export const localBaseRealm = 'http://localhost:4441/';
let distPath = resolve(__dirname, '..', '..', '..', 'host', 'dist');
let basePath = resolve(join(__dirname, '..', '..', '..', 'base'));

let manager = new RunnerOptionsManager();
let getRunner: IndexRunner | undefined;

export async function createRealm(
  loader: Loader,
  dir: string,
  flatFiles: Record<string, string | LooseSingleCardDocument> = {},
  realmURL = testRealm,
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
  return new Realm(
    realmURL,
    new NodeAdapter(dir),
    loader,
    getRunner,
    manager,
    async () => readFileSync(join(distPath, 'index.html')).toString(),
  );
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
) {
  let testRealm = await createRealm(loader, dir, flatFiles, testRealmURL.href);
  await testRealm.ready;
  let testRealmServer = new RealmServer([testRealm]);
  return testRealmServer.listen(parseInt(testRealmURL.port));
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
