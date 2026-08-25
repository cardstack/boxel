import { module, test } from 'qunit';

import { VirtualNetwork } from '@cardstack/runtime-common';
import {
  Loader,
  type ModuleEvaluator,
  type ModuleRegistration,
} from '@cardstack/runtime-common/loader';

const origin = 'https://loader-seams.test/';

// Stands in for a realm serving module source: the tests own what each URL
// answers with and, where an interleaving is the thing under test, when the
// answer arrives.
class SourceServer {
  sources: Map<string, string>;
  fetchCounts = new Map<string, number>();
  // Path a realm names a module by when it differs from the one requested,
  // served as `X-Boxel-Canonical-Path`.
  canonicalPaths = new Map<string, string>();
  #parkedURLs = new Set<string>();
  #parked: Array<{ url: string; release: (fail: boolean) => void }> = [];

  constructor(sources: Record<string, string>) {
    this.sources = new Map(
      Object.entries(sources).map(([path, source]) => [
        `${origin}${path}`,
        source,
      ]),
    );
  }

  url(path: string): string {
    return `${origin}${path}`;
  }

  fetch: typeof globalThis.fetch = async (urlOrRequest, init) => {
    let url = new Request(urlOrRequest as RequestInfo, init).url;
    this.fetchCounts.set(url, (this.fetchCounts.get(url) ?? 0) + 1);
    // A realm resolves an extensionless import to the file that backs it; the
    // loader emits dependency URLs without an extension, so answer both. Read
    // before parking, so a held fetch answers with the source that was current
    // when it was issued — a response in flight carries the bytes the server
    // already sent.
    let source =
      this.sources.get(url) ??
      this.sources.get(`${url}.js`) ??
      this.sources.get(`${url}.gts`);
    if (this.#parkedURLs.has(url)) {
      let failed = await new Promise<boolean>((resolve) => {
        this.#parked.push({ url, release: resolve });
      });
      if (failed) {
        return new Response('server error', { status: 500 });
      }
    }
    if (source == null) {
      return new Response(`no such module ${url}`, { status: 404 });
    }
    let canonicalPath = this.canonicalPaths.get(url);
    return new Response(source, {
      headers: {
        'content-type': 'text/javascript',
        ...(canonicalPath ? { 'X-Boxel-Canonical-Path': canonicalPath } : {}),
      },
    });
  };

  // Hold every subsequent fetch of `url` until the test releases it, so a
  // second generation of the same module can be started while the first is
  // still in flight.
  park(path: string) {
    this.#parkedURLs.add(this.url(path));
  }

  parkedCount(path: string): number {
    let url = this.url(path);
    return this.#parked.filter((entry) => entry.url === url).length;
  }

  unpark(path: string) {
    this.#parkedURLs.delete(this.url(path));
  }

  // Releases one parked fetch by its arrival position, so a test can choose
  // the order two generations of a module complete in.
  release(path: string, arrival: number, outcome: 'source' | 'failure') {
    let url = this.url(path);
    let parked = this.#parked.filter((entry) => entry.url === url);
    if (!parked[arrival]) {
      throw new Error(
        `no fetch of ${url} has arrived at position ${arrival} (${parked.length} parked)`,
      );
    }
    parked[arrival].release(outcome === 'failure');
  }
}

const fixtures = {
  'leaf.js': `export function leaf() { return 'leaf'; }`,
  'middle.js': `
    import { leaf } from './leaf';
    export function middle() { return 'middle-' + leaf(); }
  `,
  'top.js': `
    import { middle } from './middle';
    export function top() { return 'top-' + middle(); }
  `,
  'unrelated.js': `export function unrelated() { return 'unrelated'; }`,
  'cycle-a.js': `
    import { b } from './cycle-b';
    export function a() { return 'a' + b(); }
  `,
  'cycle-b.js': `
    import { a } from './cycle-a';
    export function b() { return 'b'; }
    export function both() { return a(); }
  `,
  'meta.js': `
    export function metaURL() { return import.meta.url; }
    export function metaLoader() { return import.meta.loader; }
  `,
  'gen.js': `export function value() { return 'v1'; }`,
  'throws-on-eval.js': `
    import { leaf } from './leaf';
    export const usesLeaf = leaf;
    throw new Error('intentional evaluation failure');
  `,
  // `./race-b` before `./race-slow`, and a two-module cycle through race-b,
  // is what leaves race-a's dependency list frozen with both edges still
  // completing — see the concurrent-completion test below.
  'race-a.js': `
    import { b } from './race-b';
    import { slow } from './race-slow';
    export function a() { return 'a'; }
    export function reads() { return b + slow; }
  `,
  'race-b.js': `
    import { a } from './race-a';
    export const b = 'b';
  `,
  'race-slow.js': `export const slow = 'v1';`,
};

