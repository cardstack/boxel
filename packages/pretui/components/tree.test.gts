// Pretui — Tree unit tests. Both halves of the roving
// tabindex are asserted: which row carries tabindex=0, and that real focus
// (document.activeElement) follows it after a keyboard move — focusWhen fires
// in this harness.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Tree } from './tree';
import type { TreeNode } from './tree';

const NODES: TreeNode[] = [
  { id: 'fujian', label: 'Fujian', children: [
    { id: 'wuyi', label: 'Wuyi', badge: 'active', meta: '12 lots' },
    { id: 'anxi', label: 'Anxi', disabled: true },
  ] },
  { id: 'yunnan', label: 'Yunnan', children: [{ id: 'puer', label: 'Pu-erh' }] },
  { id: 'notes', label: 'Notes' },
];

function tree(): HTMLElement {
  return document.querySelector('[data-test-pretui-tree] [role="tree"]') as HTMLElement;
}
function rows(): HTMLElement[] {
  return Array.from(tree().querySelectorAll('[role="treeitem"]')) as HTMLElement[];
}
function ids(): string[] {
  return rows().map((r) => r.dataset['treeId'] as string);
}
function row(id: string): HTMLElement {
  return tree().querySelector(`[data-tree-id="${id}"]`) as HTMLElement;
}
function roving(): string | undefined {
  return rows().find((r) => r.tabIndex === 0)?.dataset['treeId'];
}

