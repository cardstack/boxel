import { click, render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Accordion } from '@cardstack/boxel-ui/components';

class State {
  @tracked isOpen = false;
}

module('Integration | Component | accordion', function (hooks) {
  setupRenderingTest(hooks);

  test('item trigger exposes aria-expanded as "true"/"false" strings', async function (assert) {
    let state = new State();
    let toggle = () => (state.isOpen = !state.isOpen);

    await render(
      <template>
        <Accordion as |A|>
          <A.Item @id='details' @isOpen={{state.isOpen}} @onClick={{toggle}}>
            <:title>Details</:title>
            <:content>Content body</:content>
          </A.Item>
        </Accordion>
      </template>,
    );

    assert
      .dom('#details')
      .hasAttribute('aria-expanded', 'false', 'closed item reads false');
    assert
      .dom('#section-details')
      .hasAttribute('data-state', 'closed', 'closed item content is closed');

    await click('#details');

    assert
      .dom('#details')
      .hasAttribute('aria-expanded', 'true', 'open item reads true');
    assert
      .dom('#section-details')
      .hasAttribute('data-state', 'open', 'open item content is open');
    assert
      .dom('#section-details')
      .hasAttribute('aria-hidden', 'false', 'open item content is visible');
  });
});
