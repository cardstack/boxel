import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { click, render, triggerEvent } from '@ember/test-helpers';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

const OPTIONS = ['Green', 'Oolong'];
const noop = () => {};

module('Integration | Component | select', function (hooks) {
  setupRenderingTest(hooks);

  test('choosing an option leaves focus on the trigger', async function (assert) {
    await render(
      <template>
        <BoxelSelect
          @options={{OPTIONS}}
          @onChange={{noop}}
          @renderInPlace={{true}}
          data-test-select
          as |option|
        >
          <span data-test-select-option>{{option}}</span>
        </BoxelSelect>
      </template>,
    );
    let trigger = document.querySelector('[data-test-select]') as HTMLElement;
    await click(trigger);
    let oolong = Array.from(
      document.querySelectorAll('[data-test-select-option]'),
    ).find((o) => o.textContent?.trim() === 'Oolong') as HTMLElement;
    // only the click, where the option is chosen; what a mousedown does to
    // focus is the caller's to manage
    await triggerEvent(oolong, 'click');
    assert.strictEqual(
      document.activeElement,
      trigger,
      'focus stays on the trigger, so a focus-out handler around the select does not read the pick as leaving',
    );
  });

  test("a caller's one-class rule overrides the disabled state", async function (assert) {
    // BoxelSelect's disabled rule out-specifies a single class, so the
    // caller wins only while that rule sits in a cascade layer
    let style = document.createElement('style');
    style.textContent = '.caller-select { background-color: rgb(1, 2, 3); }';
    document.head.append(style);
    try {
      await render(
        <template>
          <BoxelSelect
            @options={{OPTIONS}}
            @onChange={{noop}}
            @disabled={{true}}
            class='caller-select'
            data-test-select
            as |option|
          >
            {{option}}
          </BoxelSelect>
        </template>,
      );
      assert
        .dom('[data-test-select]')
        .hasStyle({ backgroundColor: 'rgb(1, 2, 3)' });
    } finally {
      style.remove();
    }
  });
});
