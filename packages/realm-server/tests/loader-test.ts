import { module, test } from 'qunit';
import { Loader, VirtualNetwork } from '@cardstack/runtime-common';
import { dirSync, setGracefulCleanup, DirResult } from 'tmp';
import {
  createRealm,
  setupBaseRealmServer,
  runTestRealmServer,
} from './helpers';
import { copySync } from 'fs-extra';
import { shimExternals } from '../lib/externals';
import { Server } from 'http';
import { join } from 'path';

setGracefulCleanup();

const testRealmURL = new URL('http://127.0.0.1:4444/');
const testRealmHref = testRealmURL.href;

module('loader', function (hooks) {
  let dir: DirResult;
  let testRealmServer: Server;

  let virtualNetwork = new VirtualNetwork();
  let loader = virtualNetwork.createLoader();

  shimExternals(virtualNetwork);

  setupBaseRealmServer(hooks, virtualNetwork);

  hooks.beforeEach(async function () {
    dir = dirSync();
    copySync(join(__dirname, 'cards'), dir.name);

    testRealmServer = (
      await runTestRealmServer(
        virtualNetwork,
        dir.name,
        undefined,
        testRealmURL,
      )
    ).testRealmServer;
  });

  hooks.afterEach(function () {
    testRealmServer.close();
  });

  test('can dynamically load modules with cycles', async function (assert) {
    let loader = virtualNetwork.createLoader();
    let module = await loader.import<{ three(): number }>(
      `${testRealmHref}cycle-two`,
    );
    assert.strictEqual(module.three(), 3);
  });

  test('can resolve multiple import load races against a common dep', async function (assert) {
    let loader = virtualNetwork.createLoader();
    let a = loader.import<{ a(): string }>(`${testRealmHref}a`);
    let b = loader.import<{ b(): string }>(`${testRealmHref}b`);
    let [aModule, bModule] = await Promise.all([a, b]);
    assert.strictEqual(aModule.a(), 'abc', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bc', 'module executed successfully');
  });

  test('can resolve a import deadlock', async function (assert) {
    let loader = virtualNetwork.createLoader();
    let a = loader.import<{ a(): string }>(`${testRealmHref}deadlock/a`);
    let b = loader.import<{ b(): string }>(`${testRealmHref}deadlock/b`);
    let c = loader.import<{ c(): string }>(`${testRealmHref}deadlock/c`);
    let [aModule, bModule, cModule] = await Promise.all([a, b, c]);
    assert.strictEqual(aModule.a(), 'abcd', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bcd', 'module executed successfully');
    assert.strictEqual(cModule.c(), 'cd', 'module executed successfully');
  });

  test('supports import.meta', async function (assert) {
    let loader = virtualNetwork.createLoader();
    let realm = await createRealm(
      dir.name,
      {
        'foo.js': `
          export function checkImportMeta() { return import.meta.url; }
          export function myLoader() { return import.meta.loader; }
        `,
      },
      'http://example.com/',
      undefined,
      virtualNetwork,
    );
    loader.registerURLHandler(realm.maybeHandle.bind(realm));
    await realm.ready;

    let { checkImportMeta, myLoader } = await loader.import<{
      checkImportMeta: () => string;
      myLoader: () => Loader;
    }>('http://example.com/foo');
    assert.strictEqual(checkImportMeta(), 'http://example.com/foo');
    assert.strictEqual(myLoader(), loader, 'the loader instance is correct');
  });

  test('can determine consumed modules', async function (assert) {
    let loader = virtualNetwork.createLoader();
    await loader.import<{ a(): string }>(`${testRealmHref}a`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealmHref}a`), [
      `${testRealmHref}a`,
      `${testRealmHref}b`,
      `${testRealmHref}c`,
    ]);
  });

  test('can determine consumed modules when an error is encountered during loading', async function (assert) {
    let loader = virtualNetwork.createLoader();
    try {
      await loader.import<{ d(): string }>(`${testRealmHref}d`);
      throw new Error(`expected error was not thrown`);
    } catch (e: any) {
      assert.strictEqual(e.message, 'intentional error thrown');
      assert.deepEqual(await loader.getConsumedModules(`${testRealmHref}d`), [
        `${testRealmHref}d`,
        `${testRealmHref}a`,
        `${testRealmHref}b`,
        `${testRealmHref}c`,
        `${testRealmHref}e`,
      ]);
    }
  });

  test('can get consumed modules within a cycle', async function (assert) {
    let loader = virtualNetwork.createLoader();
    await loader.import<{ three(): number }>(`${testRealmHref}cycle-two`);
    let modules = await loader.getConsumedModules(`${testRealmHref}cycle-two`);
    assert.deepEqual(modules, [
      `${testRealmHref}cycle-two`,
      `${testRealmHref}cycle-one`,
    ]);
  });

  test('supports identify API', async function (assert) {
    let loader = virtualNetwork.createLoader();
    shimExternals(virtualNetwork);
    let { Person } = await loader.import<{ Person: unknown }>(
      `${testRealmHref}person`,
    );
    assert.deepEqual(loader.identify(Person), {
      module: `${testRealmHref}person`,
      name: 'Person',
    });
    // The loader knows which loader instance was used to import the card
    assert.deepEqual(Loader.identify(Person), {
      module: `${testRealmHref}person`,
      name: 'Person',
    });
  });

  test('exports cannot be mutated', async function (assert) {
    let loader = virtualNetwork.createLoader();
    shimExternals(virtualNetwork);
    let module = await loader.import<{ Person: unknown }>(
      `${testRealmHref}person`,
    );
    assert.throws(() => {
      module.Person = 1;
    }, /modules are read only/);
  });

  test('can get a loader used to import a specific card', async function (assert) {
    let loader = virtualNetwork.createLoader();
    shimExternals(virtualNetwork);
    let module = await loader.import<any>(`${testRealmHref}person`);
    let card = module.Person;
    let testingLoader = Loader.getLoaderFor(card);
    assert.strictEqual(testingLoader, loader, 'the loaders are the same');
  });

  test('is able to follow redirects', async function (assert) {
    loader.prependURLHandlers([
      async (request) => {
        if (request.url.includes('node-b.abc')) {
          return new Response('final redirection url');
        }
        return null;
      },
      async (request) => {
        if (!request.url.includes('node-a.abc')) {
          return null;
        }
        return new Response('redirected', {
          status: 301,
          headers: new Headers({ Location: `http://node-b.abc` }),
        });
      },
    ]);

    let response = await loader.fetch(`http://node-a.abc`);
    assert.strictEqual(response.url, 'http://node-b.abc/');
    assert.true(response.redirected);
  });
});
