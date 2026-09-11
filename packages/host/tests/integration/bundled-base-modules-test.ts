import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

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
});
