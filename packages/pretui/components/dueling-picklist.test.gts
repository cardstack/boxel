// Pretui — DuelingPicklist unit tests.
//
// SLDS ships this as markup snapshots with the keyboard model written as
// assistive text; here it is implemented, so it is asserted: mark, transfer,
// transfer-all, locked records, a modeless Alt+Arrow reorder, and an
// assertive live region that says what just moved. Focus following the moved
// records is not asserted here; the live region is. (Focus does stick in this
// harness — see form.test.gts — so this is a coverage choice.)
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DuelingPicklist } from './dueling-picklist';
import type { PickerRecord } from '../internal/forms-picker';

const TEAS: PickerRecord[] = [
  { id: 'green', label: 'Green' },
  { id: 'oolong', label: 'Oolong' },
  { id: 'puer', label: 'Pu-erh' },
  { id: 'house', label: 'House blend', locked: true },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-dueling-picklist]') as HTMLElement;
}
function listboxes(): HTMLElement[] {
  return Array.from(root().querySelectorAll('[role="listbox"]')) as HTMLElement[];
}
function idsIn(list: HTMLElement | undefined): string[] {
  return Array.from(list?.querySelectorAll('[data-test-pretui-picklist-option]') ?? []).map(
    (o) => o.getAttribute('data-test-pretui-picklist-option') as string,
  );
}
function option(id: string): HTMLElement {
  return root().querySelector(`[data-test-pretui-picklist-option="${id}"]`) as HTMLElement;
}
function btn(name: string): HTMLButtonElement {
  return root().querySelector(`[data-test-pretui-picklist-${name}]`) as HTMLButtonElement;
}
function live(): string | undefined {
  return root().querySelector('[data-test-pretui-picklist-live]')?.textContent?.trim();
}

