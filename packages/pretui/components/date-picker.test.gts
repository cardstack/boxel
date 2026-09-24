// Pretui — DatePicker unit tests. Imports from ../reading-extras; when
// DatePicker moves to its own file only the import path changes. The grid
// itself is Calendar's contract (calendar.test.gts); asserted here is the
// trigger, the popover round-trip and the value it hands back.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DatePicker } from '../reading-extras';

function triggerEl(): HTMLElement {
  return document.querySelector('.pretui-datepicker-trigger') as HTMLElement;
}
function trigger(): HTMLInputElement {
  let el = triggerEl();
  return (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement;
}
function expanded(): string | null {
  return trigger().getAttribute('aria-expanded');
}
function calendar(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-calendar]');
}
function day(n: number): HTMLButtonElement {
  return Array.from(calendar()!.querySelectorAll('.pretui-cal-day:not([data-outside])')).find(
    (b) => b.textContent?.trim() === String(n),
  ) as HTMLButtonElement;
}

module('Pretui | components/date-picker', function (hooks) {
  setupCardTest(hooks);

  test('is a read-only input that opens a calendar dialog, closed at rest', async function (assert) {
    await render(<template><DatePicker /></template>);
    assert.true(trigger().readOnly, 'typed dates are not parsed — the calendar is the input');
    assert.strictEqual(trigger().value, '');
    assert.strictEqual(trigger().placeholder, 'Select date');
    assert.strictEqual(expanded(), 'false');
    assert.strictEqual(calendar(), null, 'the popover renders its content only while open');
  });

  test('opens on click, picks a day, reports the ISO string, shows it and closes', async function (assert) {
    let seen: string[] = [];
    const record = (iso: string) => seen.push(iso);
    await render(<template><DatePicker @defaultValue='2026-03-14' @onValueChange={{record}} /></template>);
    assert.true(trigger().value.length > 0, 'the seed is displayed');
    await click(trigger());
    assert.strictEqual(expanded(), 'true');
    assert.ok(calendar(), 'the calendar re-derives its view from the value on every open');

    await click(day(20));
    assert.deepEqual(seen, ['2026-03-20']);
    assert.strictEqual(calendar(), null, 'a pick closes the popover');
    assert.strictEqual(expanded(), 'false');
  });

  test('opens from the keyboard on ArrowDown', async function (assert) {
    await render(<template><DatePicker /></template>);
    await triggerKeyEvent(trigger(), 'keydown', 'ArrowDown');
    assert.ok(calendar());
  });

  test('a disabled picker cannot open: the trigger is a disabled input, which receives neither clicks nor keys', async function (assert) {
    await render(<template><DatePicker @disabled={{true}} /></template>);
    assert.true(trigger().disabled);
  });
});
