// Pretui — PanelSection unit tests.
import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PanelSection } from './panel-section';

function region(): HTMLElement {
  return document.querySelector('.pretui-section-region') as HTMLElement;
}
function toggle(): HTMLElement {
  return document.querySelector('[data-test-pretui-section-toggle]') as HTMLElement;
}

module('Pretui | components/panel-section', function (hooks) {
  setupCardTest(hooks);

  test('a closed section takes its controls out of the tab order', async function (assert) {
    await render(
      <template>
        <PanelSection @title='Layout'><input aria-label='Width' /></PanelSection>
      </template>,
    );
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'true');
    assert.false(region().inert, 'open: the body is reachable');
    await click(toggle());
    assert.strictEqual(toggle().getAttribute('aria-expanded'), 'false');
    assert.true(region().inert, 'closed: the body is inert');
    assert.strictEqual(region().getAttribute('aria-hidden'), 'true');
    await click(toggle());
    assert.false(region().inert, 'reopened: reachable again');
  });

  test('the summary describes the toggle, and actions sit in the header', async function (assert) {
    await render(
      <template>
        <PanelSection @title='Effects' @summary='3 effects'>
          <:actions><button type='button' data-test-add>Add</button></:actions>
          <:default>body</:default>
        </PanelSection>
      </template>,
    );
    let summary = document.querySelector('.pretui-section-summary') as HTMLElement;
    assert.strictEqual(toggle().getAttribute('aria-describedby'), summary.id);
    assert.strictEqual(summary.textContent, '3 effects');
    assert.ok(document.querySelector('.pretui-section-actions [data-test-add]'));
  });
});
