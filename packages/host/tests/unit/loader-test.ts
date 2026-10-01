import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, Loader, VirtualNetwork } from '@cardstack/runtime-common';

import {
  beginTimerBlock,
  enableRenderTimerStub,
  scheduleNativeTimeout,
} from '@cardstack/host/utils/render-timer-stub';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// Bounds a promise a regression could leave pending forever. QUnit's own
// timeout would fail the test too, but as a timeout on the whole test rather
// than as a statement about this promise — and a module load that stalls
// without saying so is the failure these tests exist to catch.
const SETTLE_DEADLINE_MS = 5000;
async function settleWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not settle within ${SETTLE_DEADLINE_MS}ms`,
              ),
            ),
          SETTLE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

module('Unit | loader', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let loader: Loader;
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'a.js': `
          import { b } from './b';
          export function a() {
            return 'a' + b();
          }
        `,
          'b.js': `
          import { c } from './c';
          export function b() {
            return 'b' + c();
          }
        `,
          'c.js': `
          export function c() {
            return 'c';
          }
        `,
          'd.js': `
          import { a } from './a';
          import { e } from './e';
          export function d() {
            return a() + e();
          }
        `,
          'e.js': `
          throw new Error('intentional error thrown');
        `,
          'f.js': `
          import { b } from './b';
          import { g } from './g';
          export function f() {
            return b() + g();
          }
        `,
          'g.js': `
          export function g() {
            return 'g';
          }
        `,
          'cycle-one.js': `
          import { two } from './cycle-two';
          export function one() {
            return two() - 1;
          }
        `,
          'cycle-two.js': `
          import { one } from './cycle-one';
          export function two() {
            return 2;
          }
          export function three() {
            return one() * 3;
          }
        `,
          'deadlock/a.js': `
          import { b } from './b';
          export function d() {
            return 'd';
          }
          export function a() {
            return 'a' + b();
          }
        `,
          'deadlock/b.js': `
          import { c } from './c';
          export function b() {
            return 'b' + c();
          }
        `,
          'deadlock/c.js': `
          import { d } from './a';
          export function c() {
            return 'c' + d();
          }
        `,
          'person.gts': `
          import { contains, field, CardDef } from '@cardstack/base/card-api';
          import StringField from '@cardstack/base/string';
          export class Person extends CardDef {
            static displayName = 'Person';
            @field firstName = contains(StringField);
          }
          export let counter = 0;
          export function increment() {
            counter++;
          }
        `,
          'foo.js': `
          export function checkImportMeta() { return import.meta.url; }
          export function myLoader() { return import.meta.loader; }
        `,
          'reexporter.js': `
          export { g } from './g';
        `,
          // Card code reaching a host-provided package through a runtime
          // `import()`. The realm's transpile rewrites each of these to
          // `import.meta.loader.import(...)`, so what they exercise is the
          // loader's own resolution of a bare specifier, not the browser's.
          'dynamic-shim-consumer.js': `
          export async function viaSyncShim() {
            return (await import('test-sync-shim-pkg')).value;
          }
          export async function viaAsyncShim() {
            return (await import('test-async-shim-pkg')).value;
          }
          export async function viaPrefixShim() {
            return (await import('@test-shim-prefix/thing')).value;
          }
          export async function viaUnshimmedSpecifier() {
            return (await import('test-specifier-nobody-shimmed')).value;
          }
        `,
        },
      }),
    );
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('can dynamically load modules with cycles', async function (assert) {
    let module = await loader.import<{ three(): number }>(
      `${testRealmURL}cycle-two`,
    );
    assert.strictEqual(module.three(), 3);
  });

  test('can resolve multiple import load races against a common dep', async function (assert) {
    let a = loader.import<{ a(): string }>(`${testRealmURL}a`);
    let b = loader.import<{ b(): string }>(`${testRealmURL}b`);
    let [aModule, bModule] = await Promise.all([a, b]);
    assert.strictEqual(aModule.a(), 'abc', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bc', 'module executed successfully');
  });

  test('can resolve a import deadlock', async function (assert) {
    let a = loader.import<{ a(): string }>(`${testRealmURL}deadlock/a`);
    let b = loader.import<{ b(): string }>(`${testRealmURL}deadlock/b`);
    let c = loader.import<{ c(): string }>(`${testRealmURL}deadlock/c`);
    let [aModule, bModule, cModule] = await Promise.all([a, b, c]);
    assert.strictEqual(aModule.a(), 'abcd', 'module executed successfully');
    assert.strictEqual(bModule.b(), 'bcd', 'module executed successfully');
    assert.strictEqual(cModule.c(), 'cd', 'module executed successfully');
  });

  test('can determine consumed modules', async function (assert) {
    await loader.import(`${testRealmURL}f`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealmURL}f`), [
      `${testRealmURL}b`,
      `${testRealmURL}c`,
      `${testRealmURL}g`,
    ]);
    // assert deps from f don't leak into a's deps (fixes CS-9159)
    await loader.import(`${testRealmURL}a`);
    assert.deepEqual(await loader.getConsumedModules(`${testRealmURL}a`), [
      `${testRealmURL}b`,
      `${testRealmURL}c`,
    ]);
  });

  test('can get consumed modules within a cycle', async function (assert) {
    await loader.import<{ three(): number }>(`${testRealmURL}cycle-two`);
    let modules = await loader.getConsumedModules(`${testRealmURL}cycle-two`);
    assert.deepEqual(modules, [`${testRealmURL}cycle-one`]);
  });

  test('supports identify API', async function (assert) {
    let { Person } = await loader.import<{ Person: unknown }>(
      `${testRealmURL}person`,
    );
    assert.deepEqual(loader.identify(Person), {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
    // The loader knows which loader instance was used to import the card
    assert.deepEqual(Loader.identify(Person), {
      module: `${testRealmURL}person`,
      name: 'Person',
    });
  });

  test('exports cannot be mutated from the outside', async function (assert) {
    let module = await loader.import<{ Person: unknown }>(
      `${testRealmURL}person`,
    );
    assert.throws(() => {
      module.Person = 1;
    }, /TypeError: Failed to set the 'Person' property on 'Module': Cannot assign to read only property 'Person'/);
  });

  test('exports can be mutated from the inside', async function (assert) {
    let module = await loader.import<{
      counter: number;
      increment: () => void;
    }>(`${testRealmURL}person`);
    assert.strictEqual(module.counter, 0);
    module.increment();
    assert.strictEqual(module.counter, 1);
  });

  test('can get a loader used to import a specific card', async function (assert) {
    let module = await loader.import<any>(`${testRealmURL}person`);
    let card = module.Person;
    let testingLoader = Loader.getLoaderFor(card);
    assert.strictEqual(testingLoader, loader, 'the loaders are the same');
  });

  test('supports import.meta', async function (assert) {
    let { checkImportMeta, myLoader } = await loader.import<{
      checkImportMeta: () => string;
      myLoader: () => Loader;
    }>(`${testRealmURL}foo`);
    assert.strictEqual(checkImportMeta(), `${testRealmURL}foo.js`);
    assert.strictEqual(myLoader(), loader, 'the loader instance is correct');
  });

  // A runtime `import()` of a shim-registered bare specifier resolves
  // through the shim registry, the same as the static form, for every shape
  // a shim can be registered in. An import that instead neither resolves nor
  // rejects burns a capture render's whole readiness budget and surfaces as
  // an unrelated-looking timeout, so each case settles against a deadline and
  // a regression fails as itself rather than as QUnit's global timeout.
  const DYNAMIC_SHIM_SHAPES: {
    name: string;
    exportName: string;
    value: string;
    register: (virtualNetwork: VirtualNetwork) => void;
  }[] = [
    {
      name: 'shimModule',
      exportName: 'viaSyncShim',
      value: 'sync',
      register: (virtualNetwork) =>
        virtualNetwork.shimModule('test-sync-shim-pkg', { value: 'sync' }),
    },
    {
      name: 'shimAsyncModule by id',
      exportName: 'viaAsyncShim',
      value: 'async',
      register: (virtualNetwork) =>
        virtualNetwork.shimAsyncModule({
          id: 'test-async-shim-pkg',
          resolve: async () => ({ value: 'async' }),
        }),
    },
    {
      name: 'shimAsyncModule by prefix',
      exportName: 'viaPrefixShim',
      value: 'prefix',
      register: (virtualNetwork) =>
        virtualNetwork.shimAsyncModule({
          prefix: '@test-shim-prefix/',
          resolve: async () => ({ value: 'prefix' }),
        }),
    },
  ];

  for (let shape of DYNAMIC_SHIM_SHAPES) {
    test(`a runtime import() of a bare specifier registered with ${shape.name} resolves through the shim registry`, async function (assert) {
      shape.register(getService('network').virtualNetwork);
      let module = await loader.import<Record<string, () => Promise<string>>>(
        `${testRealmURL}dynamic-shim-consumer`,
      );
      assert.strictEqual(
        await settleWithin(
          module[shape.exportName](),
          `import() of the ${shape.name} specifier`,
        ),
        shape.value,
      );
    });
  }

  test('a runtime import() of a shim whose resolver never settles rejects rather than hanging', async function (assert) {
    // The last unbounded await in the shim path: a resolver is caller-
    // supplied — typically a lazy chunk load — and the loader has no clock of
    // its own to hold it to. The handler's deadline is what keeps a stalled
    // one from reaching card code as a promise that never settles.
    getService('network').virtualNetwork.shimAsyncModule(
      {
        id: 'test-async-shim-pkg',
        resolve: () => new Promise<never>(() => {}),
      },
      { delay: async () => {}, retryDelaysMs: [], resolveDeadlineMs: 50 },
    );
    let { viaAsyncShim } = await loader.import<{
      viaAsyncShim: () => Promise<string>;
    }>(`${testRealmURL}dynamic-shim-consumer`);
    await assert.rejects(
      settleWithin(viaAsyncShim(), 'import() of a stalled shim'),
      /test-async-shim-pkg/,
      'the rejection names the specifier whose resolver stalled',
    );
  });

  test('a stalled shim resolver still rejects while the prerender timer stub is blocking timers', async function (assert) {
    // A prerender tab runs its render with the global setTimeout stubbed out,
    // so a deadline armed on it would never fire. The network's own fetch
    // timer is the one that still runs there. This registration passes no
    // timer, so the deadline gets the network's.
    getService('network').virtualNetwork.shimAsyncModule(
      {
        id: 'test-async-shim-pkg',
        resolve: () => new Promise<never>(() => {}),
      },
      { delay: async () => {}, retryDelaysMs: [], resolveDeadlineMs: 50 },
    );
    let { viaAsyncShim } = await loader.import<{
      viaAsyncShim: () => Promise<string>;
    }>(`${testRealmURL}dynamic-shim-consumer`);
    let restoreStub = enableRenderTimerStub();
    let releaseBlock = beginTimerBlock();
    let guard: ReturnType<typeof setTimeout> | undefined;
    try {
      // The guard runs on the native timer too: under the stub,
      // `settleWithin`'s own setTimeout would be swallowed, and a regression
      // would hang until QUnit's timeout instead of failing here.
      await assert.rejects(
        Promise.race([
          viaAsyncShim(),
          new Promise<never>((_resolve, reject) => {
            guard = scheduleNativeTimeout(
              () =>
                reject(
                  new Error(
                    `import() of a stalled shim under the timer stub did not settle within ${SETTLE_DEADLINE_MS}ms`,
                  ),
                ),
              SETTLE_DEADLINE_MS,
            );
          }),
        ]),
        /test-async-shim-pkg/,
        'the rejection names the specifier whose resolver stalled',
      );
    } finally {
      clearTimeout(guard);
      releaseBlock();
      restoreStub();
    }
  });

  test('a runtime import() of a bare specifier nobody shimmed rejects rather than hanging', async function (assert) {
    // A specifier the network cannot serve has to surface as an error the
    // card author can act on, on the same deadline as a successful load.
    let { viaUnshimmedSpecifier } = await loader.import<{
      viaUnshimmedSpecifier: () => Promise<string>;
    }>(`${testRealmURL}dynamic-shim-consumer`);
    await assert.rejects(
      settleWithin(
        viaUnshimmedSpecifier(),
        'import() of an unshimmed specifier',
      ),
      /test-specifier-nobody-shimmed/,
      'the rejection names the specifier that could not be resolved',
    );
  });

  // Module identifiers can be in registered prefix form (e.g.
  // @cardstack/catalog/...); the loader accepts either spelling as input and
  // emits dependency lists in canonical form — the prefix spelling wherever a
  // realm-prefix mapping is registered.
  test('can determine consumed modules using prefix-form module identifier', async function (assert) {
    // Realm-prefix mappings live on the per-app VirtualNetwork — without
    // the finally clause this registration leaks into later tests,
    // causing skill uploads to canonicalize sourceUrls to @test-loader/...
    // and breaking strict URL matches in tests that consume them.
    let virtualNetwork = getService('network').virtualNetwork;
    virtualNetwork.addRealmMapping('@test-loader/', testRealmURL);
    try {
      // Import the module using its regular URL so it's in the loader cache
      await loader.import(`${testRealmURL}f`);

      // Call getConsumedModules with the prefix-form identifier. This
      // requires VN-aware resolution — new URL('@test-loader/f') is not a
      // valid URL.
      let consumed = await loader.getConsumedModules(`@test-loader/f`);
      assert.deepEqual(
        consumed,
        [`@test-loader/b`, `@test-loader/c`, `@test-loader/g`],
        'consumed modules come out in canonical prefix form',
      );
      assert.deepEqual(
        await loader.getConsumedModules(`${testRealmURL}f`),
        consumed,
        'URL-form input produces the same canonical output',
      );
    } finally {
      virtualNetwork.removeRealmMapping('@test-loader/');
    }
  });

  test('a realm-mapping change discards the module cache', async function (assert) {
    // The loader keys its module cache by canonical RRI form, whose
    // relationship to a URL is only stable between mapping changes. A mapping
    // add/remove must therefore discard the cache so an entry can't survive
    // under a spelling that no longer resolves the same way.
    let virtualNetwork = getService('network').virtualNetwork;
    await loader.import(`${testRealmURL}f`);
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}f`),
      'module is cached after import',
    );
    virtualNetwork.addRealmMapping('@test-loader-discard/', testRealmURL);
    try {
      assert.false(
        loader.isModuleLoaded(`${testRealmURL}f`),
        'module is not visible under its pre-mapping spelling after a mapping add',
      );
    } finally {
      virtualNetwork.removeRealmMapping('@test-loader-discard/');
    }
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}f`),
      'removing a realm mapping also discards the module cache',
    );
  });

  test('dispose() unsubscribes a discarded loader from mapping-change notifications', async function (assert) {
    // LoaderService replaces its loader on every module edit / session
    // boundary. Each loader subscribes to realm-mapping changes; without
    // dispose() the VirtualNetwork keeps that subscription — pinning the
    // loader and its whole module cache indefinitely. After dispose(), a
    // mapping change must no longer reach this loader.
    //
    // Probe with a net-zero add+remove rather than isModuleLoaded straight
    // after an add: a mapping add shifts the cache-key form itself, so a
    // still-cached module would fail to look up under its original URL even
    // when nothing was discarded. Restoring the mapping restores the key
    // form, so a surviving cache entry is observable again — which it is only
    // if the loader ignored both notifications.
    let virtualNetwork = getService('network').virtualNetwork;
    let discarded = Loader.cloneLoader(loader);
    await discarded.import(`${testRealmURL}f`);
    assert.true(
      discarded.isModuleLoaded(`${testRealmURL}f`),
      'module is cached after import',
    );
    discarded.dispose();
    virtualNetwork.addRealmMapping('@test-loader-dispose/', testRealmURL);
    virtualNetwork.removeRealmMapping('@test-loader-dispose/');
    assert.true(
      discarded.isModuleLoaded(`${testRealmURL}f`),
      "a disposed loader's cache survives mapping changes (subscription released)",
    );
  });

  test('isModuleLoaded returns false for a module that has not been imported', function (assert) {
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}a`),
      'module a is not loaded before import',
    );
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}nonexistent`),
      'nonexistent module is not loaded',
    );
  });

  test('isModuleLoaded returns true for a module that has been imported', async function (assert) {
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}a`),
      'module a is not loaded before import',
    );
    await loader.import(`${testRealmURL}a`);
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}a`),
      'module a is loaded after import',
    );
  });

  test('isModuleLoaded returns true for dependencies of an imported module', async function (assert) {
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}b`),
      'module b is not loaded before import',
    );
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}c`),
      'module c is not loaded before import',
    );
    await loader.import(`${testRealmURL}a`);
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}b`),
      'module b is loaded as a dependency of a',
    );
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}c`),
      'module c is loaded as a transitive dependency of a',
    );
  });

  test('isModuleLoaded works with executable extensions in the URL', async function (assert) {
    await loader.import(`${testRealmURL}person`);
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}person`),
      'loaded without extension',
    );
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}person.gts`),
      'loaded with .gts extension',
    );
  });

  test('isModuleLoaded returns true for a re-exported module', async function (assert) {
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}reexporter`),
      'reexporter is not loaded before import',
    );
    assert.false(
      loader.isModuleLoaded(`${testRealmURL}g`),
      're-exported module g is not loaded before import',
    );
    await loader.import(`${testRealmURL}reexporter`);
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}reexporter`),
      'reexporter is loaded after import',
    );
    assert.true(
      loader.isModuleLoaded(`${testRealmURL}g`),
      're-exported module g is loaded as a dependency of reexporter',
    );
  });

  test('a module shimmed on the virtual network is served to the loader without a fetch, under every spelling', async function (assert) {
    // A shim for a realm-mapped identifier is keyed by the realm URL the
    // identifier resolves to, and a loader import resolves to that same URL.
    // The network's fetch pipeline only answers shims on the fake packages
    // origin, so the loader has to ask the network for the shim itself.
    let virtualNetwork = new VirtualNetwork();
    let realmURL = 'https://shimmed-realm.example/';
    let aliasURL = 'https://shimmed-alias.example/';
    virtualNetwork.addURLMapping(new URL(aliasURL), new URL(realmURL));
    virtualNetwork.addRealmMapping('@test-loader-shim/', realmURL);
    class Shimmed {}
    virtualNetwork.shimAsyncModule({
      id: '@test-loader-shim/shimmed-module',
      resolve: async () => ({ default: Shimmed }),
    });
    let throwIfFetch = new Loader(
      async () => {
        throw new Error(
          'fetch should not be invoked for a module the virtual network shims',
        );
      },
      virtualNetwork.resolveImport,
      { virtualNetwork },
    );

    for (let spelling of [
      '@test-loader-shim/shimmed-module',
      `${realmURL}shimmed-module`,
      `${aliasURL}shimmed-module`,
    ]) {
      let module = await throwIfFetch.import<{ default: typeof Shimmed }>(
        spelling,
      );
      assert.strictEqual(
        module.default,
        Shimmed,
        `${spelling} is served from the shim`,
      );
    }
  });

  // Every shape a shim can be registered in, so the remap guarantee below is a
  // property of the handler rather than of one registration path. `prefix` is
  // the shape a whole realm's worth of modules is most naturally shimmed in,
  // and the one a future `@cardstack/base/` shim would use.
  const REMAP_PREFIX = '@test-loader-remap/';
  const REMAP_ID = `${REMAP_PREFIX}shimmed-module`;
  const SHIM_SHAPES: {
    name: string;
    register: (
      virtualNetwork: VirtualNetwork,
      module: Record<string, unknown>,
    ) => void;
  }[] = [
    {
      name: 'shimModule',
      register: (virtualNetwork, module) =>
        virtualNetwork.shimModule(REMAP_ID, module),
    },
    {
      name: 'shimAsyncModule by id',
      register: (virtualNetwork, module) =>
        virtualNetwork.shimAsyncModule({
          id: REMAP_ID,
          resolve: async () => module,
        }),
    },
    {
      name: 'shimAsyncModule by prefix',
      register: (virtualNetwork, module) =>
        virtualNetwork.shimAsyncModule({
          prefix: REMAP_PREFIX,
          resolve: async () => module,
        }),
    },
  ];

  for (let shape of SHIM_SHAPES) {
    test(`a shim registered with ${shape.name} outlives a change to the realm mapping`, async function (assert) {
      // The handler keys a shim by the URL its identifier resolved to when it
      // was registered, and a lookup resolves through whatever mapping is
      // current. Re-pointing the prefix would otherwise strand the shim under
      // the old URL and send the import to the network.
      let virtualNetwork = new VirtualNetwork();
      let firstURL = 'https://shim-remap-first.example/';
      let secondURL = 'https://shim-remap-second.example/';
      virtualNetwork.addRealmMapping(REMAP_PREFIX, firstURL);
      class Shimmed {}
      shape.register(virtualNetwork, { default: Shimmed });
      virtualNetwork.addRealmMapping(REMAP_PREFIX, secondURL);

      let throwIfFetch = new Loader(
        async () => {
          throw new Error(
            'fetch should not be invoked for a module the virtual network shims',
          );
        },
        virtualNetwork.resolveImport,
        { virtualNetwork },
      );

      for (let spelling of [REMAP_ID, `${secondURL}shimmed-module`]) {
        let module = await throwIfFetch.import<{ default: typeof Shimmed }>(
          spelling,
        );
        assert.strictEqual(
          module.default,
          Shimmed,
          `${spelling} is served from the shim after remapping`,
        );
      }
    });
  }

  test('identify preserves original module for reexports', function (assert) {
    let throwIfFetch = new Loader(async () => {
      throw new Error(
        'fetch should not be invoked during shimmed module tests',
      );
    });

    class StringField {}

    throwIfFetch.shimModule(`${baseRealm.url}card-api.gts`, {
      StringField,
    });

    throwIfFetch.shimModule(`${baseRealm.url}string.gts`, {
      default: StringField,
    });

    // This Loader is constructed without a `virtualNetwork`, so
    // `captureIdentitiesOfModuleExports` records the raw shim module
    // identifier without running it through `vn.unresolveURL`. The
    // identity stays in URL form. Other test setups that build a VN
    // alongside the Loader see the RRI canonical form here.
    assert.deepEqual(Loader.identify(StringField), {
      module: `${baseRealm.url}card-api`,
      name: 'StringField',
    });
  });
});
