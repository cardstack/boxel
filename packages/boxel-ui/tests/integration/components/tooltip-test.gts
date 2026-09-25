import { Tooltip } from '@cardstack/boxel-ui/components';
import { blur, focus, render, triggerEvent } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

const TRIGGER = '[data-test-tooltip-trigger]';
const CONTENT = '[data-test-tooltip-content]';

// The tooltip renders its content into an overlay outside the trigger, so the
// content selector is looked up from the document root.
module('Integration | Component | tooltip', function (hooks) {
  setupRenderingTest(hooks);

  async function renderTooltip(disabled = false) {
    await render(
      <template>
        <Tooltip @disabled={{disabled}}>
          <:trigger>
            <button type='button' data-test-tooltip-trigger>Save</button>
          </:trigger>
          <:content>Saves the card</:content>
        </Tooltip>
      </template>,
    );
  }

  test('hover shows the content and leaving hides it', async function (assert) {
    await renderTooltip();
    assert.dom(CONTENT).doesNotExist('closed at rest');

    await triggerEvent(TRIGGER, 'mouseenter');
    assert.dom(CONTENT).hasText('Saves the card');

    await triggerEvent(TRIGGER, 'mouseleave');
    assert.dom(CONTENT).doesNotExist();
  });

  // No pointer has touched the page in this test, so the browser treats the
  // programmatic focus as keyboard focus and the trigger matches
  // :focus-visible, which is the condition the component keys on.
  test('keyboard focus on the trigger shows the content', async function (assert) {
    await renderTooltip();

    await focus(TRIGGER);
    assert.dom(CONTENT).exists('opened by focus alone');

    await blur(TRIGGER);
    assert.dom(CONTENT).doesNotExist('closed when focus leaves');
  });

  test('a pointer leaving a trigger that keeps keyboard focus leaves the content open', async function (assert) {
    await renderTooltip();

    await focus(TRIGGER);
    await triggerEvent(TRIGGER, 'mouseenter');
    await triggerEvent(TRIGGER, 'mouseleave');
    assert.dom(CONTENT).exists('focus still holds it open');

    await blur(TRIGGER);
    assert.dom(CONTENT).doesNotExist('it closes once focus goes too');
  });

  test('focus leaving a hovered trigger leaves the content open', async function (assert) {
    await renderTooltip();

    await triggerEvent(TRIGGER, 'mouseenter');
    await focus(TRIGGER);
    await blur(TRIGGER);
    assert.dom(CONTENT).exists('hover still holds it open');

    await triggerEvent(TRIGGER, 'mouseleave');
    assert.dom(CONTENT).doesNotExist();
  });

  test('@disabled suppresses hover and focus alike', async function (assert) {
    await renderTooltip(true);

    await triggerEvent(TRIGGER, 'mouseenter');
    assert.dom(CONTENT).doesNotExist('not on hover');

    await focus(TRIGGER);
    assert.dom(CONTENT).doesNotExist('not on focus');
  });
});
