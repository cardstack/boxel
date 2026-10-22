// Pretui — Combobox unit tests. Combobox wraps power-select through boxel-ui;
// the engine's filtering and dismissal are that package's to prove. Asserted
// here is the wrapper's contract: a single value in and out, the accessible
// name, state reflection.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Combobox } from './combobox';
import type { ComboboxOption } from './combobox';

const TEAS: ComboboxOption[] = [
  { value: 'green', label: 'Green', meta: 'Unoxidised' },
  { value: 'oolong', label: 'Oolong', meta: 'Partially oxidised' },
  { value: 'puer', label: 'Pu-erh' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-combobox]') as HTMLElement;
}
function trigger(): HTMLElement {
  return root().querySelector('.pretui-pickertrigger') as HTMLElement;
}
function options(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.ember-power-select-option')) as HTMLElement[];
}

module('Pretui | components/combobox', function (hooks) {
  setupCardTest(hooks);

  test('renders a named trigger with the placeholder and no dropdown at rest', async function (assert) {
    await render(<template><Combobox @options={{TEAS}} @label='Tea' /></template>);
    assert.ok(trigger());
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Tea', 'the label sits on the trigger itself');
    assert.strictEqual(options().length, 0);
    assert.strictEqual(root().dataset['disabled'], undefined);
    assert.strictEqual(root().dataset['invalid'], undefined);
  });

  test('lists options with their meta line and reports a pick as a single value, closing', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><Combobox @options={{TEAS}} @label='Tea' @onValueChange={{record}} /></template>);
    await click(trigger());
    assert.strictEqual(options().length, 3);
    assert.true(options()[1]?.textContent?.includes('Partially oxidised'), 'the secondary line rides along');

    await click(options()[1] as HTMLElement);
    assert.deepEqual(seen, ['oolong'], 'a plain string, not an option object');
    assert.strictEqual(options().length, 0, 'closes on select');
    assert.true(trigger().textContent?.includes('Oolong'));
  });

  test('seeds from @defaultValue and replaces on a second pick', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><Combobox @options={{TEAS}} @defaultValue='green' @onValueChange={{record}} /></template>);
    assert.true(trigger().textContent?.includes('Green'));
    await click(trigger());
    await click(options()[2] as HTMLElement);
    assert.deepEqual(seen, ['puer']);
    assert.true(trigger().textContent?.includes('Pu-erh'));
    assert.false(trigger().textContent?.includes('Green'), 'one value at a time');
  });

  test('a controlled @value holds the trigger still and reports the request', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><Combobox @options={{TEAS}} @value='green' @onValueChange={{record}} /></template>);
    await click(trigger());
    await click(options()[1] as HTMLElement);
    assert.deepEqual(seen, ['oolong']);
    assert.true(trigger().textContent?.includes('Green'), 'the owner decides');
  });

  test('reflects invalid and disabled', async function (assert) {
    await render(<template><Combobox @options={{TEAS}} @invalid={{true}} /></template>);
    assert.strictEqual(root().dataset['invalid'], 'true');
    assert.strictEqual(trigger().getAttribute('aria-invalid'), 'true');

    await render(<template><Combobox @options={{TEAS}} @disabled={{true}} /></template>);
    assert.strictEqual(root().dataset['disabled'], 'true');
    assert.strictEqual(trigger().getAttribute('aria-disabled'), 'true');
  });
});
