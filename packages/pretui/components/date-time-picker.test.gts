// Pretui — DateTimePicker unit tests: one popover, a draft that commits as a
// single ISO datetime on Done, and Done refusing a half-filled value.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, settled, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DateTimePicker } from './date-time-picker';

const TRIGGER = '[data-test-pretui-date-time-trigger]';
const DONE = '[data-test-pretui-date-time-done]';

function trigger(): HTMLButtonElement {
  return document.querySelector(TRIGGER) as HTMLButtonElement;
}
/** The in-month day buttons of the open calendar. */
function days(): HTMLButtonElement[] {
  return [...document.querySelectorAll('.pretui-cal-day:not([data-outside])')] as HTMLButtonElement[];
}
/** Step each empty time segment once: TimeInput seeds an empty segment from its minimum, so this sets 00:00. */
async function fillTime() {
  // re-queried each time: a keypress can re-render the segments
  let count = document.querySelectorAll('[data-test-pretui-time-input] [role="spinbutton"]').length;
  for (let i = 0; i < count; i++) {
    let seg = document.querySelectorAll('[data-test-pretui-time-input] [role="spinbutton"]')[i] as HTMLElement;
    await triggerKeyEvent(seg, 'keydown', 'ArrowUp');
  }
}

module('Pretui | components/date-time-picker', function (hooks) {
  setupCardTest(hooks);

  test('the trigger names the field and opens one popover holding the calendar and the time', async function (assert) {
    await render(<template><DateTimePicker @label='Roast starts' data-field='roast' /></template>);
    assert.strictEqual((document.querySelector('[data-test-pretui-date-time-picker]') as HTMLElement).getAttribute('data-field'), 'roast');
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Roast starts: Select date and time', 'the name includes what the trigger shows');
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'false');
    await click(TRIGGER);
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'true');
    let panel = document.querySelector('[data-test-pretui-date-time-panel]') as HTMLElement;
    assert.ok(panel.querySelector('[data-test-pretui-calendar]'), 'a calendar');
    assert.ok(panel.querySelector('[data-test-pretui-time-input]'), 'and the time');
  });

  test('Done is refused until both halves are set, then commits one datetime with a T', async function (assert) {
    let seen: string[] = [];
    let change = (v: string) => seen.push(v);
    await render(<template><DateTimePicker @onChange={{change}} /></template>);
    await click(TRIGGER);
    let done = document.querySelector(DONE) as HTMLElement;
    assert.strictEqual(done.getAttribute('aria-disabled'), 'true', 'nothing picked yet');
    await click(days()[14] as HTMLButtonElement);
    assert.strictEqual(done.getAttribute('aria-disabled'), 'true', 'a date alone is not enough');
    await click(DONE);
    assert.deepEqual(seen, [], 'and pressing it does nothing');
    await fillTime();
    await settled();
    let segs = [...document.querySelectorAll('[data-test-pretui-time-input] [role="spinbutton"]')].map((el) => el.getAttribute('aria-valuenow'));
    done = document.querySelector(DONE) as HTMLElement;
    assert.notOk(done.hasAttribute('aria-disabled'), `both halves set (segments ${segs.join(',')})`);
    await click(DONE);
    assert.strictEqual(seen.length, 1);
    assert.ok(/^\d{4}-\d{2}-15T00:00$/.test(seen[0] ?? ''), `committed as one wall-clock datetime (${seen[0]})`);
    assert.strictEqual(trigger().getAttribute('aria-expanded'), 'false', 'Done closes the popover');
    assert.ok(document.querySelector('[data-test-pretui-date-time-value]')?.textContent?.includes('00:00'));
  });

  test('opening seeds the draft from the value; changing only the date keeps the time', async function (assert) {
    let seen: string[] = [];
    let change = (v: string) => seen.push(v);
    await render(<template><DateTimePicker @defaultValue='2026-03-10T09:05' @onChange={{change}} /></template>);
    assert.ok(trigger().getAttribute('aria-label')?.includes('09:05'), 'the committed value is in the name');
    await click(TRIGGER);
    await click(days()[19] as HTMLButtonElement);
    await click(DONE);
    assert.deepEqual(seen, ['2026-03-20T09:05']);
  });

  test('@granularity second commits seconds', async function (assert) {
    let seen: string[] = [];
    let change = (v: string) => seen.push(v);
    await render(<template><DateTimePicker @defaultValue='2026-03-10T09:05:07' @granularity='second' @onValueChange={{change}} /></template>);
    await click(TRIGGER);
    await click(days()[0] as HTMLButtonElement);
    await click(DONE);
    assert.deepEqual(seen, ['2026-03-01T09:05:07']);
  });

  test('a seeded time is fitted to the granularity: padded to seconds, trimmed to minutes', async function (assert) {
    let seen: string[] = [];
    let change = (v: string) => seen.push(v);
    await render(<template>
      <div class='t-sec'><DateTimePicker @defaultValue='2026-03-10T09:05' @granularity='second' @onChange={{change}} /></div>
      <div class='t-min'><DateTimePicker @defaultValue='2026-03-10T09:05:07' @onChange={{change}} /></div>
    </template>);
    await click('.t-sec [data-test-pretui-date-time-trigger]');
    await click(DONE);
    await click('.t-min [data-test-pretui-date-time-trigger]');
    await click(DONE);
    assert.deepEqual(seen, ['2026-03-10T09:05:00', '2026-03-10T09:05']);
  });
});