module('Pretui | components/dueling-picklist', function (hooks) {
  setupCardTest(hooks);

  test('is a named group of two labelled multi-select listboxes with spoken instructions', async function (assert) {
    await render(
      <template><DuelingPicklist @options={{TEAS}} @label='Teas on the menu' @availableLabel='Available' @selectedLabel='On the menu' @required={{true}} /></template>,
    );
    assert.strictEqual(root().getAttribute('role'), 'group');
    assert.true(document.getElementById(root().getAttribute('aria-labelledby') as string)?.textContent?.includes('Teas on the menu'));
    assert.ok(root().querySelector('.pretui-dueling-req'), 'required marker beside the legend');
    let [avail, sel] = listboxes();
    assert.strictEqual(listboxes().length, 2);
    assert.strictEqual(avail?.getAttribute('aria-multiselectable'), 'true');
    assert.strictEqual(document.getElementById(avail?.getAttribute('aria-labelledby') as string)?.textContent?.trim(), 'Available');
    assert.strictEqual(document.getElementById(sel?.getAttribute('aria-labelledby') as string)?.textContent?.trim(), 'On the menu');
    assert.true(
      document.getElementById(avail?.getAttribute('aria-describedby') as string)?.textContent?.includes('Space toggles selection'),
      'the keyboard model is described, and — unlike upstream — implemented',
    );
    assert.deepEqual(idsIn(avail), ['green', 'oolong', 'puer', 'house']);
    assert.deepEqual(idsIn(sel), []);
  });

  test('marks an option on click, then moves it across, reporting the ordered ids', async function (assert) {
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @onValueChange={{record}} /></template>);
    assert.true(btn('move-right').disabled, 'nothing marked yet');

    await click(option('oolong'));
    assert.strictEqual(option('oolong').getAttribute('aria-selected'), 'true');
    assert.false(btn('move-right').disabled);

    await click(btn('move-right'));
    assert.deepEqual(seen, [['oolong']]);
    let [avail, sel] = listboxes();
    assert.deepEqual(idsIn(avail), ['green', 'puer', 'house']);
    assert.deepEqual(idsIn(sel), ['oolong']);
    assert.true(live()?.includes('Oolong'), 'the move is announced');
    assert.true(live()?.includes('moved to'));
  });

  test('Shift-click extends a range and Ctrl-click toggles one', async function (assert) {
    await render(<template><DuelingPicklist @options={{TEAS}} /></template>);
    await click(option('green'));
    await click(option('puer'), { shiftKey: true });
    assert.deepEqual(
      ['green', 'oolong', 'puer'].map((id) => option(id).getAttribute('aria-selected')),
      ['true', 'true', 'true'],
      'the range between anchor and click',
    );
    await click(option('oolong'), { ctrlKey: true });
    assert.strictEqual(option('oolong').getAttribute('aria-selected'), 'false', 'toggled out of the set');
    assert.strictEqual(option('green').getAttribute('aria-selected'), 'true', 'without disturbing the rest');
  });

  test('move-all skips locked records, which are also announced as disabled options', async function (assert) {
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @onValueChange={{record}} /></template>);
    assert.strictEqual(option('house').getAttribute('aria-disabled'), 'true');
    await click(btn('move-all-right'));
    assert.deepEqual(seen, [['green', 'oolong', 'puer']], 'the house blend stays where it is');
    assert.deepEqual(idsIn(listboxes()[0]), ['house']);
    assert.true(btn('move-all-right').disabled, 'nothing movable is left');
  });

  test('a single transfer skips a locked record too', async function (assert) {
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @onValueChange={{record}} /></template>);
    await click(option('house'));
    await click(option('green'), { ctrlKey: true });
    await click(btn('move-right'));
    assert.deepEqual(seen, [['green']], 'only the unlocked one crosses');
    assert.deepEqual(idsIn(listboxes()[0]), ['oolong', 'puer', 'house']);
  });

  test('moves back to the left and seeds from @defaultValue in the given order', async function (assert) {
    const START = ['puer', 'green'];
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @defaultValue={{START}} @onValueChange={{record}} /></template>);
    assert.deepEqual(idsIn(listboxes()[1]), ['puer', 'green'], 'order is the payload');

    await click(option('puer'));
    await click(btn('move-left'));
    assert.deepEqual(seen, [['green']]);
    assert.deepEqual(idsIn(listboxes()[1]), ['green']);
  });

  test('reorders the selected list with the buttons, one position at a time, and says where it landed', async function (assert) {
    const START = ['green', 'oolong', 'puer'];
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @defaultValue={{START}} @onValueChange={{record}} /></template>);
    assert.true(btn('move-up').disabled, 'nothing marked');

    await click(option('puer'));
    assert.true(btn('move-down').disabled, 'already last');
    assert.false(btn('move-up').disabled);
    await click(btn('move-up'));
    assert.deepEqual(seen, [['green', 'puer', 'oolong']]);
    assert.true(live()?.includes('position 2 of 3'));
  });

  test('Alt+Arrow reorders modelessly from the keyboard, and Ctrl+Arrow transfers', async function (assert) {
    const START = ['green', 'oolong'];
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @defaultValue={{START}} @onValueChange={{record}} /></template>);
    // Keys are handled on the focused option (roving tabindex), not the list.
    await click(option('oolong'));
    await triggerKeyEvent(option('oolong'), 'keydown', 'ArrowUp', { altKey: true });
    assert.deepEqual(seen.at(-1), ['oolong', 'green'], 'Space keeps its listbox meaning; reorder is a chord, not a mode');

    await triggerKeyEvent(option('oolong'), 'keydown', 'ArrowLeft', { ctrlKey: true });
    assert.deepEqual(seen.at(-1), ['green'], 'Ctrl+Left sends the marked record back');
  });

  test('a controlled @value holds the lists still and reports the request', async function (assert) {
    const HELD = ['green'];
    let seen: string[][] = [];
    const record = (ids: string[]) => seen.push([...ids]);
    await render(<template><DuelingPicklist @options={{TEAS}} @value={{HELD}} @onValueChange={{record}} /></template>);
    await click(option('oolong'));
    await click(btn('move-right'));
    assert.deepEqual(seen, [['green', 'oolong']]);
    assert.deepEqual(idsIn(listboxes()[1]), ['green'], 'the owner decides when the value moves');
  });

  test('hides the reorder column on request and goes fully inert when disabled', async function (assert) {
    await render(<template><DuelingPicklist @options={{TEAS}} @reorder={{false}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-picklist-move-up]'), null);

    const START = ['green'];
    await render(<template><DuelingPicklist @options={{TEAS}} @defaultValue={{START}} @disabled={{true}} /></template>);
    assert.strictEqual(root().dataset['disabled'], 'true');
    for (let name of ['move-right', 'move-left', 'move-all-right', 'move-all-left', 'move-up', 'move-down']) {
      assert.true(btn(name).disabled, `${name} is disabled`);
    }
    assert.strictEqual(listboxes()[0]?.getAttribute('aria-disabled'), 'true');
  });
});
