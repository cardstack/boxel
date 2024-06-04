import {
  render,
  RenderingTestContext,
} from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

module('Integration | another', function (hooks) {
  setupRenderingTest(hooks);

  test('hello world', async function (this: RenderingTestContext, assert) {
    await render(<template><h1>Hello, world!</h1></template>);

    assert.dom('h1').hasText('Hello, world!');
  });
});
