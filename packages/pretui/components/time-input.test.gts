// Pretui — TimeInput unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { fillIn, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TimeInput } from './time-input';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function timeSegs(): HTMLElement[] {
  return all('.pretui-time-seg');
}
function timeText(): string {
  return timeSegs().map((s) => s.textContent?.trim()).join('|');
}
// rendered on every device; only the (any-pointer: coarse) CSS decides it shows
function nativeInput(): HTMLInputElement {
  return q('[data-test-pretui-time-native]') as HTMLInputElement;
}

module('Pretui | components/time-input', function (hooks) {
  setupCardTest(hooks);

  test('TimeInput is a labelled group of spinbuttons with a literal between them', async function (assert) {
    await render(<template><TimeInput /></template>);
    let root = q('[data-test-pretui-time-input]');
    assert.strictEqual(root.getAttribute('role'), 'group');
    assert.strictEqual(root.getAttribute('aria-label'), 'Time');
    let segs = timeSegs();
    assert.strictEqual(segs.length, 2, 'hour and minute in the 24-hour default');
    assert.deepEqual(segs.map((s) => s.getAttribute('role')), ['spinbutton', 'spinbutton']);
    assert.deepEqual(segs.map((s) => s.dataset['segment']), ['hour', 'minute']);
    assert.deepEqual(segs.map((s) => s.dataset['empty']), ['true', 'true']);
    assert.deepEqual(
      segs.map((s) => s.getAttribute('aria-valuetext')),
      ['Empty', 'Empty'],
      'an unfilled segment says so rather than announcing a placeholder as a number',
    );
    assert.strictEqual(timeText(), '––|––');
    assert.strictEqual(
      q('.pretui-time-literal')?.getAttribute('aria-hidden'),
      'true',
      'the colon is punctuation, not a value',
    );
  });

  test('TimeInput seeds from a wire value and announces each segment range', async function (assert) {
    await render(<template><TimeInput @value='09:30' /></template>);
    assert.strictEqual(timeText(), '09|30');
    let [hh, mm] = timeSegs();
    assert.strictEqual(hh?.getAttribute('aria-valuenow'), '9');
    assert.strictEqual(hh?.getAttribute('aria-valuemin'), '0');
    assert.strictEqual(hh?.getAttribute('aria-valuemax'), '23');
    assert.strictEqual(mm?.getAttribute('aria-valuemax'), '59');
    assert.strictEqual(q('[data-test-pretui-time-input]').dataset['complete'], 'true');
  });

  test('TimeInput grows a seconds segment and an AM/PM segment on request', async function (assert) {
    await render(<template><TimeInput @withSeconds={{true}} @hourCycle='12' @value='13:05:09' /></template>);
    assert.deepEqual(
      timeSegs().map((s) => s.dataset['segment']),
      ['hour', 'minute', 'second', 'dayPeriod'],
    );
    assert.strictEqual(timeText(), '01|05|09|PM', 'the wire value stays 24-hour; only the display flips');
  });

  test('TimeInput steps an empty segment from its own minimum, reading no clock', async function (assert) {
    await render(<template><TimeInput /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(
      timeText(),
      '00|––',
      'a component that cannot read the clock seeds deterministically, one segment at a time',
    );
  });

  test('TimeInput seeds an empty segment from a caller-supplied @now instead', async function (assert) {
    await render(<template><TimeInput @now='14:45' /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(timeText(), '14|––', 'the app owns the clock, not the realm component');
  });

  test('TimeInput arrows step and wrap within a segment', async function (assert) {
    await render(<template><TimeInput @defaultValue='23:59' /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(timeText(), '00|59', 'the hour wraps rather than stopping at 23');

    await triggerKeyEvent(timeSegs()[1] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(timeText(), '00|00', 'and the minute wraps without carrying into the hour');
  });

  test('TimeInput holds a controlled @value on screen while reporting the step', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><TimeInput @value='23:59' @onValueChange={{record}} /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.deepEqual(seen, ['00:59'], 'the owner is told what was asked for');
    assert.strictEqual(timeText(), '23|59', 'and the display stays on the value the owner still holds');

    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.deepEqual(seen, ['00:59', '00:59'], 'asking again for a value the owner turned down is reported again');
  });

  test('TimeInput reports the wire string once every segment is filled', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><TimeInput @onValueChange={{record}} /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.deepEqual(seen, [], 'a half-filled time is not a time, and is not reported as one');

    await triggerKeyEvent(timeSegs()[1] as HTMLElement, 'keydown', 'ArrowUp');
    assert.deepEqual(seen, ['00:00'], 'the wire shape arrives once every segment is filled');
  });

  test('TimeInput is out of the tab order while disabled', async function (assert) {
    await render(<template><TimeInput @disabled={{true}} @value='09:30' /></template>);
    assert.deepEqual(timeSegs().map((s) => s.tabIndex), [-1, -1]);
    assert.deepEqual(timeSegs().map((s) => s.getAttribute('aria-disabled')), ['true', 'true']);
    assert.true(nativeInput().disabled, 'the touch control is disabled too');
  });

  test('TimeInput carries its wire value on a native time control for touch', async function (assert) {
    await render(<template><TimeInput @value='09:30' /></template>);
    let input = nativeInput();
    assert.strictEqual(input.type, 'time', 'a tap opens the platform time picker');
    assert.strictEqual(input.value, '09:30');
    assert.strictEqual(input.getAttribute('aria-label'), 'Time');
    assert.false(input.hasAttribute('step'), 'minute granularity by default');
  });

  test('TimeInput native control shows seconds with @withSeconds', async function (assert) {
    await render(<template><TimeInput @withSeconds={{true}} @value='13:05:09' /></template>);
    assert.strictEqual(nativeInput().getAttribute('step'), '1');
    assert.strictEqual(nativeInput().value, '13:05:09');
  });

  test('TimeInput native control is empty while the time is incomplete', async function (assert) {
    await render(<template><TimeInput /></template>);
    await triggerKeyEvent(timeSegs()[0] as HTMLElement, 'keydown', 'ArrowUp');
    assert.strictEqual(nativeInput().value, '');
  });

  test('TimeInput reports a time picked on the native control and repaints the segments', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><TimeInput @hourCycle='12' @onValueChange={{record}} /></template>);
    await fillIn(nativeInput(), '15:20');
    assert.deepEqual(seen, ['15:20'], 'one report, in the 24-hour wire shape');
    assert.strictEqual(timeText(), '03|20|PM', 'the segments show the picked time');

    await fillIn(nativeInput(), '');
    assert.deepEqual(seen, ['15:20', ''], 'clearing the native control reports an empty time');
    assert.strictEqual(timeText(), '––|––|––');
  });

  test('TimeInput fills unreported seconds from the native control with zero', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><TimeInput @withSeconds={{true}} @onValueChange={{record}} /></template>);
    await fillIn(nativeInput(), '08:15');
    assert.deepEqual(seen, ['08:15:00']);
  });

  test('TimeInput keeps its seconds when the native control reports none', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><TimeInput @withSeconds={{true}} @defaultValue='08:15:42' @onValueChange={{record}} /></template>,
    );
    await fillIn(nativeInput(), '09:30');
    assert.deepEqual(
      seen,
      ['09:30:42'],
      'a picker with no seconds column (iOS) changes the hour and minute only',
    );
    assert.strictEqual(timeText(), '09|30|42');
  });

  test('TimeInput native control returns to a controlled @value the owner keeps', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><TimeInput @value='23:59' @onValueChange={{record}} /></template>);
    await fillIn(nativeInput(), '07:00');
    assert.deepEqual(seen, ['07:00'], 'the owner is told what was picked');
    assert.strictEqual(nativeInput().value, '23:59', 'and the control shows the value the owner still holds');

    await fillIn(nativeInput(), '07:00');
    assert.deepEqual(seen, ['07:00', '07:00'], 'picking the turned-down value again is reported again');
  });

  test('TimeInput native control takes the name the caller gave the group', async function (assert) {
    await render(
      <template>
        <span id='start-label'>Start</span>
        <TimeInput aria-labelledby='start-label' />
        <TimeInput @label='Finish' />
        <TimeInput aria-label='End' />
      </template>,
    );
    let [byRef, byArg, byAttr] = all('[data-test-pretui-time-native]');
    assert.strictEqual(byRef?.getAttribute('aria-labelledby'), 'start-label', 'a caller aria-labelledby reaches it');
    assert.strictEqual(byArg?.getAttribute('aria-label'), 'Finish');
    assert.false(byArg?.hasAttribute('aria-labelledby'));
    assert.strictEqual(byAttr?.getAttribute('aria-label'), 'End', 'a caller aria-label wins over the default');
  });
});
