import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import {
  BUNDLED_BASE_MODULES,
  FETCHED_RE_EXPORTS,
} from '@cardstack/host/lib/bundled-base';

import { setupRenderingTest } from '../helpers/setup';

// What the `bundled-base-scoped-css` vite plugin writes as each base module is
// evaluated: the stylesheet specifiers in its compiled source, and the sibling
// base modules it imports. The second is what the closure check reads.
interface BundledBaseModuleImports {
  css: string[];
  imports: string[];
}

function scopedCSSRegistry(): Record<string, BundledBaseModuleImports> {
  return (
    (
      globalThis as {
        __boxelBundledBaseScopedCSS?: Record<string, BundledBaseModuleImports>;
      }
    ).__boxelBundledBaseScopedCSS ?? {}
  );
}

module('Integration | bundled base modules', function (hooks) {
  setupRenderingTest(hooks);

  test('the loader serves every bundled base module from the host bundle, not the base realm', async function (assert) {
    let network = getService('network');
    let loader = getService('loader-service').loader;
    let baseRealmRequests: string[] = [];
    let spy = async (request: Request) => {
      if (request.url.includes('/base/')) {
        baseRealmRequests.push(request.url);
      }
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });
    try {
      for (let [name, resolveBundled] of Object.entries(BUNDLED_BASE_MODULES)) {
        let bundled = await resolveBundled();
        let served = await loader.import<Record<string, unknown>>(
          `@cardstack/base/${name}`,
        );
        for (let key of Object.keys(bundled)) {
          assert.strictEqual(
            served[key],
            bundled[key],
            `${name}: the loader's ${key} export is the bundled one`,
          );
        }
      }
      assert.deepEqual(
        baseRealmRequests,
        [],
        'no bundled module was fetched from the base realm',
      );
    } finally {
      network.virtualNetwork.unmount(spy);
    }
  });

  // The set has to be closed under imports: the bundler resolves a bundled
  // module's imports into its chunk, so one reachable from a bundled module but
  // missing from the table is compiled in AND fetched when card code imports it
  // by identifier, leaving two copies whose classes do not match. Nothing else
  // fails when that stops holding — a shim declares its dependencies rather than
  // having them observed, so both dependency walks stop at them, and a module
  // whose own imports were dropped from a card's recorded closure produces an
  // index row that under-invalidates rather than an error.
  test('every base module a bundled module imports is bundled too', async function (assert) {
    for (let name of Object.keys(BUNDLED_BASE_MODULES)) {
      // The registry is written as a module is evaluated, so read it only
      // after every entry has been.
      await BUNDLED_BASE_MODULES[name]();
    }
    let registry = scopedCSSRegistry();
    assert.ok(
      Object.keys(registry).length > 0,
      'the vite plugin registered the base modules it compiled',
    );

    let violations: string[] = [];
    for (let name of Object.keys(BUNDLED_BASE_MODULES)) {
      for (let imported of registry[name]?.imports ?? []) {
        if (imported in BUNDLED_BASE_MODULES) {
          continue;
        }
        if (FETCHED_RE_EXPORTS.has(imported)) {
          continue;
        }
        violations.push(`${name} -> ${imported}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      'no bundled module imports a base module outside the table',
    );
  });

  // Why the whole-file re-exporters are fetched rather than bundled: evaluating
  // one asks the loader for what it re-exports from, so the declarer is served
  // first and the class is credited to it. Bundling the re-exporter is what
  // breaks this — the bundler resolves that import inside the chunk, the loader
  // is never asked for `card-api`, and every `FileDef` code ref then names a
  // module that does not declare it, which an adoption-chain walk reaches as a
  // filter referring to a nonexistent type. So this fails if `file-api` is ever
  // added to the table.
  test('a re-exporter left out of the bundle credits the class to its declarer', async function (assert) {
    let loader = getService('loader-service').loader;
    // Only the re-exporter is asked for, which is what a card importing just
    // `file-api` does.
    let served = await loader.import<Record<string, unknown>>(
      '@cardstack/base/file-api',
    );
    assert.deepEqual(Loader.identify(served.FileDef), {
      module: '@cardstack/base/card-api',
      name: 'FileDef',
    });
  });
});
