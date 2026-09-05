import { render } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { htmlComponent } from '@cardstack/host/lib/html-component';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Component | html-component', function (hooks) {
  setupRenderingTest(hooks);

  test('one component mounted twice renders its content in both places', async function (assert) {
    let Inert = htmlComponent(
      `<div class='card'><span data-test-inert-body>Body</span></div>`,
    );

    await render(
      <template>
        <div data-test-first-mount><Inert /></div>
        <div data-test-second-mount><Inert /></div>
      </template>,
    );

    assert
      .dom('[data-test-first-mount] [data-test-inert-body]')
      .hasText('Body', 'the first mount keeps its content');
    assert
      .dom('[data-test-second-mount] [data-test-inert-body]')
      .hasText('Body', 'the second mount has its own content');
  });
});
