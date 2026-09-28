// Pretui — DateRangePicker unit tests. Imports from ../reading-extras; when
// DateRangePicker moves to its own file only the import path changes. The
// range grid is Calendar's contract (calendar.test.gts); asserted here is the
// trigger, the two-click round-trip and when the popover closes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DateRangePicker } from './date-range-picker';
import type { DateRangeValue } from './calendar';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-date-range-picker]') as HTMLElement;
}
function trigger(): HTMLInputElement {
  let el = root().querySelector('.pretui-daterange-trigger') as HTMLElement;
  return (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement;
}
function calendar(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-calendar]');
}
function day(n: number): HTMLButtonElement {
  return Array.from(calendar()!.querySelectorAll('.pretui-cal-panel:first-child .pretui-cal-day:not([data-outside])')).find(
    (b) => b.textContent?.trim() === String(n),
  ) as HTMLButtonElement;
}

module('Pretui | components/date-range-picker', function (hooks) {
  setupCardTest(hooks);

  test('is a read-only input showing two months by default', async function (assert) {
    await render(<template><DateRangePicker /></template>);
    assert.true(trigger().readOnly);
    assert.strictEqual(trigger().placeholder, 'Select date range');
    assert.strictEqual(root().dataset['months'], '2');
    assert.strictEqual(calendar(), null);
    await click(trigger());
    assert.strictEqual(calendar()?.querySelectorAll('.pretui-cal-panel').length, 2);
  });

  test('stays open after the first click and closes once the range is complete', async function (assert) {
    let seen: { start: string | null; end: string | null }[] = [];
    const record = (r: { start: string | null; end: string | null }) => seen.push(r);
    const SEED: DateRangeValue = { start: '2026-03-01', end: '2026-03-02' };
    await render(<template><DateRangePicker @defaultValue={{SEED}} @onValueChange={{record}} /></template>);
    assert.true(trigger().value.includes('–'), 'a complete range shows both ends');

    await click(trigger());
    await click(day(10));
    assert.deepEqual(seen, [{ start: '2026-03-10', end: null }]);
    assert.ok(calendar(), 'half a range keeps the popover open');
    assert.true(trigger().value.endsWith('…'), 'the display shows the open end');

    await click(day(20));
    assert.deepEqual(seen[1], { start: '2026-03-10', end: '2026-03-20' });
    assert.strictEqual(calendar(), null, 'the completed range closes it');
    assert.true(trigger().value.includes('–'));
  });

  test('a controlled value holds the display still and reports the request', async function (assert) {
    let seen: { start: string | null; end: string | null }[] = [];
    const record = (r: { start: string | null; end: string | null }) => seen.push(r);
    const HELD: DateRangeValue = { start: '2026-03-01', end: '2026-03-02' };
    await render(<template><DateRangePicker @value={{HELD}} @onValueChange={{record}} /></template>);
    let before = trigger().value;
    await click(trigger());
    await click(day(10));
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(trigger().value, before, 'the owner decides');
  });

  test('takes a month count and a disabled state', async function (assert) {
    await render(<template><DateRangePicker @months={{1}} @disabled={{true}} /></template>);
    assert.strictEqual(root().dataset['months'], '1');
    assert.true(trigger().disabled);
  });
});
