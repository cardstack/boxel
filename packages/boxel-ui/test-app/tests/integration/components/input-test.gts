import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  click,
  fillIn,
  find,
  render,
  settled,
  typeIn,
} from '@ember/test-helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';

module('Integration | Component | input', function (hooks) {
  setupRenderingTest(hooks);

  test('it passes through the value and does not render missing optional properties', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @value='hello' />
    </template>);

    assert.dom('[data-test-input]').hasValue('hello');
    assert.dom('[data-test-input]').doesNotHaveAttribute('type');

    assert.dom('[data-test-boxel-input-helper-text]').doesNotExist();
    assert.dom('[aria-describedBy]').doesNotExist();

    assert.dom('[placeholder]').doesNotExist();
  });

  test('it returns values through onInput', async function (assert) {
    let value = 'yes';

    function onInput(newValue: string) {
      value = newValue;
    }

    await render(<template>
      <BoxelInput data-test-input @onInput={{onInput}} />
    </template>);
    await fillIn('[data-test-input]', 'no');

    assert.strictEqual(value, 'no');
  });

  test('it passes focus, blur, and keyPress events', async function (assert) {
    let focused = false;
    let blurred = false;
    let keyPressed = false;

    function onFocus() {
      focused = true;
    }

    function onBlur() {
      blurred = true;
    }

    function onKeyPress() {
      keyPressed = true;
    }

    await render(<template>
      <button>do nothing</button>
      <BoxelInput
        data-test-input
        @onFocus={{onFocus}}
        @onBlur={{onBlur}}
        @onKeyPress={{onKeyPress}}
      />
    </template>);

    await click('[data-test-input]');
    await click('button');
    await typeIn('[data-test-input]', 'key');

    assert.true(focused);
    assert.true(blurred);
    assert.true(keyPressed);
  });

  test('textarea @type produces a textarea', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @type='textarea' />
    </template>);

    assert.dom('[data-test-input]').hasTagName('textarea');
    assert.dom('[data-test-input]').doesNotHaveAttribute('type');
  });

  test('other @type passes through', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @type='number' />
    </template>);

    assert.dom('[data-test-input]').hasAttribute('type', 'number');
  });

  test('@helperText shows', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @helperText='help!' />
    </template>);

    let helperElementId = find('[data-test-boxel-input-helper-text]')?.id;

    assert.dom('*:has([data-test-input])').containsText('help!');
    assert
      .dom('[data-test-input]')
      .hasAttribute('aria-describedBy', helperElementId!);
  });

  test('@placeholder shows', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @placeholder='a placeholder' />
    </template>);

    assert.dom('[placeholder]').hasAttribute('placeholder', 'a placeholder');
  });

  test('it indicates @optional status but @required takes priority', async function (assert) {
    await render(<template>
      <BoxelInput data-test-optional-input @optional={{true}} />
      <BoxelInput
        data-test-required-input
        @required={{true}}
        @optional={{true}}
      />
    </template>);

    assert.dom('*:has([data-test-optional-input])').containsText('Optional');

    assert
      .dom('*:has([data-test-required-input])')
      .doesNotContainText('Optional');
    assert.dom('[data-test-required-input]').hasAttribute('required');
  });

  test('it shows validation states but not when disabled and not when no error message', async function (assert) {
    class StateObject {
      @tracked errorMessage: string | undefined = 'an error';
      @tracked state = 'none';
      @tracked disabled = false;
    }

    let stateObject = new StateObject();

    await render(<template>
      <BoxelInput
        data-test-input
        @state={{stateObject.state}}
        @disabled={{stateObject.disabled}}
        @errorMessage={{stateObject.errorMessage}}
      />
    </template>);

    assert.dom('[data-test-boxel-input-error-message]').doesNotExist();
    assert.dom('[data-test-boxel-input-validation-state="none"]').exists();
    assert.dom('[aria-invalid]').doesNotExist();

    stateObject.state = 'initial';
    await settled();

    assert.dom('[data-test-boxel-input-validation-state="initial"]').exists();

    stateObject.state = 'invalid';
    await settled();

    assert.dom('[data-test-boxel-input-validation-state="invalid"]').exists();
    assert
      .dom('[data-test-boxel-input-error-message]')
      .containsText('an error');
    assert.dom('[aria-invalid]').exists();

    let errorElementId = find('[data-test-boxel-input-error-message]')?.id;
    assert.ok(errorElementId, 'error element should exist');
    assert
      .dom('[data-test-input]')
      .hasAttribute('aria-errormessage', errorElementId!);

    stateObject.errorMessage = undefined;
    await settled();

    assert.dom('[data-test-boxel-input-error-message]').doesNotExist();

    stateObject.errorMessage = 'error again';
    await settled();

    stateObject.state = 'loading';
    await settled();

    assert.dom('[data-test-boxel-input-validation-state="loading"]').exists();
    assert.dom('[aria-invalid]').doesNotExist();

    stateObject.state = 'valid';
    await settled();

    assert.dom('[data-test-boxel-input-validation-state="valid"]').exists();

    stateObject.disabled = true;
    await settled();

    assert.dom('[data-test-input]').hasAttribute('disabled');
    assert
      .dom('[data-test-input]')
      .hasNoAttribute('data-test-boxel-input-validation-state');
  });
});
