import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { fillIn, render, triggerEvent } from '@ember/test-helpers';

import { PhoneInput } from '@cardstack/boxel-ui/components';
import type {
  NormalizePhoneFormatResult,
  NormalizedPhoneNumberFormat,
  PhoneFormatValidationError,
} from '@cardstack/boxel-ui/helpers/validate-phone-format';

type Validation = NormalizePhoneFormatResult | null | undefined;

const phoneInput = '[data-test-boxel-phone-input]';

module('Integration | Component | phone-input', function (hooks) {
  setupRenderingTest(hooks);

  test('it formats valid numbers', async function (assert) {
    let value: string | null = null;
    let validation: Validation;
    let event: Event | undefined;

    const handleChange = (
      newValue: string | null,
      newValidation: Validation,
      ev: Event,
    ) => {
      value = newValue;
      validation = newValidation;
      event = ev;
    };

    await render(<template>
      <PhoneInput @value={{value}} @onChange={{handleChange}} />
    </template>);

    await fillIn(phoneInput, '2025550125');

    assert
      .dom(`${phoneInput}[data-test-boxel-input-validation-state='valid']`)
      .exists();

    let validationResult =
      validation?.ok && 'value' in validation
        ? (validation.value as NormalizedPhoneNumberFormat)
        : undefined;
    assert
      .dom(phoneInput)
      .hasValue(
        validationResult?.international,
        'display value formatted internationally',
      );
    assert.strictEqual(
      value,
      validationResult?.e164,
      'onChange receives e164 value',
    );
    assert.strictEqual(
      validationResult?.regionCode,
      'US',
      'validation reports detected region code',
    );
    assert.ok(event, 'onChange receives the originating event');
  });

  test('it surfaces validation errors after blur', async function (assert) {
    let value: string | null = null;
    let validation: Validation;

    const handleChange = (
      newValue: string | null,
      newValidation: Validation,
    ) => {
      value = newValue;
      validation = newValidation;
    };

    await render(<template>
      <PhoneInput @value={{value}} @onChange={{handleChange}} />
    </template>);

    await fillIn(phoneInput, '123');
    await triggerEvent(phoneInput, 'blur');

    assert
      .dom(`${phoneInput}[data-test-boxel-input-validation-state="invalid"]`)
      .exists();
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Phone number is too short');
    assert.strictEqual(
      value,
      '123',
      'onChange receives the sanitized input value',
    );
    assert.false(validation?.ok, 'validation result reports ok = false');
    let validationResult =
      validation && !validation.ok && 'error' in validation
        ? (validation.error as PhoneFormatValidationError)
        : undefined;
    assert.strictEqual(validationResult?.code, 'too-short');
    assert.strictEqual(
      validationResult?.message,
      'Phone number is too short',
      'validation error message is passed through',
    );
  });

  test('it allows clearing an optional input without showing an error', async function (assert) {
    let value: string | null = '+12025550125';
    let validation: Validation;

    const handleChange = (
      newValue: string | null,
      newValidation: Validation,
    ) => {
      value = newValue;
      validation = newValidation;
    };

    await render(<template>
      <PhoneInput @value={{value}} @onChange={{handleChange}} />
    </template>);

    await fillIn(phoneInput, '');
    await triggerEvent(phoneInput, 'blur');

    assert
      .dom(`${phoneInput}[data-test-boxel-input-validation-state="initial"]`)
      .exists();
    assert.dom('[data-test-boxel-input-error-message]').doesNotExist();
    assert.strictEqual(
      value,
      '',
      'onChange receives empty string when cleared',
    );
    assert.strictEqual(
      validation,
      null,
      'onChange receives null validation result',
    );
  });

  test('it requires a value when marked as required', async function (assert) {
    let value: string | null = null;
    const set = (newValue: string) => (value = newValue);

    await render(<template>
      <PhoneInput @value={{value}} @onChange={{set}} @required={{true}} />
    </template>);

    await triggerEvent(phoneInput, 'blur');

    assert
      .dom(`${phoneInput}[data-test-boxel-input-validation-state="invalid"]`)
      .exists();
    assert
      .dom('[data-test-boxel-input-error-message]')
      .hasText('Enter a phone number');
    assert.strictEqual(value, '', 'value is updated');
  });
});
