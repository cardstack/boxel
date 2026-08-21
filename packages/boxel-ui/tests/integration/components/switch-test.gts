import { Switch } from '@cardstack/boxel-ui/components';
import { click, render, settled, triggerKeyEvent } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers';

const SWITCH = '[data-test-switch-checked]';
const INPUT = '[data-test-switch-checked] input';

// triggerKeyEvent's modifiers do not include `repeat`, so the auto-repeat
// keydown a held key produces has to be dispatched directly.
async function pressEnter(repeat = false) {
  let input = document.querySelector(INPUT);
  if (!input) {
    throw new Error(`expected to find ${INPUT}`);
  }
  let event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    repeat,
  });
  input.dispatchEvent(event);
  await settled();
  return event;
}

class SwitchState {
  @tracked isEnabled = false;
  calls: boolean[] = [];

  // Applies what the switch asks for, the way a normal caller would.
  accept = (isEnabled: boolean) => {
    this.calls.push(isEnabled);
    this.isEnabled = isEnabled;
  };

  // Records the request and drops it, leaving @isEnabled where it was.
  ignore = (isEnabled: boolean) => {
    this.calls.push(isEnabled);
  };
}

module('Integration | Component | switch', function (hooks) {
  setupRenderingTest(hooks);

  test('Space activation routes through click alone', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
        />
      </template>,
    );

    // The browser turns a Space press on a checkbox into a click, which
    // test helpers do not synthesize — so drive the two halves separately.
    // A keypress binding alongside the click one is what made Space fire
    // twice; if any returns, the count here goes to 2.
    await triggerKeyEvent(INPUT, 'keypress', ' ');
    assert.deepEqual(state.calls, [], 'keypress alone does not toggle');

    await click(INPUT);
    assert.deepEqual(state.calls, [true], 'one onChange call for one press');
    assert.dom(SWITCH).hasAttribute('data-test-switch-checked', 'on');
  });

  test('Enter toggles once and ignores auto-repeat', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
        />
      </template>,
    );

    await pressEnter();
    assert.deepEqual(state.calls, [true], 'the first keydown toggles');

    // Held keys repeat keydown; without the repeat guard each one would call
    // @onChange, which for a realm-backed switch is a burst of writes.
    for (let i = 0; i < 3; i++) {
      await pressEnter(true);
    }
    assert.deepEqual(state.calls, [true], 'repeats are ignored');

    await triggerKeyEvent(INPUT, 'keyup', 'Enter');
    await pressEnter();
    assert.deepEqual(state.calls, [true, false], 'a fresh press toggles again');
  });

  test('stays on @isEnabled when onChange drops the value', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.ignore}}
        />
      </template>,
    );

    await click(INPUT);

    assert.deepEqual(state.calls, [true], 'the switch requested the change');
    // The native checkbox would have flipped itself here, leaving the DOM
    // state — and the aria-checked derived from it — disagreeing with
    // @isEnabled.
    assert.dom(INPUT).isNotChecked();
    assert.dom(SWITCH).hasAttribute('data-test-switch-checked', 'off');
  });

  test('a disabled switch does not report changes', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
          @disabled={{true}}
        />
      </template>,
    );

    // Clicking the label is the only route left: a disabled input takes
    // neither pointer nor keyboard events, and the test helpers refuse to
    // fake them.
    await click(SWITCH);

    assert.deepEqual(state.calls, [], 'no onChange calls');
  });

  test('every Enter keydown is prevented, auto-repeat included', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
        />
      </template>,
    );

    assert.true((await pressEnter()).defaultPrevented, 'the first press');
    // A repeat that reaches the UA unprevented is an implicit submit for
    // any switch inside a form — every card edit template. Asserted on the
    // event because a synthetic keydown never submits a form on its own.
    for (let i = 0; i < 3; i++) {
      assert.true((await pressEnter(true)).defaultPrevented, `repeat ${i}`);
    }

    assert.deepEqual(state.calls, [true], 'still one toggle for one press');
  });

  test('names the control from @label or a visible label block', async function (assert) {
    let state = new SwitchState();
    await render(
      <template>
        <Switch
          @label='Notifications'
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
          data-test-hidden-label
        />
        <Switch
          @isEnabled={{state.isEnabled}}
          @onChange={{state.accept}}
          data-test-visible-label
        >Email notifications</Switch>
      </template>,
    );

    assert
      .dom('[data-test-hidden-label] .boxel-sr-only')
      .hasText('Notifications');
    assert
      .dom('[data-test-visible-label] .switch-label')
      .hasText('Email notifications');
    // The block is the label element's own text, so it names the input
    // without a second labeling mechanism.
    assert.dom('[data-test-visible-label] .boxel-sr-only').doesNotExist();
  });
});
