import { getService } from '@universal-ember/test-support';

import { module, test, todo } from 'qunit';

import { Loader } from '@cardstack/runtime-common';

import { BUNDLED_BASE_MODULES } from '@cardstack/host/lib/bundled-base';

import { setupRenderingTest } from '../helpers/setup';

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

  // `todo`: fails today. A loader credits a class to the first module it
  // serves that exposes it. A module the loader fetches cannot get this wrong,
  // because evaluating it loads what it re-exports from first. A bundled one
  // can: the bundler resolves that import inside the chunk, so the loader is
  // never asked for `card-api` and credits `file-api` with a class `card-api`
  // declares. Every `FileDef` code ref then names a module that does not
  // declare it, and an adoption-chain walk that stops at the declarer walks
  // past it — which reaches a caller as a filter referring to a nonexistent
  // type.
  todo(
    'a bundled module that re-exports a class does not take its identity',
    async function (assert) {
      let loader = getService('loader-service').loader;
      // Only the re-exporter is asked for, which is what a card importing
      // just `file-api` does.
      let served = await loader.import<Record<string, unknown>>(
        '@cardstack/base/file-api',
      );
      assert.deepEqual(Loader.identify(served.FileDef), {
        module: '@cardstack/base/card-api',
        name: 'FileDef',
      });
    },
  );
});
