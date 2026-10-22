// Pretui — TreeSelect unit tests: the cascade policy, the summarised chips,
// single mode, and the tree keyboard.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { click, render, settled, triggerEvent, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { TreeSelect } from './tree-select';
import type { TreeNode } from './tree';

const TEAS: TreeNode[] = [
  {
    id: 'green',
    label: 'Green',
    children: [
      { id: 'sencha', label: 'Sencha' },
      { id: 'gyokuro', label: 'Gyokuro' },
    ],
  },
  { id: 'oolong', label: 'Oolong', children: [{ id: 'dhp', label: 'Da Hong Pao' }] },
  { id: 'puer', label: 'Pu-erh' },
];

const TRIGGER = '[data-test-pretui-tree-select-trigger]';
const TREE = '[data-test-pretui-tree-select-tree]';

function node(id: string): HTMLElement {
  return document.querySelector(`[data-test-pretui-tree-select-node="${id}"]`) as HTMLElement;
}
function chips(): string[] {
  return [...document.querySelectorAll('[data-test-pretui-tree-select-chip]')].map(
    (el) => el.getAttribute('data-test-pretui-tree-select-chip') ?? '',
  );
}
function focused(): string | null {
  return (document.activeElement as HTMLElement | null)?.getAttribute('data-test-pretui-tree-select-node') ?? null;
}

