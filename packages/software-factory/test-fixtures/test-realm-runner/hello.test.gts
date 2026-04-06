import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard', function (hooks) {
    setupCardTest(hooks);

    test('greeting renders in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from the test fixture!' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('Hello from the test fixture!');
    });
  });
}
