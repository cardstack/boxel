// Pretui — SegmentedControl unit tests. Imports from its own module rather
// than the './controls' barrel.
//
// The 2026-08-13 semantics rebuild is the thing worth pinning: this used to
// be role='tablist' over plain buttons — invalid ARIA, and the wrong pattern
// anyway, because a segmented control swaps a VALUE, not a panel. It is now
// native radios, which hand over the whole APG radio contract for free.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SegmentedControl } from './segmented-control';
import type { SegmentOption } from './segmented-control';

const VIEWS: SegmentOption[] = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
];

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-segmented]') as HTMLElement;
}
function inputs(): HTMLInputElement[] {
  return Array.from(root().querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
}
function activeLabels(): (string | undefined)[] {
  return Array.from(root().querySelectorAll('[data-state="active"]')).map((l) =>
    l.textContent?.trim(),
  );
}

module('Pretui | components/segmented-control', function (hooks) {
  setupCardTest(hooks);

  test('is a radiogroup of native radios, not a tablist of buttons', async function (assert) {
    await render(<template><SegmentedControl @options={{VIEWS}} @label='View' /></template>);
    assert.strictEqual(root().getAttribute('role'), 'radiogroup');
    assert.strictEqual(root().getAttribute('aria-label'), 'View', 'an unnamed group announces as nothing');
    assert.strictEqual(inputs().length, 3);
    assert.strictEqual(root().querySelectorAll('button').length, 0);
    assert.strictEqual(new Set(inputs().map((i) => i.name)).size, 1, 'one name, one tab stop');
  });

  test('selects the first option when nothing says otherwise', async function (assert) {
    await render(<template><SegmentedControl @options={{VIEWS}} /></template>);
    assert.true(inputs()[0]?.checked, 'a view switcher is never in no view');
    assert.deepEqual(activeLabels(), ['Grid']);
  });

  test('opens on @defaultValue and moves itself, reporting each pick', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><SegmentedControl @options={{VIEWS}} @defaultValue='list' @onValueChange={{record}} /></template>,
    );
    assert.deepEqual(activeLabels(), ['List']);

    await click(inputs()[2] as HTMLElement);
    assert.deepEqual(activeLabels(), ['Board'], 'exactly one segment is ever active');
    assert.true(inputs()[2]?.checked);
    assert.deepEqual(seen, ['board']);
  });

  test('stays put when @value is controlled, but still reports the request', async function (assert) {
    let seen: string[] = [];
    const record = (v: string) => seen.push(v);
    await render(
      <template><SegmentedControl @options={{VIEWS}} @value='grid' @onValueChange={{record}} /></template>,
    );
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(activeLabels(), ['Grid'], 'the owner decides when the pill moves');
    assert.deepEqual(seen, ['list']);
    // The visible state is an attribute driven by the unchanged getter, so it
    // holds. The native radio underneath is a property the browser already
    // moved, and nothing re-rendered to move it back — so the checked radio
    // and the active segment disagree until the owner updates @value. Pinned
    // so the day this is fixed the expectation fails and gets flipped.
    assert.true(inputs()[1]?.checked, 'KNOWN GAP: the radio drifted away from @value');
  });

  test('notifies through the @onChange alias, and fires both listeners once', async function (assert) {
    let seen: string[] = [];
    const a = (v: string) => seen.push(`a:${v}`);
    const b = (v: string) => seen.push(`b:${v}`);
    await render(
      <template><SegmentedControl @options={{VIEWS}} @onValueChange={{a}} @onChange={{b}} /></template>,
    );
    await click(inputs()[1] as HTMLElement);
    assert.deepEqual(seen, ['a:list', 'b:list']);
  });

  test('takes its collection from the @items alias', async function (assert) {
    await render(<template><SegmentedControl @items={{VIEWS}} /></template>);
    assert.strictEqual(inputs().length, 3);
  });

  test('renders the travelling highlight as one sibling element, not a per-segment background', async function (assert) {
    await render(<template><SegmentedControl @options={{VIEWS}} /></template>);
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-sliding-highlight]').length,
      1,
      'one pill travels between segments — the measuring code lives in motion-core, not here',
    );
    let pill = root().querySelector('[data-test-pretui-sliding-highlight]') as HTMLElement;
    assert.strictEqual(pill.dataset['variant'], 'pill');
    assert.strictEqual(pill.getAttribute('aria-hidden'), 'true', 'decoration, never announced');
  });

  test('keeps the radio as a real tab stop (its visually-hidden dress is CSS, unverifiable here)', async function (assert) {
    await render(<template><SegmentedControl @options={{VIEWS}} /></template>);
    let input = inputs()[0] as HTMLInputElement;
    assert.strictEqual(input.tabIndex, 0, 'the group is reachable by keyboard');
    assert.strictEqual(
      input.closest('label')?.className,
      'pretui-seg-item',
      'the label wears the dress; the radio carries the semantics',
    );
  });
});
