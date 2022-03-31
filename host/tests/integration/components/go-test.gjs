import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import { precompileTemplate } from '@ember/template-compilation';
import Go from '../../../components/go';

async function renderComponent(C) {
  await render(precompileTemplate(`<C/>`, { scope: () => ({ C }) }));
}

module('Integration | Component | go', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders', async function (assert) {
    await renderComponent(<template><Go/></template>)
    assert.strictEqual(this.element.textContent!.trim(), 'Go');
  });
});