async function waitFor(condition: () => boolean, description: string) {
  let deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

module('Unit | loader seams', function (hooks) {
  let server: SourceServer;
  let loader: Loader;

  hooks.beforeEach(function () {
    server = new SourceServer(fixtures);
    loader = makeLoader();
  });

  function makeLoader(options?: {
    moduleEvaluator?: ModuleEvaluator;
    moduleMeta?: (moduleIdentifier: string) => object;
  }): Loader {
    return new Loader(server.fetch, undefined, options);
  }

  // A registration the loader can use, synthesized rather than evaluated, so
  // an evaluator's answer is distinguishable from the module's own source.
  function stubRegistration(value: string): ModuleRegistration {
    return {
      dependencyList: ['exports'],
      implementation: (exports: Record<string, unknown>) => {
        exports.leaf = () => value;
        exports.evaluatedBy = () => 'stub';
      },
    };
  }

  test('a module evaluator supplied at construction replaces evaluation of the source', async function (assert) {
    let evaluated: string[] = [];
    let stubLoader = makeLoader({
      moduleEvaluator: (_source, moduleIdentifier) => {
        evaluated.push(moduleIdentifier);
        return stubRegistration('from the injected evaluator');
      },
    });

    let module = await stubLoader.import<{
      leaf(): string;
      evaluatedBy(): string;
    }>(server.url('leaf.js'));

    assert.deepEqual(
      evaluated,
      [server.url('leaf.js')],
      'the evaluator was asked for exactly this module',
    );
    assert.strictEqual(module.leaf(), 'from the injected evaluator');
    assert.strictEqual(
      module.evaluatedBy(),
      'stub',
      "the module's own source was never evaluated",
    );
  });

  test('an evaluator receives the transpiled AMD registration wrapper', async function (assert) {
    let sources: string[] = [];
    let stubLoader = makeLoader({
      moduleEvaluator: (source) => {
        sources.push(source);
        return stubRegistration('stubbed');
      },
    });

    await stubLoader.import(server.url('leaf.js'));

    assert.strictEqual(sources.length, 1);
    assert.true(
      sources[0].includes('define('),
      'the source is the AMD registration wrapper, not the original module',
    );
    assert.true(
      sources[0].includes(`//# sourceURL=${server.url('leaf.js')}`),
      'the source names the module it came from',
    );
  });

  test('the loader resolves the dependencies an injected evaluator names', async function (assert) {
    let stubLoader = makeLoader({
      moduleEvaluator: (_source, moduleIdentifier) => {
        if (moduleIdentifier !== server.url('middle.js')) {
          return {
            dependencyList: ['exports'],
            implementation: (exports: Record<string, unknown>) => {
              exports.leaf = () => 'the real leaf';
            },
          };
        }
        return {
          dependencyList: ['exports', './leaf'],
          implementation: (
            exports: Record<string, unknown>,
            leafModule: { leaf(): string },
          ) => {
            exports.middle = () => `middle sees ${leafModule.leaf()}`;
          },
        };
      },
    });

    let module = await stubLoader.import<{ middle(): string }>(
      server.url('middle.js'),
    );

    assert.strictEqual(module.middle(), 'middle sees the real leaf');
  });

  test('a registration the loader cannot use fails the module by name', async function (assert) {
    let unusable: Record<string, unknown> = {
      'nothing at all': undefined,
      // Carries a usable implementation, so only the dependency-list arm can
      // refuse it.
      'a dependency list that is not a list': {
        dependencyList: 'not a list',
        implementation: () => {},
      },
      'an implementation that is not callable': {
        dependencyList: [],
        implementation: 'not callable',
      },
      // Passes `Array.isArray`, so only an element check refuses it before
      // the loader tries to resolve 42 as a module identifier.
      'a dependency that is not an identifier': {
        dependencyList: ['exports', 42],
        implementation: () => {},
      },
    };

    for (let [description, registration] of Object.entries(unusable)) {
      let calls = 0;
      let stubLoader = makeLoader({
        moduleEvaluator: () => {
          calls++;
          return registration as unknown as ModuleRegistration;
        },
      });

      for (let attempt of ['first', 'second']) {
        await assert.rejects(
          stubLoader.import(server.url('leaf.js')),
          (err: Error) =>
            err.message.includes(
              `Module evaluator returned an invalid registration for ${server.url(
                'leaf.js',
              )}`,
            ),
          `${description}: the ${attempt} import fails with the named registration error`,
        );
      }
      assert.strictEqual(
        calls,
        1,
        `${description}: the failure is cached, so the evaluator is not asked again`,
      );
    }
  });

  test('a realm-mapping change discards what a fetch answered with', async function (assert) {
    let virtualNetwork = new VirtualNetwork(async () => {
      let response = new Response();
      (response as any)[Symbol.for('shimmed-module')] = { shimmed: true };
      return response;
    });
    virtualNetwork.addRealmMapping('@seams-remap/', origin);
    let mappedLoader = new Loader(
      virtualNetwork.fetch,
      virtualNetwork.resolveImport,
      { virtualNetwork },
    );

    await mappedLoader.import('@seams-remap/served-shim.gts');
    assert.true(mappedLoader.isShimmedModule('@seams-remap/served-shim'));

    virtualNetwork.addRealmMapping('@seams-remap-other/', origin);
    assert.false(
      mappedLoader.isShimmedModule('@seams-remap/served-shim'),
      'the record is keyed by a spelling only the previous mapping set defines',
    );
  });

  test('an injected evaluator is never asked about a shimmed module', async function (assert) {
    let calls = 0;
    let stubLoader = makeLoader({
      moduleEvaluator: () => {
        calls++;
        return stubRegistration('stubbed');
      },
    });
    stubLoader.shimModule(server.url('leaf.js'), { leaf: () => 'shimmed' });

    let module = await stubLoader.import<{ leaf(): string }>(
      server.url('leaf.js'),
    );

    assert.strictEqual(module.leaf(), 'shimmed');
    assert.strictEqual(calls, 0, 'a shim has no source to evaluate');
  });

  test("omitting the evaluator evaluates the module in the loader's own realm", async function (assert) {
    let module = await loader.import<{ top(): string }>(server.url('top.js'));
    assert.strictEqual(module.top(), 'top-middle-leaf');
  });

  test('moduleMeta decides what import.meta exposes to a module', async function (assert) {
    // Served under a canonical path that differs from the URL it was reached
    // by, so "the module's URL" and "the identifier the caller used" are two
    // distinguishable strings here.
    server.canonicalPaths.set(server.url('meta.js'), '/canonical-meta.js');
    let denial = { denied: 'the real loader never crosses this boundary' };
    let seen: string[] = [];
    let stubLoader = makeLoader({
      moduleMeta: (moduleURL) => {
        seen.push(moduleURL);
        return { url: moduleURL, loader: denial };
      },
    });

    let module = await stubLoader.import<{
      metaURL(): string;
      metaLoader(): unknown;
    }>(server.url('meta.js'));

    assert.deepEqual(
      seen,
      [server.url('canonical-meta.js')],
      'moduleMeta is asked by the URL the module is canonically known by',
    );
    assert.strictEqual(module.metaURL(), server.url('canonical-meta.js'));
    assert.strictEqual(
      module.metaLoader(),
      denial,
      'the module sees what moduleMeta supplied, not the loader',
    );
  });

  test('omitting moduleMeta exposes the loader itself', async function (assert) {
    let module = await loader.import<{
      metaURL(): string;
      metaLoader(): unknown;
    }>(server.url('meta.js'));

    assert.strictEqual(module.metaURL(), server.url('meta.js'));
    assert.strictEqual(module.metaLoader(), loader);
  });

  test('cloneLoader carries the evaluator and moduleMeta', async function (assert) {
    let denial = { denied: true };
    let evaluated: string[] = [];
    let stubLoader = makeLoader({
      moduleEvaluator: (_source, moduleIdentifier) => {
        evaluated.push(moduleIdentifier);
        return {
          dependencyList: ['exports', '__import_meta__'],
          implementation: (
            exports: Record<string, unknown>,
            meta: { loader: unknown },
          ) => {
            exports.metaLoader = () => meta.loader;
          },
        };
      },
      moduleMeta: (moduleIdentifier) => ({
        url: moduleIdentifier,
        loader: denial,
      }),
    });

    let clone = Loader.cloneLoader(stubLoader);
    let module = await clone.import<{ metaLoader(): unknown }>(
      server.url('meta.js'),
    );

    assert.deepEqual(
      evaluated,
      [server.url('meta.js')],
      'the clone evaluates through the same evaluator',
    );
    assert.strictEqual(
      module.metaLoader(),
      denial,
      'the clone exposes the same import.meta',
    );
  });

  test('isShimmedModule recognizes a shim under any spelling of the same module', async function (assert) {
    loader.shimModule(server.url('shimmed.gts'), { shimmed: true });

    for (let spelling of ['shimmed.gts', 'shimmed', 'shimmed.ts']) {
      assert.true(
        loader.isShimmedModule(server.url(spelling)),
        `${spelling} names the shimmed module`,
      );
    }
  });

  test('isShimmedModule is false for a module with fetchable source', async function (assert) {
    assert.false(loader.isShimmedModule(server.url('leaf.js')));
    await loader.import(server.url('leaf.js'));
    assert.false(
      loader.isShimmedModule(server.url('leaf.js')),
      'importing source does not make a module a shim',
    );
  });

  test('isShimmedModule recognizes a shim that arrived from the fetch response', async function (assert) {
    let shim = { fromTheNetwork: () => 'shimmed' };
    let shimServingLoader = new Loader(async () => {
      let response = new Response();
      (response as any)[Symbol.for('shimmed-module')] = shim;
      return response;
    });

    assert.false(
      shimServingLoader.isShimmedModule(server.url('served-shim.gts')),
      'nothing is known about the module before it is loaded',
    );
    await shimServingLoader.import(server.url('served-shim.gts'));
    assert.true(
      shimServingLoader.isShimmedModule(server.url('served-shim')),
      'a shim discovered over the network is a shim under every spelling',
    );
  });

  test('invalidateModule evicts the module and the modules that import it', async function (assert) {
    await loader.import(server.url('top.js'));
    await loader.import(server.url('unrelated.js'));

    assert.strictEqual(
      loader.invalidateModule(server.url('middle.js')),
      2,
      'the module and its one importer are removed',
    );
    assert.false(loader.isModuleLoaded(server.url('middle.js')));
    assert.false(
      loader.isModuleLoaded(server.url('top.js')),
      'an importer closed over the replaced exports, so it goes too',
    );
    assert.true(
      loader.isModuleLoaded(server.url('leaf.js')),
      'a dependency of the invalidated module is untouched',
    );
    assert.true(
      loader.isModuleLoaded(server.url('unrelated.js')),
      'an unrelated module is untouched',
    );
  });

  test('invalidateModule fans in through an import cycle', async function (assert) {
    await loader.import(server.url('cycle-a.js'));

    assert.strictEqual(
      loader.invalidateModule(server.url('cycle-b.js')),
      2,
      'the module that closed the cycle is a dependent too',
    );
    assert.false(loader.isModuleLoaded(server.url('cycle-a.js')));
    assert.false(loader.isModuleLoaded(server.url('cycle-b.js')));
  });

  test('an invalidated module and its importers re-import the new source', async function (assert) {
    let first = await loader.import<{ top(): string }>(server.url('top.js'));
    assert.strictEqual(first.top(), 'top-middle-leaf');
    let unrelatedFetches = server.fetchCounts.get(server.url('unrelated.js'));

    server.sources.set(
      server.url('leaf.js'),
      `export function leaf() { return 'leaf-v2'; }`,
    );
    assert.strictEqual(loader.invalidateModule(server.url('leaf.js')), 3);

    let second = await loader.import<{ top(): string }>(server.url('top.js'));
    assert.strictEqual(
      second.top(),
      'top-middle-leaf-v2',
      'every module that consumed the replaced one is rebuilt on it',
    );
    assert.strictEqual(
      server.fetchCounts.get(server.url('unrelated.js')),
      unrelatedFetches,
      'nothing outside the dependent set was refetched',
    );
  });

  test('invalidating a module discards the cached dependency sets that reached it', async function (assert) {
    await loader.import(server.url('top.js'));
    assert.deepEqual(
      loader.getKnownConsumedModules(server.url('top.js')).sort(),
      [server.url('leaf'), server.url('middle')],
      'the dependency set is cached off the first walk',
    );

    server.sources.set(
      server.url('middle.js'),
      `import { leaf } from './leaf';
       import { unrelated } from './unrelated';
       export function middle() { return 'middle-' + leaf() + unrelated(); }`,
    );
    loader.invalidateModule(server.url('middle.js'));
    await loader.import(server.url('top.js'));

    assert.deepEqual(
      loader.getKnownConsumedModules(server.url('top.js')).sort(),
      [server.url('leaf'), server.url('middle'), server.url('unrelated')],
      'the dependency set is rebuilt on the replaced module',
    );
  });

  // The loader records a dependency as `completing-dep` when it is still
  // completing on the recording task's own recursion stack. A second import
  // root entering during that window (the interleaving
  // `loader-concurrent-cycle-test` pins) leaves the first module evaluating
  // straight out of that state, so those edges are the only record of what it
  // imported — and one of them here is not part of any cycle.
  test('invalidateModule reaches a dependency that was still completing when its importer evaluated', async function (assert) {
    server.park('race-slow');
    // Every module here is named by its extensionless spelling, the one
    // race-b's import of race-a produces: the completing-dep bookkeeping
    // compares raw identifiers, so a root imported by a different spelling of
    // the same module does not enter this interleaving at all.
    let root1 = loader.import<{ reads(): string }>(server.url('race-a'));
    await waitFor(
      () => server.parkedCount('race-slow') === 1,
      'the slow dependency to be requested',
    );
    let root2 = loader.import(server.url('race-b'));
    server.release('race-slow', 0, 'source');
    let [moduleA] = await Promise.all([root1, root2]);
    assert.strictEqual(moduleA.reads(), 'bv1');

    server.unpark('race-slow');
    server.sources.set(server.url('race-slow.js'), `export const slow = 'v2';`);
    assert.strictEqual(
      loader.invalidateModule(server.url('race-slow')),
      3,
      'the importer whose edges were still completing is a dependent too',
    );

    let reimported = await loader.import<{ reads(): string }>(
      server.url('race-a'),
    );
    assert.strictEqual(
      reimported.reads(),
      'bv2',
      'no copy of the replaced module survives in an importer',
    );
  });

  test('invalidateModule reaches an importer whose dependency is still completing', async function (assert) {
    server.park('race-slow');
    let root1 = loader.import(server.url('race-a'));
    await waitFor(
      () => server.parkedCount('race-slow') === 1,
      'the slow dependency to be requested',
    );
    // Entering at race-b while the first root is suspended leaves race-b
    // holding race-a as a dependency that is still completing — the state the
    // eviction has to read before either module reaches evaluation.
    let root2 = loader.import(server.url('race-b'));
    await waitFor(
      () => loader.isModuleLoaded(server.url('race-b')),
      'the second root to register race-b',
    );

    assert.strictEqual(
      loader.invalidateModule(server.url('race-a')),
      2,
      'the importer goes even though neither module has evaluated',
    );

    server.unpark('race-slow');
    server.release('race-slow', 0, 'source');
    let settled = await Promise.allSettled([root1, root2]);
    assert.deepEqual(
      settled.map((outcome) => outcome.status),
      ['fulfilled', 'fulfilled'],
      'both in-flight roots complete against the refetched modules',
    );
  });

  test('invalidateModule evicts importers that have registered but not evaluated', async function (assert) {
    server.park('leaf');
    let pending = loader.import<{ top(): string }>(server.url('top.js'));
    await waitFor(
      () => server.parkedCount('leaf') === 1,
      'the leaf fetch to be issued',
    );

    assert.strictEqual(
      loader.invalidateModule(server.url('leaf')),
      3,
      'a registered importer names its dependencies before it evaluates',
    );

    server.sources.set(
      server.url('leaf.js'),
      `export function leaf() { return 'leaf-v2'; }`,
    );
    server.unpark('leaf');
    server.release('leaf', 0, 'source');
    assert.strictEqual(
      (await pending).top(),
      'top-middle-leaf-v2',
      'the suspended import completes against the replacement',
    );
  });

  // Every loader the host builds carries a VirtualNetwork and its import
  // resolution, which is what folds a module's realm-prefix, virtual-alias and
  // real-URL spellings onto one cache key.
  test('the seams address a module by any spelling a realm mapping gives it', async function (assert) {
    let virtualNetwork = new VirtualNetwork(server.fetch);
    virtualNetwork.addRealmMapping('@seams-test/', origin);
    let mappedLoader = new Loader(
      virtualNetwork.fetch,
      virtualNetwork.resolveImport,
      { virtualNetwork },
    );

    await mappedLoader.import(server.url('top.js'));
    mappedLoader.shimModule('@seams-test/shimmed.gts', { shimmed: true });

    for (let spelling of [
      '@seams-test/shimmed',
      '@seams-test/shimmed.gts',
      `${origin}shimmed.ts`,
    ]) {
      assert.true(
        mappedLoader.isShimmedModule(spelling),
        `${spelling} names the shimmed module`,
      );
    }

    assert.strictEqual(
      mappedLoader.invalidateModule('@seams-test/middle'),
      2,
      'the realm-prefix spelling names the module the cache keyed by',
    );
    assert.false(mappedLoader.isModuleLoaded(server.url('middle.js')));
    assert.true(mappedLoader.isModuleLoaded(server.url('leaf.js')));

    // A bare package specifier is a module identity too, and only import
    // resolution turns it into the URL the loader files it under — the form
    // authored code names a trusted package by.
    mappedLoader.shimModule('a-bare-package', { bare: true });
    assert.true(mappedLoader.isShimmedModule('a-bare-package'));
    assert.strictEqual(
      mappedLoader.invalidateModule('a-bare-package'),
      1,
      'a bare specifier resolves to the module it was filed under',
    );
  });

  test('invalidating a module forgets that its last fetch answered with a shim', async function (assert) {
    let shim = { fromTheNetwork: () => 'shimmed' };
    let servesShim = true;
    let switching = new Loader(async () => {
      if (servesShim) {
        let response = new Response();
        (response as any)[Symbol.for('shimmed-module')] = shim;
        return response;
      }
      return new Response(`export function value() { return 'source'; }`, {
        headers: { 'content-type': 'text/javascript' },
      });
    });

    await switching.import(server.url('switching.gts'));
    assert.true(switching.isShimmedModule(server.url('switching.gts')));

    servesShim = false;
    switching.invalidateModule(server.url('switching.gts'));
    assert.false(
      switching.isShimmedModule(server.url('switching.gts')),
      'the eviction forgets what the last fetch answered with',
    );

    let module = await switching.import<{ value(): string }>(
      server.url('switching.gts'),
    );
    assert.strictEqual(module.value(), 'source');
    assert.false(
      switching.isShimmedModule(server.url('switching.gts')),
      'a module now served as source is not a shim',
    );
  });

  test('invalidateModule accepts the spellings a caller can hold', async function (assert) {
    let spellings = {
      'an extensionless identifier': server.url('leaf'),
      'the identifier with its extension': server.url('leaf.js'),
      'a path that only resolves once normalized': server.url('sub/../leaf.js'),
      'a URL carrying its default port': `https://loader-seams.test:443/leaf.js`,
    };

    for (let [description, spelling] of Object.entries(spellings)) {
      await loader.import(server.url('leaf.js'));
      assert.strictEqual(
        loader.invalidateModule(spelling),
        1,
        `${description} names the module`,
      );
    }
  });

  test('invalidateModule evicts an importer that broke while evaluating', async function (assert) {
    await assert.rejects(loader.import(server.url('throws-on-eval.js')));
    assert.true(loader.isModuleLoaded(server.url('throws-on-eval.js')));

    assert.strictEqual(
      loader.invalidateModule(server.url('leaf')),
      2,
      'a module cached broken still names what it imported',
    );
    assert.false(
      loader.isModuleLoaded(server.url('throws-on-eval.js')),
      'the failure is not pinned past the replacement of its dependency',
    );
  });

  test('a dependency walk taken while a module is evicted is not memoized', async function (assert) {
    await loader.import(server.url('top.js'));
    assert.deepEqual(
      loader.getKnownConsumedModules(server.url('top.js')).sort(),
      [server.url('leaf'), server.url('middle')],
      'the dependency set is cached off the first walk',
    );

    loader.invalidateModule(server.url('leaf'));
    assert.deepEqual(
      loader.getKnownConsumedModules(server.url('top.js')),
      [],
      'a walk taken while the module is gone reports what is loaded, which is nothing',
    );

    await loader.import(server.url('top.js'));
    assert.deepEqual(
      loader.getKnownConsumedModules(server.url('top.js')).sort(),
      [server.url('leaf'), server.url('middle')],
      'that walk did not outlive the gap it was taken in',
    );
  });

  test('an eviction landing after the graph is walked re-enters instead of failing the import', async function (assert) {
    // The read this covers happens after the walk has resolved, so no fetch
    // can reach it — driving the interleaving means stepping in where the
    // import awaits. Counting microtasks instead would pin nothing stable.
    let prototype = Object.getPrototypeOf(loader) as Record<string, unknown>;
    let walk = prototype.advanceToState as (
      ...args: unknown[]
    ) => Promise<void>;
    assert.strictEqual(
      typeof walk,
      'function',
      'the walk this test steps into still exists',
    );

    let evictions = 0;
    prototype.advanceToState = async function (
      this: Loader,
      ...args: unknown[]
    ) {
      let result = await walk.apply(this, args);
      if (evictions === 0) {
        evictions++;
        this.invalidateModule(server.url('leaf'));
      }
      return result;
    };

    try {
      let module = await loader.import<{ leaf(): string }>(
        server.url('leaf.js'),
      );
      assert.strictEqual(
        module.leaf(),
        'leaf',
        'the import resolves against the module that replaced the evicted one',
      );
    } finally {
      prototype.advanceToState = walk;
    }
    assert.strictEqual(
      evictions,
      1,
      'the eviction fired in the window under test',
    );
  });

  test('invalidateModule reports nothing removed for a module this loader never loaded', async function (assert) {
    await loader.import(server.url('leaf.js'));
    assert.strictEqual(loader.invalidateModule(server.url('absent.js')), 0);
    assert.strictEqual(
      loader.invalidateModule('not-a-url'),
      0,
      'an identifier that resolves to nothing removes nothing',
    );
    assert.true(
      loader.isModuleLoaded(server.url('leaf.js')),
      'invalidating an unknown module leaves the cache alone',
    );
  });

  test('a response that arrives after its fetch was invalidated does not replace the newer module', async function (assert) {
    server.park('gen.js');
    let stale = loader.import<{ value(): string }>(server.url('gen.js'));
    await waitFor(() => server.parkedCount('gen.js') === 1, 'the first fetch');

    assert.strictEqual(
      loader.invalidateModule(server.url('gen.js')),
      1,
      'the in-flight fetch is the entry that gets removed',
    );
    server.sources.set(
      server.url('gen.js'),
      `export function value() { return 'v2'; }`,
    );
    let current = loader.import<{ value(): string }>(server.url('gen.js'));
    await waitFor(() => server.parkedCount('gen.js') === 2, 'the second fetch');

    server.release('gen.js', 1, 'source');
    assert.strictEqual((await current).value(), 'v2');

    server.release('gen.js', 0, 'source');
    assert.strictEqual(
      (await stale).value(),
      'v2',
      'the invalidated import resolves against the replacement',
    );

    let later = await loader.import<{ value(): string }>(server.url('gen.js'));
    assert.strictEqual(
      later.value(),
      'v2',
      'the stale response did not overwrite the cached module',
    );
  });

  test('a failure that arrives after its fetch was invalidated does not evict the newer module', async function (assert) {
    server.park('gen.js');
    let stale = loader.import<{ value(): string }>(server.url('gen.js'));
    await waitFor(() => server.parkedCount('gen.js') === 1, 'the first fetch');

    loader.invalidateModule(server.url('gen.js'));
    let current = loader.import<{ value(): string }>(server.url('gen.js'));
    await waitFor(() => server.parkedCount('gen.js') === 2, 'the second fetch');

    server.release('gen.js', 1, 'source');
    assert.strictEqual((await current).value(), 'v1');

    server.release('gen.js', 0, 'failure');
    assert.strictEqual(
      (await stale).value(),
      'v1',
      'the invalidated import resolves against the replacement',
    );
    assert.true(
      loader.isModuleLoaded(server.url('gen.js')),
      'the stale failure did not evict the module that replaced it',
    );
  });
});
