// Pretui — input-family proof for the boxel-ui rebuild: typing must reach
// @onInput, the @type arg must actually change the rendered control, the
// contextual accessory blocks must render and fire, and the Pretui Select
// (the freestyle knob control that drives every dropdown knob, including
// the InputGroup page's type knob) must fire onValueChange on option click.
import { module, test } from 'qunit';
import { on } from '@ember/modifier';
import { render, click, fillIn, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { InputGroup } from './components/input-group';
import { PasswordInput } from './components/password-input';
import { Select } from './components/select';

class IGState {
  @tracked type = 'text';
  @tracked last = '';
  setLast = (v: string) => (this.last = v);
}

function q(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

module('Pretui | input family on boxel-ui', function (hooks) {
  setupCardTest(hooks);

  test('InputGroup: typing fires @onInput; @type switches the control', async function (assert) {
    let state = new IGState();
    await render(<template>
      <InputGroup
        @type={{state.type}}
        @placeholder='Amount'
        @onInput={{state.setLast}}
      >
        <:start>$</:start>
        <:end>.00</:end>
      </InputGroup>
    </template>);

    let input = q(
      '[data-test-pretui-input-group] input.form-control',
    ) as HTMLInputElement;
    assert.ok(input, 'the built-in boxel control renders');
    assert.strictEqual(
      input.getAttribute('type') ?? 'text',
      'text',
      'default type is text',
    );

    await fillIn(input, '12.50');
    assert.strictEqual(state.last, '12.50', '@onInput received the typed value');

    state.type = 'password';
    await settled();
    input = q(
      '[data-test-pretui-input-group] input.form-control',
    ) as HTMLInputElement;
    assert.strictEqual(
      input.getAttribute('type'),
      'password',
      "@type='password' reaches the rendered input",
    );

    state.type = 'number';
    await settled();
    input = q(
      '[data-test-pretui-input-group] input.form-control',
    ) as HTMLInputElement;
    assert.strictEqual(
      input.getAttribute('type'),
      'number',
      "@type='number' reaches the rendered input",
    );

    let starts = document.querySelectorAll(
      '[data-test-pretui-input-group] [data-test-boxel-input-group-text-accessory]',
    );
    assert.strictEqual(
      starts.length,
      2,
      '<:start>/<:end> plain content wraps into Text accessories',
    );
  });

  test('InputGroup: validation state + error row', async function (assert) {
    await render(<template>
      <InputGroup
        @state='invalid'
        @errorMessage='Bad amount'
        @placeholder='Amount'
      />
    </template>);
    assert.ok(
      q('[data-test-boxel-input-group-error-message]'),
      'error row renders while state=invalid',
    );
    assert.strictEqual(
      q('[data-test-boxel-input-group-error-message]')?.textContent?.trim(),
      'Bad amount',
      'error text flows through',
    );
  });

  test('InputGroup: legacy @invalid sugar still paints invalid', async function (assert) {
    await render(<template>
      <InputGroup @invalid={{true}} @errorMessage='Nope' />
    </template>);
    assert.ok(
      q('[data-test-boxel-input-group-validation-state="invalid"]'),
      '@invalid maps onto boxel state=invalid',
    );
  });

  test('InputGroup: accessory + default-block pass-through', async function (assert) {
    let state = new IGState();
    let clicks = 0;
    let bump = () => clicks++;
    await render(<template>
      <InputGroup @placeholder='Share link'>
        <:after as |Accessories|>
          <Accessories.Button {{on 'click' bump}}>Copy</Accessories.Button>
        </:after>
      </InputGroup>
      <InputGroup>
        <:default as |Controls Accessories group|>
          <Controls.Input
            id={{group.elementId}}
            @placeholder='Username'
            @onInput={{state.setLast}}
          />
          <Accessories.Text>@</Accessories.Text>
          <Controls.Input @placeholder='Server' />
        </:default>
      </InputGroup>
    </template>);

    let button = q('[data-test-boxel-input-group-button-accessory]');
    assert.ok(button, 'Button accessory renders through <:after>');
    await click(button as Element);
    assert.strictEqual(clicks, 1, 'accessory button click fires');

    let controls = document.querySelectorAll('input.form-control');
    assert.strictEqual(
      controls.length,
      3,
      'default block renders its own controls (1 built-in + 2 custom)',
    );
    await fillIn(controls[1] as Element, 'chris');
    assert.strictEqual(state.last, 'chris', 'Controls.Input @onInput fires');
  });

  test('Pretui Select (freestyle knob control) fires onValueChange', async function (assert) {
    let state = new IGState();
    let options = [
      { value: 'text', label: 'text' },
      { value: 'password', label: 'password' },
      { value: 'number', label: 'number' },
    ];
    await render(<template>
      <Select
        @options={{options}}
        @value={{state.type}}
        @onValueChange={{state.setLast}}
      />
    </template>);

    let trigger = q('[data-test-pretui-select] .ember-power-select-trigger');
    assert.ok(trigger, 'select trigger renders');
    await click(trigger as Element);
    let option = Array.from(
      document.querySelectorAll('li.ember-power-select-option'),
    ).find((li) => li.textContent?.includes('password'));
    assert.ok(option, 'options open in place');
    await click(option as Element);
    assert.strictEqual(
      state.last,
      'password',
      'onValueChange received the picked value',
    );
  });

  test('PasswordInput: reveal toggle flips the native type', async function (assert) {
    await render(<template><PasswordInput @value='hunter2' /></template>);
    let input = q(
      '[data-test-pretui-password-input] input',
    ) as HTMLInputElement;
    assert.strictEqual(input.getAttribute('type'), 'password', 'starts masked');
    await click('.pretui-reveal');
    input = q('[data-test-pretui-password-input] input') as HTMLInputElement;
    assert.strictEqual(input.getAttribute('type'), 'text', 'reveal shows text');
    await click('.pretui-reveal');
    input = q('[data-test-pretui-password-input] input') as HTMLInputElement;
    assert.strictEqual(input.getAttribute('type'), 'password', 'toggles back');
  });
});
