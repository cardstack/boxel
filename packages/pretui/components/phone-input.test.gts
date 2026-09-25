// Pretui — PhoneInput unit tests. Imports from ./extras; when PhoneInput moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PhoneInput } from './phone-input';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function field(wrapper: string): HTMLInputElement {
  return q(`${wrapper} input`) as HTMLInputElement;
}

module('Pretui | components/phone-input', function (hooks) {
  setupCardTest(hooks);

  test('PhoneInput renders the wrapped control and reports the sanitized value', async function (assert) {
    let values: string[] = [];
    const onInput = (v: string) => values.push(v);
    await render(<template><PhoneInput @controlId='phone' @onInput={{onInput}} /></template>);
    let input = field('[data-test-pretui-phone-input]');
    assert.strictEqual(input.id, 'phone');

    await fillIn(input, '2025550123');
    assert.strictEqual(values.at(-1), '+12025550123', 'the E.164 string reaches @onInput, not a result object');
  });

  test('PhoneInput accepts the boolean arg aliases', async function (assert) {
    await render(<template><PhoneInput @isDisabled={{true}} /></template>);
    assert.true(field('[data-test-pretui-phone-input]').disabled);
  });
});
