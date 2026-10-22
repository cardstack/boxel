// Pretui — CompoundField unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CompoundField } from './compound-field';
import type { FormIssue } from '../internal/forms-core';

const ON_COMPOUND: FormIssue = { targetPath: 'Billing Address', severity: 'error', message: 'Address is incomplete.' };
const ON_SUBFIELD: FormIssue = { targetPath: 'Billing Address.City', severity: 'error', message: 'City is required.' };

function compound(): HTMLElement {
  return document.querySelector('[data-test-pretui-compound-field]') as HTMLElement;
}
function section(): HTMLFieldSetElement {
  return compound().querySelector('[data-test-pretui-form-section]') as HTMLFieldSetElement;
}

module('Pretui | components/compound-field', function (hooks) {
  setupCardTest(hooks);

  test('renders a real fieldset whose legend is the label, addressable by that label', async function (assert) {
    await render(
      <template>
        <CompoundField @label='Billing Address' as |C|>
          <C.Row><input aria-label='Street' data-test-street /><input aria-label='City' data-test-city /></C.Row>
        </CompoundField>
      </template>,
    );
    assert.strictEqual(compound().getAttribute('data-test-pretui-compound-field'), 'Billing Address');
    assert.strictEqual(section().tagName, 'FIELDSET');
    assert.strictEqual(section().querySelector('legend')?.textContent?.trim(), 'Billing Address');
    assert.strictEqual(compound().dataset['variant'], 'default');
    assert.strictEqual(compound().dataset['span'], 'auto');
    assert.ok(compound().querySelector('[data-test-pretui-compound-row] [data-test-street]'), 'the Row is the yielded layout');
  });

  test('keeps the hint visible and wired to the fieldset — a tooltip does not exist on touch', async function (assert) {
    await render(<template><CompoundField @label='Billing Address' @hint='Where invoices go.'>body</CompoundField></template>);
    let id = section().getAttribute('aria-describedby') as string;
    assert.strictEqual(document.getElementById(id)?.textContent?.trim(), 'Where invoices go.');
  });

  test('reflects the address variant and a full span', async function (assert) {
    await render(<template><CompoundField @label='Billing Address' @variant='address' @span='full'>body</CompoundField></template>);
    assert.strictEqual(compound().dataset['variant'], 'address');
    assert.strictEqual(compound().dataset['span'], 'full');
  });

  test('is collapsible through FormSection, reporting each move', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(
      <template><CompoundField @label='Billing Address' @collapsible={{true}} @onOpenChange={{record}}>body</CompoundField></template>,
    );
    let toggle = section().querySelector('.pretui-formsection-toggle') as HTMLButtonElement;
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    await click(toggle);
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(seen, [false]);
  });

  test('disables the whole group natively', async function (assert) {
    await render(
      <template>
        <CompoundField @label='Billing Address' @disabled={{true}} as |C|>
          <C.Row><input aria-label='Street' data-test-street /></C.Row>
        </CompoundField>
      </template>,
    );
    assert.true(section().disabled);
    assert.true((document.querySelector('[data-test-street]') as HTMLInputElement).matches(':disabled'));
  });

  test('a Row takes a validated track list as a custom property, and drops an unsafe one whole', async function (assert) {
    await render(
      <template>
        <CompoundField @label='Billing Address' as |C|>
          <C.Row @columns='2fr 1fr 1fr'>a</C.Row>
          <C.Row @columns='1fr; background: url(javascript:0)'>b</C.Row>
          <C.Row>c</C.Row>
        </CompoundField>
      </template>,
    );
    let rows = Array.from(compound().querySelectorAll('[data-test-pretui-compound-row]')) as HTMLElement[];
    assert.true(rows[0]?.getAttribute('style')?.includes('2fr 1fr 1fr'), 'a real track list travels');
    assert.notOk((rows[1]?.getAttribute('style') ?? '').includes('javascript'), 'the injection never reaches the DOM');
    assert.notOk((rows[1]?.getAttribute('style') ?? '').includes('1fr'), 'dropped whole — never stripped and half-used');
    assert.strictEqual(rows[2]?.getAttribute('style'), null, 'omitted, the stylesheet auto-fit ladder paints');
  });

  test('keeps a sub-field issue off the group — it belongs to the City field', async function (assert) {
    const ISSUES: FormIssue[] = [ON_SUBFIELD];
    await render(
      <template>
        <CompoundField @label='Billing Address' @path='Billing Address' @issues={{ISSUES}}>body</CompoundField>
      </template>,
    );
    assert.notOk(section().textContent?.includes('City is required.'));
    assert.strictEqual(section().querySelector('.pretui-formsection-badge'), null);
  });

  test('an issue aimed at the compound itself renders on the compound', async function (assert) {
    const ISSUES: FormIssue[] = [ON_COMPOUND];
    await render(
      <template>
        <CompoundField @label='Billing Address' @path='Billing Address' @issues={{ISSUES}}>body</CompoundField>
      </template>,
    );
    assert.ok(section().querySelector('.pretui-formsection-badge'), 'the legend counts it');
    assert.true(section().textContent?.includes('Address is incomplete.'), 'and the message is shown');
  });
});
