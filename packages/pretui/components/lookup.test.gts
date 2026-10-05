// Pretui — Lookup unit tests. Lookup wraps power-select through boxel-ui's
// BoxelMultiSelectBasic; the engine's own behaviour (filtering, result count,
// dismissal) is that package's to prove. Asserted here is the WRAPPER's
// contract: state reflection, the accessible name, the selection callback
// speaking in records, and the polite announcement of selection changes.
//
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Lookup } from './lookup';
import type { PickerRecord } from '../internal/forms-picker';

const RECORDS: PickerRecord[] = [
  { id: 'acc-1', label: 'Wuyi Origins', meta: 'Fujian' },
  { id: 'acc-2', label: 'Anxi Cooperative', meta: 'Fujian' },
  { id: 'acc-3', label: 'Fuding Estate', meta: 'Fujian' },
];

function lookup(): HTMLElement {
  return document.querySelector('[data-test-pretui-lookup]') as HTMLElement;
}
function trigger(): HTMLElement {
  return lookup().querySelector('.pretui-pickertrigger') as HTMLElement;
}
function options(): HTMLElement[] {
  return Array.from(lookup().querySelectorAll('.ember-power-select-option')) as HTMLElement[];
}
function live(): string | undefined {
  return document.querySelector('[data-test-pretui-lookup-live]')?.textContent?.trim();
}

module('Pretui | components/lookup', function (hooks) {
  setupCardTest(hooks);

  test('renders a named combobox trigger with a polite live region beside it', async function (assert) {
    await render(<template><Lookup @records={{RECORDS}} @label='Account' /></template>);
    assert.ok(trigger());
    let combobox = lookup().querySelector('[role="combobox"]') as HTMLElement;
    assert.strictEqual(combobox?.getAttribute('aria-label'), 'Account', 'the combobox itself carries the name');
    let region = document.querySelector('[data-test-pretui-lookup-live]') as HTMLElement;
    assert.strictEqual(region.getAttribute('role'), 'status');
    assert.strictEqual(region.getAttribute('aria-live'), 'polite');
    assert.strictEqual(lookup().dataset['disabled'], undefined);
    assert.strictEqual(lookup().dataset['invalid'], undefined);
  });

  test('lists the records and reports a pick as records, closing for single-select', async function (assert) {
    let seen: PickerRecord[][] = [];
    const onSelection = (r: PickerRecord[]) => seen.push([...r]);
    await render(<template><Lookup @records={{RECORDS}} @label='Account' @onSelectionChange={{onSelection}} /></template>);
    await click(trigger());
    assert.strictEqual(options().length, 3);
    assert.true(options()[0]?.textContent?.includes('Wuyi Origins'));

    await click(options()[1] as HTMLElement);
    assert.deepEqual(
      seen.map((sel) => sel.map((r) => r.id)),
      [['acc-2']],
      'the full selection, as records (decorated with the engine\'s search key, so compared by id)',
    );
    assert.strictEqual(options().length, 0, 'single-select closes on pick');
    assert.true((live() ?? '').length > 0, 'the selection change is announced — the engine does not cover that');
  });

  test('replaces rather than accumulates in single-select', async function (assert) {
    let seen: PickerRecord[][] = [];
    const onSelection = (r: PickerRecord[]) => seen.push([...r]);
    await render(<template><Lookup @records={{RECORDS}} @label='Account' @onSelectionChange={{onSelection}} /></template>);
    await click(trigger());
    await click(options()[0] as HTMLElement);
    await click(trigger());
    await click(options()[2] as HTMLElement);
    assert.deepEqual(seen.at(-1)?.map((r) => r.id), ['acc-3'], 'a second pick replaces the first — no ✕ first');
  });

  test('accumulates and stays open in multi-select', async function (assert) {
    let seen: PickerRecord[][] = [];
    const onSelection = (r: PickerRecord[]) => seen.push([...r]);
    await render(<template><Lookup @records={{RECORDS}} @label='Accounts' @multiple={{true}} @onSelectionChange={{onSelection}} /></template>);
    await click(trigger());
    await click(options()[0] as HTMLElement);
    assert.true(options().length > 0, 'still open');
    await click(options()[1] as HTMLElement);
    assert.deepEqual(seen.at(-1)?.map((r) => r.id), ['acc-1', 'acc-2']);
  });

  test('seeds from @defaultSelected and shows the record on the trigger', async function (assert) {
    const START: PickerRecord[] = [RECORDS[2] as PickerRecord];
    await render(<template><Lookup @records={{RECORDS}} @label='Account' @defaultSelected={{START}} /></template>);
    assert.true(trigger().textContent?.includes('Fuding Estate'));
  });

  test('reflects loading, invalid and disabled', async function (assert) {
    await render(<template><Lookup @records={{RECORDS}} @label='Account' @loading={{true}} @invalid={{true}} /></template>);
    assert.strictEqual(lookup().dataset['loading'], 'true');
    assert.ok(lookup().querySelector('.pretui-picker-busy [data-test-pretui-spinner]'), 'the trigger affix spins');
    assert.strictEqual(lookup().dataset['invalid'], 'true');
    assert.strictEqual(trigger().getAttribute('aria-invalid'), 'true');

    await render(<template><Lookup @records={{RECORDS}} @label='Account' @disabled={{true}} /></template>);
    assert.strictEqual(lookup().dataset['disabled'], 'true');
    assert.strictEqual(trigger().getAttribute('aria-disabled'), 'true');
  });
});
