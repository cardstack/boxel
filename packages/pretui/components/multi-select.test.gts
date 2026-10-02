// Pretui — MultiSelect unit tests.
//
// The trigger is deliberately a role='combobox' DIV rather than a button, so
// the per-chip remove buttons can nest inside it legally; that, the listbox
// staying open across toggles, and the keyboard model are what is asserted.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness.
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { MultiSelect } from './multi-select';
import type { SelectOption } from './select';

const TEAS: SelectOption[] = [
  { value: 'green', label: 'Green' },
  { value: 'oolong', label: 'Oolong' },
  { value: 'puer', label: 'Pu-erh' },
];

function trigger(): HTMLElement {
  return document.querySelector('.pretui-mstrigger') as HTMLElement;
}
function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
}
function chips(): (string | undefined)[] {
  return Array.from(document.querySelectorAll('.pretui-mschip')).map((c) =>
    c.textContent?.replace(/\s+/g, ' ').trim(),
  );
}
function isOpen(): boolean {
  return trigger().getAttribute('aria-expanded') === 'true';
}

module('Pretui | components/multi-select', function (hooks) {
  setupCardTest(hooks);

  test('is a closed combobox showing its placeholder', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} /></template>);
    let el = trigger();
    assert.strictEqual(el.getAttribute('role'), 'combobox');
    assert.strictEqual(el.tagName, 'DIV', 'a div so the chip remove buttons can nest legally');
    assert.strictEqual(el.getAttribute('aria-haspopup'), 'listbox');
    assert.strictEqual(el.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(el.dataset['state'], 'closed');
    assert.strictEqual(el.tabIndex, 0, 'reachable by keyboard');
    assert.strictEqual(document.querySelector('.pretui-placeholder')?.textContent?.trim(), 'Select…');
    assert.strictEqual(options().length, 0, 'the listbox is not rendered while closed');
  });

  test('names its listbox and points the trigger at it', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} /></template>);
    await click(trigger());
    let listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    assert.strictEqual(trigger().getAttribute('aria-controls'), listbox.id);
    assert.strictEqual(listbox.getAttribute('aria-multiselectable'), 'true');
  });

  test('stays open across toggles — that is the whole point of multi-select', async function (assert) {
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(<template><MultiSelect @options={{TEAS}} @onValueChange={{record}} /></template>);
    await click(trigger());
    assert.true(isOpen());

    await click(options()[0] as HTMLElement);
    assert.true(isOpen(), 'picking one does not close the list');
    await click(options()[2] as HTMLElement);
    assert.true(isOpen());
    assert.deepEqual(seen, [['green'], ['green', 'puer']]);
    assert.deepEqual(chips(), ['Green', 'Pu-erh']);
  });

  test('marks the checked options in the listbox and in the accessibility tree', async function (assert) {
    const START = ['oolong'];
    await render(<template><MultiSelect @options={{TEAS}} @defaultValue={{START}} /></template>);
    await click(trigger());
    assert.deepEqual(
      options().map((o) => o.getAttribute('aria-selected')),
      ['false', 'true', 'false'],
    );
    assert.deepEqual(options().map((o) => o.dataset['state']), [undefined, 'checked', undefined]);
    assert.strictEqual(
      options()[1]?.querySelectorAll('.pretui-msbox-check').length,
      1,
      'the tick is drawn only on the checked row',
    );
  });

  test('clicking a checked option removes it', async function (assert) {
    const START = ['green', 'oolong'];
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template><MultiSelect @options={{TEAS}} @defaultValue={{START}} @onValueChange={{record}} /></template>,
    );
    await click(trigger());
    await click(options()[0] as HTMLElement);
    assert.deepEqual(seen, [['oolong']]);
    assert.deepEqual(chips(), ['Oolong']);
  });

  test('a chip removes its own value without opening the list', async function (assert) {
    const START = ['green', 'puer'];
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template><MultiSelect @options={{TEAS}} @defaultValue={{START}} @onValueChange={{record}} /></template>,
    );
    let remove = document.querySelector('[aria-label="Remove Green"]') as HTMLElement;
    assert.ok(remove, 'each chip names what it removes');
    assert.strictEqual((remove as HTMLButtonElement).tabIndex, -1, 'and stays out of the tab order');

    await click(remove);
    assert.deepEqual(seen, [['puer']]);
    assert.false(isOpen(), 'the click did not fall through to the trigger');
  });

  test('opens from the keyboard and moves the highlight with the arrows; only Enter changes the value', async function (assert) {
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push(v);
    await render(<template><MultiSelect @options={{TEAS}} @onValueChange={{record}} /></template>);
    await triggerKeyEvent(trigger(), 'keydown', 'ArrowDown');
    assert.true(isOpen(), 'ArrowDown opens a closed combobox');

    await triggerKeyEvent(trigger(), 'keydown', 'ArrowDown');
    assert.strictEqual(seen.length, 0, 'moving the highlight is not a selection');
    await triggerKeyEvent(trigger(), 'keydown', 'Enter');
    assert.deepEqual(
      options().map((o) => o.getAttribute('aria-selected')),
      ['false', 'true', 'false'],
      'Enter toggles the highlighted row, which the arrow had moved to',
    );
    assert.true(isOpen(), 'and the list stays open');
    assert.deepEqual(seen, [['oolong']], 'Enter is the one keystroke that commits');
  });

  test('the trigger names the highlighted option; Home, End and typing move it', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} @label='Teas' /></template>);
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Teas', '@label names it, not the placeholder');
    assert.strictEqual(trigger().getAttribute('aria-activedescendant'), null, 'closed: nothing is active');
    await triggerKeyEvent(trigger(), 'keydown', 'ArrowDown');
    let active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '');
    assert.strictEqual(active(), options()[0], 'open: the highlighted option is named');
    await triggerKeyEvent(trigger(), 'keydown', 'End');
    assert.strictEqual(active(), options()[options().length - 1]);
    await triggerKeyEvent(trigger(), 'keydown', 'Home');
    assert.strictEqual(active(), options()[0]);
    let target = options()[1] as HTMLElement;
    await triggerKeyEvent(trigger(), 'keydown', target.textContent!.trim()[0]!);
    assert.strictEqual(active(), target, 'typing jumps to the next matching label');
    await triggerKeyEvent(trigger(), 'keydown', 'Enter');
    assert.strictEqual(document.querySelector('.pretui-ms-count')?.textContent, '1 selected', 'the count is announced');
  });

  test('Escape closes the list', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} /></template>);
    await click(trigger());
    await triggerKeyEvent(trigger(), 'keydown', 'Escape');
    assert.false(isOpen());
  });

  test('the arrow highlight stops at both ends of the list', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} /></template>);
    await click(trigger());
    for (let i = 0; i < 6; i++) {
      await triggerKeyEvent(trigger(), 'keydown', 'ArrowDown');
    }
    await triggerKeyEvent(trigger(), 'keydown', 'Enter');
    assert.strictEqual(
      options()[2]?.getAttribute('aria-selected'),
      'true',
      'past the end lands on the last row, not off it',
    );

    for (let i = 0; i < 6; i++) {
      await triggerKeyEvent(trigger(), 'keydown', 'ArrowUp');
    }
    await triggerKeyEvent(trigger(), 'keydown', 'Enter');
    assert.strictEqual(options()[0]?.getAttribute('aria-selected'), 'true');
  });

  test('a disabled multi-select is inert but stays reachable', async function (assert) {
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template><MultiSelect @options={{TEAS}} @disabled={{true}} @onValueChange={{record}} /></template>,
    );
    let el = trigger();
    assert.strictEqual(el.getAttribute('aria-disabled'), 'true');
    assert.strictEqual(el.tabIndex, 0, 'a keyboard reader can still find it and hear that it is disabled');

    await click(el);
    assert.false(isOpen(), 'it does not open');
    await triggerKeyEvent(el, 'keydown', 'Enter');
    assert.false(isOpen(), 'not from the keyboard either');
    assert.deepEqual(seen, []);
  });

  test('a controlled multi-select reports the request without changing its own chips', async function (assert) {
    const HELD = ['green'];
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template><MultiSelect @options={{TEAS}} @value={{HELD}} @onValueChange={{record}} /></template>,
    );
    await click(trigger());
    await click(options()[1] as HTMLElement);
    assert.deepEqual(seen, [['green', 'oolong']]);
    assert.deepEqual(chips(), ['Green'], 'the owner decides when the selection moves');
  });

  test('uses @placeholder as the accessible name of the trigger', async function (assert) {
    await render(<template><MultiSelect @options={{TEAS}} @placeholder='Pick teas' /></template>);
    assert.strictEqual(trigger().getAttribute('aria-label'), 'Pick teas');
    assert.strictEqual(document.querySelector('.pretui-placeholder')?.textContent?.trim(), 'Pick teas');
  });
});
