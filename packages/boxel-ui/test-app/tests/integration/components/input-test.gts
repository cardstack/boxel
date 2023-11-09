import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { fillIn, render } from '@ember/test-helpers';
import { BoxelInput as Input } from '@cardstack/boxel-ui/components';

module('Integration | Component | input', function (hooks) {
  setupRenderingTest(hooks);

  test('it passes through the value', async function (assert) {
    await render(<template><Input data-test-input @value='hello' /></template>);

    assert.dom('[data-test-input]').hasValue('hello');
  });

  test('it returns values through onInput', async function (assert) {
    let value = 'yes';

    function onInput(newValue: string) {
      value = newValue;
    }

    await render(<template>
      <Input data-test-input @onInput={{onInput}} />
    </template>);
    await fillIn('[data-test-input]', 'no');

    assert.strictEqual(value, 'no');
  });

  test('textarea @type produces a textarea', async function (assert) {
    await render(<template>
      <Input data-test-input @type='textarea' />
    </template>);

    assert.dom('[data-test-input]').hasTagName('textarea');
  });

  test('other @type passes through', async function (assert) {
    await render(<template><Input data-test-input @type='number' /></template>);

    assert.dom('[data-test-input]').hasAttribute('type', 'number');
  });
});
