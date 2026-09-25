// Pretui — FilterChips unit tests. Imports from its own module rather than
// the './controls' barrel.
//
// The 2026-08-13 semantics rebuild is what most needs pinning: this used to
// be role='tablist' over plain buttons — invalid ARIA, and the wrong pattern,
// because a filter row picks a value rather than swapping a panel. It is now
// native radios in a radiogroup for single-select and native checkboxes in a
// group for multi-select, which is also the correct keyboard model for each.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FilterChips } from './filter-chips';
import type { FilterChipOption } from './filter-chips';

const STATES: FilterChipOption[] = [
  { value: 'open', label: 'Open', count: 12 },
  { value: 'blocked', label: 'Blocked', count: 3 },
  { value: 'shipped', label: 'Shipped', count: 41 },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-filter-chips]') as HTMLElement;
}
function inputs(): HTMLInputElement[] {
  return Array.from(root().querySelectorAll('input')) as HTMLInputElement[];
}
function activeLabels(): (string | undefined)[] {
  return Array.from(root().querySelectorAll('[data-state="active"]')).map((l) =>
    l.querySelector('.pretui-filterchip-count')
      ? l.textContent?.replace(/\s+/g, ' ').trim()
      : l.textContent?.trim(),
  );
}

module('Pretui | components/filter-chips', function (hooks) {
  setupCardTest(hooks);

  test('single-select is a radiogroup of native radios sharing one name', async function (assert) {
    await render(<template><FilterChips @options={{STATES}} @label='Status' /></template>);
    assert.strictEqual(root().getAttribute('role'), 'radiogroup');
    assert.strictEqual(root().getAttribute('aria-label'), 'Status', 'chip rows rarely sit under a heading');
    assert.deepEqual(inputs().map((i) => i.type), ['radio', 'radio', 'radio']);
    assert.strictEqual(new Set(inputs().map((i) => i.name)).size, 1, 'one tab stop, arrows to move');
    assert.strictEqual(root().querySelectorAll('button').length, 0, 'no plain buttons left');
  });

  test('single-select opens on the first option and moves itself', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(<template><FilterChips @options={{STATES}} @onValueChange={{record}} /></template>);
    assert.true(inputs()[0]?.checked, 'a filter row is never in no state');

    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(seen, ['blocked']);
    assert.true(inputs()[1]?.checked);
    assert.false(inputs()[0]?.checked, 'the radio group clears the previous choice for us');
  });

  test('single-select opens on @defaultValue and notifies through the @onChange alias', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><FilterChips @options={{STATES}} @defaultValue='shipped' @onChange={{record}} /></template>,
    );
    assert.true(inputs()[2]?.checked);
    await click(inputs()[0] as HTMLElement);
    assert.deepEqual(seen, ['open']);
  });

  test('multi-select is a group of checkboxes with one tab stop each', async function (assert) {
    await render(<template><FilterChips @options={{STATES}} @multiple={{true}} @label='Status' /></template>);
    assert.strictEqual(
      root().getAttribute('role'),
      'group',
      'a radiogroup would be a lie when any combination is legal',
    );
    assert.deepEqual(inputs().map((i) => i.type), ['checkbox', 'checkbox', 'checkbox']);
    assert.deepEqual(inputs().map((i) => i.checked), [false, false, false], 'nothing preselected');
  });

  test('multi-select accumulates and removes values, reporting the whole set each time', async function (assert) {
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template><FilterChips @options={{STATES}} @multiple={{true}} @onValuesChange={{record}} /></template>,
    );
    await click(inputs()[0] as HTMLElement);
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(seen, [['open'], ['open', 'blocked']], '"open AND blocked" is the ordinary ask');
    assert.deepEqual(inputs().map((i) => i.checked), [true, true, false]);

    await click(inputs()[0] as HTMLElement);
    assert.deepEqual(seen[2], ['blocked'], 'clicking again removes just that one');
    assert.deepEqual(inputs().map((i) => i.checked), [false, true, false]);
  });

  test('multi-select opens on @defaultValues and notifies through the @onSelectionChange alias', async function (assert) {
    const START = ['blocked'];
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template>
        <FilterChips @options={{STATES}} @multiple={{true}} @defaultValues={{START}} @onSelectionChange={{record}} />
      </template>,
    );
    assert.deepEqual(inputs().map((i) => i.checked), [false, true, false]);
    await click(inputs()[2] as HTMLElement);
    assert.deepEqual(seen, [['blocked', 'shipped']]);
  });

  test('a controlled multi-select reports the request (the DOM drift is pinned below)', async function (assert) {
    const HELD = ['open'];
    let seen: string[][] = [];
    const record = (v: string[]) => seen.push([...v]);
    await render(
      <template>
        <FilterChips @options={{STATES}} @multiple={{true}} @values={{HELD}} @onValuesChange={{record}} />
      </template>,
    );
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(seen, [['open', 'blocked']], 'the owner is told the set it would become');
  });

  test('KNOWN GAP: a controlled FilterChips that is not moved by its owner shows the clicked option, in both modes', async function (assert) {
    // Same defect as RadioGroup and SegmentedControl: `checked={{this.isActive
    // option}}` is a property binding, and in controlled mode `pick` returns
    // early, so nothing re-renders and the browser keeps the user's click while
    // @value / @values still hold the old selection. Pinned so the day this is
    // fixed the expectations fail and get flipped.
    const ignore = () => {};
    await render(<template><FilterChips @options={{STATES}} @value='open' @onValueChange={{ignore}} /></template>);
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(inputs().map((i) => i.checked), [false, true, false], 'KNOWN GAP: the radio drifted away from @value');

    const HELD = ['open'];
    await render(<template><FilterChips @options={{STATES}} @multiple={{true}} @values={{HELD}} @onValuesChange={{ignore}} /></template>);
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(inputs().map((i) => i.checked), [true, true, false], 'KNOWN GAP: the checkbox drifted away from @values');
  });

  test('takes its collection from the @items alias', async function (assert) {
    await render(<template><FilterChips @items={{STATES}} /></template>);
    assert.strictEqual(inputs().length, 3);
  });

  test('reserves the count slot as soon as any option declares a count', async function (assert) {
    await render(<template><FilterChips @options={{STATES}} /></template>);
    assert.deepEqual(
      Array.from(root().querySelectorAll('.pretui-filterchip-count')).map((c) => c.textContent?.trim()),
      ['12', '3', '41'],
    );
    assert.strictEqual(
      root().getAttribute('style'),
      '--pretui-filterchip-count-ch: 2',
      'a fixed slot, so a count arriving late does not reflow the row',
    );
  });

  test('reserves an empty slot on chips whose count has not arrived yet', async function (assert) {
    const PARTIAL: FilterChipOption[] = [
      { value: 'open', label: 'Open', count: 12 },
      { value: 'blocked', label: 'Blocked' },
    ];
    await render(<template><FilterChips @options={{PARTIAL}} /></template>);
    assert.deepEqual(
      Array.from(root().querySelectorAll('.pretui-filterchip-count')).map((c) => c.textContent?.trim()),
      ['12', ''],
      'the slot is held open rather than added when the number lands',
    );
  });

  test('drops the count slot entirely when no option has one, and honours the override', async function (assert) {
    const BARE: FilterChipOption[] = [{ value: 'a', label: 'A' }];
    await render(<template><FilterChips @options={{BARE}} /></template>);
    assert.strictEqual(root().querySelectorAll('.pretui-filterchip-count').length, 0);

    await render(<template><FilterChips @options={{BARE}} @reserveCounts={{true}} @countDigits={{4}} /></template>);
    assert.strictEqual(root().querySelectorAll('.pretui-filterchip-count').length, 1);
    assert.strictEqual(root().getAttribute('style'), '--pretui-filterchip-count-ch: 4');
  });

  test('paints a caller hue as a dot, and refuses one carrying its own declaration', async function (assert) {
    const HUED: FilterChipOption[] = [
      { value: 'a', label: 'A', hue: 'var(--chart-2)' },
      { value: 'b', label: 'B', hue: 'red; background: url(javascript:0)' },
    ];
    await render(<template><FilterChips @options={{HUED}} /></template>);
    let dots = Array.from(root().querySelectorAll('.pretui-filterdot')) as HTMLElement[];
    assert.strictEqual(dots.length, 2);
    assert.strictEqual(dots[0]?.getAttribute('style'), 'background: var(--chart-2)');
    assert.strictEqual(dots[1]?.getAttribute('style'), null, 'the rejected hue is dropped whole — no style attribute at all');
  });

  test('marks the active chip so the dress can follow the state', async function (assert) {
    await render(<template><FilterChips @options={{STATES}} @defaultValue='blocked' /></template>);
    assert.deepEqual(activeLabels(), ['Blocked 3'], 'exactly one chip is active in single-select');
  });
});
