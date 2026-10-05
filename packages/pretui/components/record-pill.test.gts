// Pretui — RecordPill unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { RecordPill } from './record-pill';
import type { PickerRecord } from '../internal/forms-picker';

const WUYI: PickerRecord = { id: 'acc-1', label: 'Wuyi Origins', meta: 'Account · Fujian' };

function pill(): HTMLElement {
  return document.querySelector('[data-test-pretui-record-pill]') as HTMLElement;
}
function remove(): HTMLButtonElement | null {
  return pill().querySelector('.pretui-rpill-x') as HTMLButtonElement | null;
}

module('Pretui | components/record-pill', function (hooks) {
  setupCardTest(hooks);

  test('shows the record and a remove button named after it', async function (assert) {
    await render(<template><RecordPill @record={{WUYI}} /></template>);
    assert.strictEqual(pill().getAttribute('data-test-pretui-record-pill'), 'acc-1', 'addressable by record id');
    assert.true(pill().textContent?.includes('Wuyi Origins'));
    let x = remove() as HTMLButtonElement;
    assert.ok(x, 'removable by default');
    assert.strictEqual(x.getAttribute('aria-label'), 'Remove Wuyi Origins', 'a real, individually named button — not a ✕ inside role=option that AT never exposes');
    assert.strictEqual(x.getAttribute('title'), 'Remove Wuyi Origins');
  });

  test('reports the record, not an index, when removed', async function (assert) {
    let removed: PickerRecord[] = [];
    const onRemove = (r: PickerRecord) => removed.push(r);
    await render(<template><RecordPill @record={{WUYI}} @onRemove={{onRemove}} /></template>);
    await click(remove() as HTMLElement);
    assert.deepEqual(removed, [WUYI]);
  });

  test('drops the remove button when not removable, and when disabled', async function (assert) {
    await render(<template><RecordPill @record={{WUYI}} @removable={{false}} /></template>);
    assert.strictEqual(remove(), null);

    await render(<template><RecordPill @record={{WUYI}} @disabled={{true}} /></template>);
    assert.strictEqual(remove(), null, 'a disabled pill offers no way to change the selection');
    assert.strictEqual(pill().dataset['disabled'], 'true');
  });
});