module('Pretui | components/tree-select', function (hooks) {
  setupCardTest(hooks);

  test('the trigger opens a labelled multiselectable tree', async function (assert) {
    await render(<template><TreeSelect @nodes={{TEAS}} @label='Teas' @placeholder='Any tea' data-field='teas' /></template>);
    assert.strictEqual((document.querySelector('[data-test-pretui-tree-select]') as HTMLElement).getAttribute('data-field'), 'teas');
    let trigger = document.querySelector(TRIGGER) as HTMLElement;
    assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'tree');
    assert.ok(trigger.textContent?.includes('Any tea'));
    await click(TRIGGER);
    let tree = document.querySelector(TREE) as HTMLElement;
    assert.strictEqual(tree.getAttribute('role'), 'tree');
    assert.strictEqual(tree.getAttribute('aria-multiselectable'), 'true');
    assert.strictEqual(trigger.getAttribute('aria-controls'), tree.id);
    assert.strictEqual(node('green').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(node('green').getAttribute('aria-level'), '1');
    assert.notOk(node('puer').hasAttribute('aria-expanded'), 'a leaf has no expanded state');
  });

  test('checking a branch checks its children; the chip summarises the branch', async function (assert) {
    let seen: string[][] = [];
    let change = (ids: string[]) => seen.push(ids);
    await render(<template><TreeSelect @nodes={{TEAS}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await click(node('green'));
    assert.deepEqual(seen, [['green', 'sencha', 'gyokuro']], 'the value is every checked id, in tree order');
    assert.strictEqual(node('green').getAttribute('aria-checked'), 'true');
    assert.deepEqual(chips(), ['green'], 'one chip stands for the branch');
  });

  test('a partly checked branch is mixed, and fully checking its children checks it', async function (assert) {
    let seen: string[][] = [];
    let change = (ids: string[]) => seen.push(ids);
    let expanded = ['green'];
    await render(<template><TreeSelect @nodes={{TEAS}} @defaultExpanded={{expanded}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await click(node('sencha'));
    assert.strictEqual(node('green').getAttribute('aria-checked'), 'mixed');
    assert.deepEqual(chips(), ['sencha']);
    await click(node('gyokuro'));
    assert.strictEqual(node('green').getAttribute('aria-checked'), 'true');
    assert.deepEqual(seen[seen.length - 1], ['green', 'sencha', 'gyokuro']);
    await click(node('green'));
    assert.deepEqual(seen[seen.length - 1], [], 'unchecking the branch clears it all');
  });

  test('@cascade=false checks nodes one by one', async function (assert) {
    let seen: string[][] = [];
    let change = (ids: string[]) => seen.push(ids);
    await render(<template><TreeSelect @nodes={{TEAS}} @cascade={{false}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await click(node('green'));
    assert.deepEqual(seen, [['green']]);
  });

  test('single mode selects one node and closes', async function (assert) {
    let seen: string[][] = [];
    let change = (ids: string[]) => seen.push(ids);
    await render(<template><TreeSelect @nodes={{TEAS}} @multiple={{false}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    assert.notOk(document.querySelector(TREE)?.hasAttribute('aria-multiselectable'));
    assert.strictEqual(node('puer').getAttribute('aria-selected'), 'false');
    assert.notOk(node('puer').hasAttribute('aria-checked'));
    await click(node('puer'));
    assert.deepEqual(seen, [['puer']]);
    assert.notOk(document.querySelector(TREE), 'closed');
    assert.strictEqual(document.activeElement, document.querySelector(TRIGGER), 'focus returns');
  });

  test('more chips than @maxChips collapse into +N', async function (assert) {
    let value = ['sencha', 'dhp', 'puer'];
    await render(<template><TreeSelect @nodes={{TEAS}} @value={{value}} @maxChips={{2}} @label='Teas' /></template>);
    assert.deepEqual(chips(), ['sencha', 'oolong'], 'Da Hong Pao is all of Oolong, so Oolong is the chip');
    assert.strictEqual(document.querySelector('[data-test-pretui-tree-select-more]')?.textContent?.trim(), '+1');
    assert.strictEqual(
      (document.querySelector(TRIGGER) as HTMLElement).getAttribute('aria-label'),
      'Teas: Sencha, Oolong, Pu-erh',
      'the name lists every chip, including the collapsed ones',
    );
  });

  test('the keyboard: arrows move, Right expands and enters, Left collapses and leaves, Space checks, Escape closes', async function (assert) {
    let seen: string[][] = [];
    let change = (ids: string[]) => seen.push(ids);
    await render(<template><TreeSelect @nodes={{TEAS}} @onChange={{change}} /></template>);
    await click(TRIGGER);
    await settled();
    assert.strictEqual(focused(), 'green', 'focus lands on the first node');
    await triggerKeyEvent(TREE, 'keydown', 'ArrowRight');
    assert.strictEqual(node('green').getAttribute('aria-expanded'), 'true');
    await triggerKeyEvent(TREE, 'keydown', 'ArrowRight');
    assert.strictEqual(focused(), 'sencha', 'into the branch');
    await triggerKeyEvent(TREE, 'keydown', ' ');
    assert.deepEqual(seen, [['sencha']]);
    await triggerKeyEvent(TREE, 'keydown', 'ArrowLeft');
    assert.strictEqual(focused(), 'green', 'out to the parent');
    await triggerKeyEvent(TREE, 'keydown', 'ArrowLeft');
    assert.strictEqual(node('green').getAttribute('aria-expanded'), 'false', 'and collapse it');
    await triggerKeyEvent(TREE, 'keydown', 'ArrowDown');
    assert.strictEqual(focused(), 'oolong', 'ArrowDown moves to the next visible row');
    await triggerKeyEvent(TREE, 'keydown', 'ArrowUp');
    assert.strictEqual(focused(), 'green', 'ArrowUp moves back');
    await triggerKeyEvent(TREE, 'keydown', 'End');
    assert.strictEqual(focused(), 'puer');
    await triggerKeyEvent(TREE, 'keydown', 'Enter');
    assert.deepEqual(seen[seen.length - 1], ['sencha', 'puer'], 'Enter checks too');
    await triggerKeyEvent(TREE, 'keydown', 'Home');
    assert.strictEqual(focused(), 'green');
    await triggerKeyEvent(TREE, 'keydown', 'Escape');
    assert.notOk(document.querySelector(TREE));
    assert.strictEqual(document.activeElement, document.querySelector(TRIGGER));
  });

  test('opening reveals the checked nodes; a press outside closes', async function (assert) {
    let value = ['dhp'];
    await render(<template><p class='t-out'>x</p><TreeSelect @nodes={{TEAS}} @value={{value}} /></template>);
    await click(TRIGGER);
    assert.ok(node('dhp'), 'the branch above a checked node is open');
    await triggerEvent('.t-out', 'pointerdown');
    assert.notOk(document.querySelector(TREE));
  });

  test('the checked state and the chips agree whichever ids the value lists', async function (assert) {
    let onlyChild = ['dhp'];
    let onlyBranch = ['green'];
    await render(<template>
      <div class='t-a'><TreeSelect @nodes={{TEAS}} @value={{onlyChild}} /></div>
      <div class='t-b'><TreeSelect @nodes={{TEAS}} @value={{onlyBranch}} @defaultExpanded={{EXPAND_GREEN}} /></div>
    </template>);
    let chipsIn = (sel: string) =>
      [...document.querySelectorAll(`${sel} [data-test-pretui-tree-select-chip]`)].map((el) => el.getAttribute('data-test-pretui-tree-select-chip'));
    assert.deepEqual(chipsIn('.t-a'), ['oolong'], 'the only child checks its branch');
    assert.deepEqual(chipsIn('.t-b'), ['green']);
    await click('.t-b [data-test-pretui-tree-select-trigger]');
    let row = (id: string) => document.querySelector(`.t-b [data-test-pretui-tree-select-node="${id}"]`) as HTMLElement;
    assert.strictEqual(row('green').getAttribute('aria-checked'), 'true');
    assert.strictEqual(row('sencha').getAttribute('aria-checked'), 'true', 'a listed branch checks its children');
    assert.strictEqual(row('sencha').getAttribute('aria-posinset'), '1');
    assert.strictEqual(row('sencha').getAttribute('aria-setsize'), '2');
  });

  test('a stale value opens with focus on the first id that still exists', async function (assert) {
    let value = ['gone', 'puer'];
    await render(<template><TreeSelect @nodes={{TEAS}} @value={{value}} /></template>);
    await click(TRIGGER);
    await settled();
    assert.strictEqual(focused(), 'puer');
  });
});

const EXPAND_GREEN = ['green'];
