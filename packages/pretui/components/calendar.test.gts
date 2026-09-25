// Pretui — Calendar unit tests. Imports from ../reading-extras; when Calendar
// moves to its own file only the import path changes.
//
// Dates are ISO yyyy-mm-dd strings at every boundary and compare
// lexicographically, so nothing here depends on the runner's locale; the
// visible month/day labels are Intl output and are deliberately not asserted.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Calendar } from './calendar';
import type { DateRangeValue } from './calendar';

function cal(): HTMLElement {
  return document.querySelector('[data-test-pretui-calendar]') as HTMLElement;
}
/** A day button of the month in view (never one of the grey outside cells). */
function day(n: number): HTMLButtonElement {
  return Array.from(cal().querySelectorAll('.pretui-cal-day:not([data-outside])')).find(
    (b) => b.textContent?.trim() === String(n),
  ) as HTMLButtonElement;
}
function selectedDays(): string[] {
  return Array.from(cal().querySelectorAll('[data-selected]')).map((b) => b.textContent?.trim() as string);
}
function inRange(): string[] {
  return Array.from(cal().querySelectorAll('.pretui-cal-day:not([data-outside])[data-in-range]')).map((b) => b.textContent?.trim() as string);
}

module('Pretui | components/calendar', function (hooks) {
  setupCardTest(hooks);

  test('opens on the month of its value, with a 42-cell grid and named nav buttons', async function (assert) {
    await render(<template><Calendar @defaultValue='2026-03-14' /></template>);
    assert.strictEqual(cal().dataset['mode'], 'single');
    assert.strictEqual(cal().querySelectorAll('.pretui-cal-day').length, 42, 'six rows of seven, so the grid never jumps height');
    assert.strictEqual(cal().querySelectorAll('.pretui-cal-weekday').length, 7);
    assert.ok(cal().querySelector('[aria-label="Previous month"]'));
    assert.ok(cal().querySelector('[aria-label="Next month"]'));
    assert.deepEqual(selectedDays(), ['14']);
    assert.strictEqual(day(14).getAttribute('aria-pressed'), 'true', 'the selection is exposed as a pressed toggle');
    assert.strictEqual(day(15).getAttribute('aria-pressed'), 'false');
    assert.true((day(14).getAttribute('aria-label') ?? '').length > 5, 'each day is named in full, not just a number');
  });

  test('picks a day, reporting the ISO string', async function (assert) {
    let seen: string[] = [];
    const record = (iso: string) => seen.push(iso);
    await render(<template><Calendar @defaultValue='2026-03-14' @onValueChange={{record}} /></template>);
    await click(day(20));
    assert.deepEqual(seen, ['2026-03-20']);
    assert.deepEqual(selectedDays(), ['20']);
  });

  test('a controlled @value holds still and reports the request', async function (assert) {
    let seen: string[] = [];
    const record = (iso: string) => seen.push(iso);
    await render(<template><Calendar @value='2026-03-14' @onValueChange={{record}} /></template>);
    await click(day(20));
    assert.deepEqual(seen, ['2026-03-20']);
    assert.deepEqual(selectedDays(), ['14'], 'the owner decides');
  });

  test('the nav buttons move the view a month at a time', async function (assert) {
    await render(<template><Calendar @defaultValue='2026-03-14' /></template>);
    let march = cal().querySelector('.pretui-cal-month')?.textContent;
    await click('[aria-label="Next month"]');
    assert.notStrictEqual(cal().querySelector('.pretui-cal-month')?.textContent, march);
    assert.deepEqual(selectedDays(), [], 'the 14th of March is not in the April grid');
    await click('[aria-label="Previous month"]');
    assert.deepEqual(selectedDays(), ['14'], 'and back');
  });

  test('range mode: first click sets the start, the second completes it, reversed picks are swapped', async function (assert) {
    let seen: { start: string | null; end: string | null }[] = [];
    const record = (r: { start: string | null; end: string | null }) => seen.push(r);
    const START: DateRangeValue = { start: '2026-03-01' };
    await render(<template><Calendar @mode='range' @defaultRange={{START}} @onRangeChange={{record}} /></template>);
    assert.strictEqual(cal().dataset['mode'], 'range');
    // the seed has a start and no end, so the next click completes THAT range
    await click(day(20));
    assert.deepEqual(seen, [{ start: '2026-03-01', end: '2026-03-20' }]);
    assert.strictEqual(day(1).dataset['rangeStart'], 'true');
    assert.strictEqual(day(20).dataset['rangeEnd'], 'true');

    // a complete range: the next click starts over
    await click(day(20));
    assert.deepEqual(seen[1], { start: '2026-03-20', end: null });
    await click(day(10));
    assert.deepEqual(seen[2], { start: '2026-03-10', end: '2026-03-20' }, 'picked in reverse, so swapped');
    assert.strictEqual(day(10).dataset['rangeStart'], 'true');
    assert.strictEqual(day(20).dataset['rangeEnd'], 'true');
    assert.deepEqual(inRange(), ['11', '12', '13', '14', '15', '16', '17', '18', '19'], 'the days strictly between');
  });

  test('min and max dates disable the days outside them', async function (assert) {
    await render(<template><Calendar @defaultValue='2026-03-14' @minDate='2026-03-10' @maxDate='2026-03-20' /></template>);
    assert.true(day(9).disabled);
    assert.false(day(10).disabled);
    assert.false(day(20).disabled);
    assert.true(day(21).disabled);
  });

  test('arrow keys move the roving focus target through the grid', async function (assert) {
    await render(<template><Calendar @defaultValue='2026-03-14' /></template>);
    let roving = () => cal().querySelector('.pretui-cal-day[tabindex="0"]')?.textContent?.trim();
    assert.strictEqual(roving(), '14', 'one tab stop: the selected day');
    await triggerKeyEvent(day(14), 'keydown', 'ArrowRight');
    assert.strictEqual(roving(), '15');
    await triggerKeyEvent(day(15), 'keydown', 'ArrowDown');
    assert.strictEqual(roving(), '22', 'a week');
    await triggerKeyEvent(day(22), 'keydown', 'ArrowUp');
    await triggerKeyEvent(day(15), 'keydown', 'ArrowLeft');
    assert.strictEqual(roving(), '14');
  });

  test('renders several months side by side and disables everything on request', async function (assert) {
    await render(<template><Calendar @defaultValue='2026-03-14' @months={{2}} /></template>);
    assert.strictEqual(cal().dataset['multi'], 'true');
    assert.strictEqual(cal().querySelectorAll('.pretui-cal-panel').length, 2);

    await render(<template><Calendar @defaultValue='2026-03-14' @disabled={{true}} /></template>);
    assert.true(Array.from(cal().querySelectorAll('.pretui-cal-day')).every((b) => (b as HTMLButtonElement).disabled));
  });
});
