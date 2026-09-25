// Pretui — EmailInput unit tests. Imports from ./extras; when EmailInput moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, fillIn, blur } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { EmailInput } from './extras';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function field(wrapper: string): HTMLInputElement {
  return q(`${wrapper} input`) as HTMLInputElement;
}

module('Pretui | components/email-input', function (hooks) {
  setupCardTest(hooks);

  test('EmailInput renders the wrapped control and passes the caller id through for label wiring', async function (assert) {
    await render(<template><EmailInput @value='mei@wuyi.test' @controlId='email' @placeholder='you@example.com' /></template>);
    let input = field('[data-test-pretui-email-input]');
    assert.strictEqual(input.id, 'email');
    assert.strictEqual(input.value, 'mei@wuyi.test');
    assert.strictEqual(input.placeholder, 'you@example.com');
  });

  test('EmailInput splits boxel-ui three-arg onChange into a value and a validation report', async function (assert) {
    let values: string[] = [];
    let errors: (string | null)[] = [];
    const onInput = (v: string) => values.push(v);
    const onValidation = (e: string | null) => errors.push(e);
    await render(<template><EmailInput @onInput={{onInput}} @onValidation={{onValidation}} /></template>);

    await fillIn(field('[data-test-pretui-email-input]'), 'mei@wuyi.test');
    await blur(field('[data-test-pretui-email-input]'));
    assert.deepEqual(values.at(-1), 'mei@wuyi.test', 'the value arrives on its own channel');
    assert.deepEqual(errors.at(-1), null, 'and a good address reports no error');
  });

  test('EmailInput reports the format error for a bad address', async function (assert) {
    let errors: (string | null)[] = [];
    const onValidation = (e: string | null) => errors.push(e);
    await render(<template><EmailInput @onValidation={{onValidation}} /></template>);
    await fillIn(field('[data-test-pretui-email-input]'), 'not-an-address');
    await blur(field('[data-test-pretui-email-input]'));
    assert.strictEqual(errors.at(-1), 'Email must include an "@" symbol', 'the message text, not a validation object');
  });

  test('EmailInput accepts the boolean arg aliases', async function (assert) {
    await render(<template><EmailInput @isDisabled={{true}} @isRequired={{true}} /></template>);
    let input = field('[data-test-pretui-email-input]');
    assert.true(input.disabled);
    assert.true(input.required);
  });
});
