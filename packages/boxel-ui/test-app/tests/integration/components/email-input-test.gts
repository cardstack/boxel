import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import {
  fillIn,
  render,
  settled,
  triggerEvent,
  typeIn,
} from '@ember/test-helpers';

import { EmailInput } from '@cardstack/boxel-ui/components';

async function waitForDebounce() {
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  await settled();
}

module('Integration | Component | email-input', function (hooks) {
  setupRenderingTest(hooks);

  test('it delays invalid state until blur and only commits valid addresses', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <EmailInput @value={{value}} @onChange={{set}} />
    </template>);

    await typeIn('[data-test-boxel-input]', 'user@example');
    await waitForDebounce();

    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'initial');
    assert.strictEqual(value, null, 'value not committed while typing');

    await triggerEvent('[data-test-boxel-input]', 'blur');

    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'invalid');

    await typeIn('[data-test-boxel-input]', '.com');
    await waitForDebounce();

    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'valid');
    assert.strictEqual(value, 'user@example.com');
  });

  test('it respects external value changes and accepts addresses with pluses and subdomains', async function (assert) {
    let value: string | null = 'first.last+tag@sub.domain.co';
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <EmailInput @value={{value}} @onChange={{set}} />
    </template>);

    await waitForDebounce();

    assert
      .dom('[data-test-boxel-input]')
      .hasValue('first.last+tag@sub.domain.co');
    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'valid');
  });

  test('it surfaces native browser validation message when invalid on blur', async function (assert) {
    let value: string | null;
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <EmailInput @value={{value}} @onChange={{set}} />
    </template>);

    await typeIn('[data-test-boxel-input]', 'user@example');
    await waitForDebounce();
    await triggerEvent('[data-test-boxel-input]', 'blur');

    let inputElement = document.querySelector(
      '[data-test-boxel-input]',
    ) as HTMLInputElement;
    let expectedMessage =
      inputElement.validationMessage || 'Enter a valid email address';

    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText(expectedMessage);
  });

  test('it allows clearing an optional email input without showing an error', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <EmailInput @value={{value}} @onChange={{set}} />
    </template>);

    await typeIn('[data-test-boxel-input]', 'user@example.com');
    await waitForDebounce();
    await fillIn('[data-test-boxel-input]', '');
    await waitForDebounce();
    await triggerEvent('[data-test-boxel-input]', 'blur');

    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'initial');
    assert.dom('[data-test-boxel-input-error-message]').doesNotExist();
    assert.strictEqual(value, null, 'value cleared when input emptied');
  });

  test('it requires a value when marked as required', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <EmailInput @value={{value}} @onChange={{set}} @required={{true}} />
    </template>);

    await triggerEvent('[data-test-boxel-input]', 'blur');

    assert
      .dom('[data-test-boxel-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'invalid');

    let inputElement = document.querySelector(
      '[data-test-boxel-input]',
    ) as HTMLInputElement;
    let expectedMessage =
      inputElement.validationMessage || 'Enter a valid email address';

    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText(expectedMessage);
    assert.strictEqual(value, null, 'required empty input not committed');
  });
});
