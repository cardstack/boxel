import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { click, fillIn, render } from '@ember/test-helpers';
import { BoxelInput } from '@cardstack/boxel-ui/components';

module('Integration | Component | input', function (hooks) {
  setupRenderingTest(hooks);

  test('it passes through the value', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @value='hello' />
    </template>);

    assert.dom('[data-test-input]').hasValue('hello');
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

  test('it passes focus and blur events', async function (assert) {
    let focused = false;
    let blurred = false;

    function onFocus() {
      focused = true;
    }

    function onBlur() {
      blurred = true;
    }

    await render(<template>
      <button>do nothing</button>
      <BoxelInput data-test-input @onFocus={{onFocus}} @onBlur={{onBlur}} />
    </template>);

    await click('[data-test-input]');
    await click('button');

    assert.true(focused);
    assert.true(blurred);
  });

  test('textarea @type produces a textarea', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @type='textarea' />
    </template>);

    assert.dom('[data-test-input]').hasTagName('textarea');
  });

  test('other @type passes through', async function (assert) {
    await render(<template>
      <BoxelInput data-test-input @type='number' />
    </template>);

    assert.dom('[data-test-input]').hasAttribute('type', 'number');
  });
});
