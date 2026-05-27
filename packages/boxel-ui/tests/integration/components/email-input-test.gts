import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { fillIn, render, triggerEvent, typeIn } from '@ember/test-helpers';

import { EmailInput } from '@cardstack/boxel-ui/components';
import type { EmailFormatValidationError } from '@cardstack/boxel-ui/helpers/validate-email-format';

type Validation = EmailFormatValidationError | null | undefined;

module('Integration | Component | email-input', function (hooks) {
  setupRenderingTest(hooks);

  test('it delays invalid state until blur', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(
      <template><EmailInput @value={{value}} @onChange={{set}} /></template>,
    );

    await typeIn('[data-test-boxel-email-input]', 'user@example');

    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'initial');
    assert.strictEqual(value, 'user@example', 'value is updated');

    await triggerEvent('[data-test-boxel-email-input]', 'blur');

    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'invalid');

    await typeIn('[data-test-boxel-email-input]', '.com');

    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'valid');
    assert.strictEqual(value, 'user@example.com');
  });

  test('it respects external value changes and accepts addresses with pluses and subdomains', async function (assert) {
    let value: string | null = 'first.last+tag@sub.domain.co';
    const set = (newValue: string) => (value = newValue);

    await render(
      <template><EmailInput @value={{value}} @onChange={{set}} /></template>,
    );

    assert
      .dom('[data-test-boxel-email-input]')
      .hasValue('first.last+tag@sub.domain.co');
    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'valid');
  });

  test('it validates external value on render', async function (assert) {
    let value: string | null = 'alice@';
    const set = (newValue: string) => (value = newValue);

    await render(
      <template><EmailInput @value={{value}} @onChange={{set}} /></template>,
    );

    assert.dom('[data-test-boxel-email-input]').hasValue('alice@');
    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'invalid');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Enter a domain after "@"');
    assert.strictEqual(value, 'alice@', 'no change was made');
  });

  test('it shows a descriptive validation message when invalid on blur', async function (assert) {
    let value: string | null = 'alice@email.com';
    let validation: Validation;
    let event: Event | undefined;
    const set = (
      newValue: string | null,
      _validation: EmailFormatValidationError | null,
      _event: Event,
    ) => {
      value = newValue;
      validation = _validation;
      event = _event;
    };

    await render(
      <template><EmailInput @value={{value}} @onChange={{set}} /></template>,
    );

    await fillIn('[data-test-boxel-email-input]', 'alice@email');
    await triggerEvent('[data-test-boxel-email-input]', 'blur');

    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Domain must include a period, like "example.com"');
    assert.strictEqual(value, 'alice@email', 'value is updated');
    assert.strictEqual(
      validation?.code,
      'domain-missing-period',
      'validation error code passed to onChange',
    );
    assert.strictEqual(
      validation?.message,
      'Domain must include a period, like "example.com"',
      'validation message passed to onChange',
    );
    assert.ok(event, 'event is passed to onChange');
  });

  test('it allows clearing an optional email input without showing an error', async function (assert) {
    let value: string | null = 'alice@email.com';
    let validation: Validation;
    let event: Event | undefined;
    const set = (
      newValue: string | null,
      _validation: EmailFormatValidationError | null,
      _event: Event,
    ) => {
      value = newValue;
      validation = _validation;
      event = _event;
    };

    await render(
      <template><EmailInput @value={{value}} @onChange={{set}} /></template>,
    );

    await fillIn('[data-test-boxel-email-input]', '');
    await triggerEvent('[data-test-boxel-email-input]', 'blur');

    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'initial');
    assert.dom('[data-test-boxel-input-error-message]').doesNotExist();
    assert.strictEqual(value, '', 'value cleared when input emptied');
    assert.strictEqual(
      validation,
      null,
      'clearing optional input passes null validation',
    );
    assert.ok(event, 'event is passed to onChange');
  });

  test('it requires a value when marked as required', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(
      <template>
        <EmailInput @value={{value}} @onChange={{set}} required />
      </template>,
    );

    await triggerEvent('[data-test-boxel-email-input]', 'blur');

    assert
      .dom('[data-test-boxel-email-input]')
      .hasAttribute('data-test-boxel-input-validation-state', 'invalid');
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Enter an email address');
    assert.strictEqual(value, '', 'value is updated');
  });
});
