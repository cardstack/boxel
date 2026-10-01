import { setupCardTest } from '@cardstack/host/tests/helpers';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

const siteModuleURL = new URL('./site', import.meta.url).href;

export function runTests() {
  module('Choreo gallery | runtime import', function (hooks) {
    setupCardTest(hooks);

    test('loads the authored card module', async function (assert) {
      let loader = getService('loader-service').loader;
      let { ChoreoGallery } = await loader.import(siteModuleURL);
      assert.ok(ChoreoGallery);
    });
  });
}