module('Pretui | components/tree', function (hooks) {
  setupCardTest(hooks);

  test('renders the visible rows as ARIA tree items with level, position and set size', async function (assert) {
    await render(<template><Tree @nodes={{NODES}} /></template>);
    assert.strictEqual(tree().getAttribute('aria-label'), 'Tree');
    assert.deepEqual(ids(), ['fujian', 'yunnan', 'notes'], 'branches start collapsed');
    assert.deepEqual(rows().map((r) => r.getAttribute('aria-expanded')), ['false', 'false', null], 'a leaf has no aria-expanded at all');
    assert.deepEqual(rows().map((r) => r.getAttribute('aria-level')), ['1', '1', '1']);
    assert.deepEqual(rows().map((r) => r.getAttribute('aria-setsize')), ['3', '3', '3']);
    assert.strictEqual(roving(), 'fujian', 'one tab stop');
    assert.strictEqual(row('notes').querySelector('.pretui-tree-twisty')?.getAttribute('data-leaf'), 'true');
  });

  test('clicking the twisty expands a branch; clicking the row selects it', async function (assert) {
    let expanded: string[][] = [];
    let selected: string[] = [];
    const onExpanded = (e: string[]) => expanded.push([...e]);
    const onSelect = (n: TreeNode) => selected.push(n.id);
    await render(<template><Tree @nodes={{NODES}} @onExpandedChange={{onExpanded}} @onSelect={{onSelect}} /></template>);
    await click(row('fujian').querySelector('[data-tree-twisty]') as HTMLElement);
    assert.deepEqual(ids(), ['fujian', 'wuyi', 'anxi', 'yunnan', 'notes']);
    assert.strictEqual(row('fujian').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(row('wuyi').getAttribute('aria-level'), '2');
    assert.deepEqual(expanded, [['fujian']]);
    assert.deepEqual(selected, [], 'expanding is not selecting');

    await click(row('wuyi').querySelector('.pretui-tree-label') as HTMLElement);
    assert.deepEqual(selected, ['wuyi']);
    assert.strictEqual(row('wuyi').getAttribute('aria-selected'), 'true');
    assert.strictEqual(row('wuyi').querySelector('[data-test-pretui-status-chip]')?.textContent?.trim(), 'active');
    assert.strictEqual(row('wuyi').querySelector('.pretui-tree-meta')?.textContent?.trim(), '12 lots');
  });

  test('a disabled node cannot be selected but stays in the tree', async function (assert) {
    let selected: string[] = [];
    const onSelect = (n: TreeNode) => selected.push(n.id);
    const OPEN = ['fujian'];
    await render(<template><Tree @nodes={{NODES}} @defaultExpanded={{OPEN}} @onSelect={{onSelect}} /></template>);
    assert.strictEqual(row('anxi').getAttribute('aria-disabled'), 'true');
    await click(row('anxi').querySelector('.pretui-tree-label') as HTMLElement);
    assert.deepEqual(selected, [], 'so the branch below it would still be reachable');
  });

  test('the keyboard walks, opens and closes branches, and selects', async function (assert) {
    let selected: string[] = [];
    const onSelect = (n: TreeNode) => selected.push(n.id);
    await render(<template><Tree @nodes={{NODES}} @onSelect={{onSelect}} /></template>);
    await triggerKeyEvent(tree(), 'keydown', 'ArrowRight');
    assert.strictEqual(row('fujian').getAttribute('aria-expanded'), 'true', 'Right opens a closed branch');
    // WAI-ARIA APG tree pattern: Right Arrow on a closed branch opens it and
    // focus does not move; a second Right (or Down) descends to the first child.
    assert.strictEqual(roving(), 'fujian', 'opening does not move focus (APG)');

    await triggerKeyEvent(tree(), 'keydown', 'ArrowDown');
    assert.strictEqual(roving(), 'wuyi');
    assert.strictEqual(document.activeElement, row('wuyi'), 'real focus follows the roving row');
    await triggerKeyEvent(tree(), 'keydown', 'ArrowDown');
    assert.strictEqual(roving(), 'anxi');
    await triggerKeyEvent(tree(), 'keydown', 'ArrowLeft');
    assert.strictEqual(roving(), 'fujian', 'Left on a leaf climbs to the parent');
    await triggerKeyEvent(tree(), 'keydown', 'ArrowLeft');
    assert.strictEqual(row('fujian').getAttribute('aria-expanded'), 'false', 'Left on an open branch closes it');

    await triggerKeyEvent(tree(), 'keydown', 'End');
    assert.strictEqual(roving(), 'notes');
    assert.strictEqual(document.activeElement, row('notes'));
    await triggerKeyEvent(tree(), 'keydown', 'Enter');
    assert.deepEqual(selected, ['notes']);
    await triggerKeyEvent(tree(), 'keydown', 'Home');
    assert.strictEqual(roving(), 'fujian');
  });

  test('a single character type-ahead cycles to the next matching label', async function (assert) {
    await render(<template><Tree @nodes={{NODES}} /></template>);
    // test-helpers insists on an uppercase key name; the tree lowercases it
    await triggerKeyEvent(tree(), 'keydown', 'N');
    assert.strictEqual(roving(), 'notes');
    await triggerKeyEvent(tree(), 'keydown', 'Y');
    assert.strictEqual(roving(), 'yunnan', 'wraps around');
  });

  test('controlled expansion and selection hold still and report', async function (assert) {
    let expanded: string[][] = [];
    const onExpanded = (e: string[]) => expanded.push([...e]);
    const HELD: string[] = [];
    await render(<template><Tree @nodes={{NODES}} @expanded={{HELD}} @selected='notes' @onExpandedChange={{onExpanded}} /></template>);
    await click(row('fujian').querySelector('[data-tree-twisty]') as HTMLElement);
    assert.deepEqual(expanded, [['fujian']]);
    assert.deepEqual(ids(), ['fujian', 'yunnan', 'notes'], 'the owner decides');
    assert.strictEqual(row('notes').getAttribute('aria-selected'), 'true');
  });

  test('takes an indent, a density and an empty block', async function (assert) {
    const NONE: TreeNode[] = [];
    await render(<template><Tree @nodes={{NONE}}><:empty><p data-test-empty>No regions</p></:empty></Tree></template>);
    assert.ok(document.querySelector('[data-test-pretui-tree] [data-test-empty]'));

    await render(<template><Tree @nodes={{NODES}} @indent={{24}} @density='compact' @label='Regions' /></template>);
    let host = document.querySelector('[data-test-pretui-tree]') as HTMLElement;
    assert.strictEqual(host.dataset['density'], 'compact');
    assert.strictEqual(host.getAttribute('style'), '--pretui-tree-indent: 24px');
    assert.strictEqual(tree().getAttribute('aria-label'), 'Regions');
  });
});
