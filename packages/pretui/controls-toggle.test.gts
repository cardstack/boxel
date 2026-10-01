// Pretui — proof for ToggleGroup, ToggleMatrix and HoverActions.
//
// What this file is actually for: all three components exist because the
// obvious implementation of each is inaccessible, so the evidence that
// matters is ARIA and the keyboard, not markup. The arithmetic is asserted as
// pure functions; everything else is driven from the keyboard in a real
// browser, because a claim about a keyboard path is worth nothing until a
// keyboard has walked it.
//
// Per the realm law this file NEVER asserts a computed style — `boxel test`
// stamps the scoped-CSS attribute and delivers no stylesheet, so every
// computed value reads as its initial. Structure, roles, ARIA state, focus
// and callbacks are what the component actually controls.
//
// Local-only. Run with `boxel test` against a scratch copy; do NOT push to
// the realm (a pushed *.test.gts opts the realm into a QUnit gate).
import { module, test } from 'qunit';
import { render, triggerKeyEvent, click, focus } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { listen } from './focus';
import { tracked } from '@glimmer/tracking';
import { HoverActions, splitActions } from './components/hover-actions';
import type { HoverAction } from './components/hover-actions';
import { ToggleGroup } from './components/toggle-group';
import type { ToggleOption } from './components/toggle-group';
import { ToggleMatrix, cellKey } from './components/toggle-matrix';
import type { ToggleCell, ToggleMatrixColumn, ToggleMatrixRow } from './components/toggle-matrix';
import { bulkStateOf, clampIndex, spanBetween } from './internal/toggle-controls';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function one(selector: string): HTMLElement {
  return root().querySelector(selector) as HTMLElement;
}
function all(selector: string): HTMLElement[] {
  return Array.from(root().querySelectorAll<HTMLElement>(selector));
}
function activeIndex(attribute: string): string | null {
  let el = document.activeElement as HTMLElement | null;
  return el ? el.getAttribute(attribute) : null;
}

const OPTIONS: ToggleOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
  { value: 'd', label: 'Delta' },
];

const ROWS: ToggleMatrixRow[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'editor', label: 'Editor' },
  { id: 'viewer', label: 'Viewer' },
];
const COLUMNS: ToggleMatrixColumn[] = [
  { id: 'view', label: 'View' },
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
];

// ─────────────────────────────────────────────────────────────────────────
module('Pretui | toggle | arithmetic', function () {
  test('bulkStateOf never calls an empty span "all"', function (assert) {
    assert.strictEqual(bulkStateOf(0, 0), 'none', 'nothing of nothing is none');
    assert.strictEqual(bulkStateOf(0, 5), 'none');
    assert.strictEqual(bulkStateOf(2, 5), 'some');
    assert.strictEqual(bulkStateOf(5, 5), 'all');
    assert.strictEqual(bulkStateOf(9, 5), 'all', 'over-count still reads all');
  });

  test('spanBetween orders either direction', function (assert) {
    assert.deepEqual(spanBetween(1, 4), [1, 4]);
    assert.deepEqual(spanBetween(4, 1), [1, 4], 'dragging backwards is the same span');
    assert.deepEqual(spanBetween(2, 2), [2, 2], 'a single cell is a valid span');
  });

  test('clampIndex holds the low bound when the range is inverted', function (assert) {
    assert.strictEqual(clampIndex(5, 0, 3), 3);
    assert.strictEqual(clampIndex(-4, 0, 3), 0);
    assert.strictEqual(clampIndex(-4, -1, 3), -1, 'the header lane is reachable');
    assert.strictEqual(clampIndex(2, 0, -1), 0, 'no cells means no phantom index');
  });

  test('cellKey does not collide across a dash in an id', function (assert) {
    assert.notStrictEqual(
      cellKey('a-b', 'c'),
      cellKey('a', 'b-c'),
      'the separator the source used would have fused these two',
    );
  });

  test('splitActions leaves room for the overflow trigger', function (assert) {
    let items: HoverAction[] = [
      { id: '1', label: 'One' },
      { id: '2', label: 'Two' },
      { id: '3', label: 'Three' },
      { id: '4', label: 'Four' },
    ];
    assert.deepEqual(
      splitActions(items, undefined).inline.length,
      4,
      'no budget means no overflow',
    );
    assert.deepEqual(splitActions(items, 4).overflow, [], 'exactly at budget stays inline');
    let cut = splitActions(items, 3);
    assert.strictEqual(cut.inline.length, 2, 'the trigger costs one of the three slots');
    assert.strictEqual(cut.overflow.length, 2);
    assert.strictEqual(
      cut.inline.length + 1,
      3,
      'total rendered controls equals the budget — the arithmetic most implementations get wrong',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
class GroupState {
  @tracked values: string[] = [];
  @tracked value: string | undefined = 'b';
  options = OPTIONS;
  valueCalls: (string | undefined)[] = [];
  valuesCalls: string[][] = [];
  setValues = (next: string[]) => {
    this.values = next;
    this.valuesCalls.push(next);
  };
  setValue = (next: string | undefined) => {
    this.value = next;
    this.valueCalls.push(next);
  };
}

module('Pretui | ToggleGroup', function (hooks) {
  setupCardTest(hooks);

  test('multi-select is a toolbar of pressed buttons', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Channels'
          @multiple={{true}}
          @values={{state.values}}
          @onValuesChange={{state.setValues}}
        />
      </template>,
    );
    let group = one('[data-test-pretui-toggle-group]');
    assert.strictEqual(group.getAttribute('role'), 'toolbar');
    assert.strictEqual(group.getAttribute('aria-label'), 'Channels');
    let items = all('[data-test-pretui-toggle-item]');
    assert.strictEqual(items.length, 4);
    assert.strictEqual(items[0].getAttribute('aria-pressed'), 'false');
    assert.strictEqual(
      items[0].getAttribute('aria-checked'),
      null,
      'a toggle button is pressed, never checked',
    );
  });

  test('single-select is a radiogroup of radios', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Alignment'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    assert.strictEqual(
      one('[data-test-pretui-toggle-group]').getAttribute('role'),
      'radiogroup',
    );
    let items = all('[data-test-pretui-toggle-item]');
    assert.strictEqual(items[0].getAttribute('role'), 'radio');
    assert.strictEqual(items[1].getAttribute('aria-checked'), 'true', 'b is chosen');
    assert.strictEqual(items[0].getAttribute('aria-checked'), 'false');
    assert.strictEqual(
      items[0].getAttribute('aria-pressed'),
      null,
      'a radio is checked, never pressed',
    );
  });

  test('the group is ONE tab stop, parked on the chosen member', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Alignment'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let items = all('[data-test-pretui-toggle-item]');
    let reachable = items.filter((el) => el.tabIndex === 0);
    assert.strictEqual(reachable.length, 1, 'exactly one member is in the tab sequence');
    assert.strictEqual(
      reachable[0].getAttribute('data-tg-index'),
      '1',
      'and it is the chosen one, not the first',
    );
  });

  test('arrows move AND choose in single-select, and wrap', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Alignment'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let group = one('[data-test-pretui-toggle-group]');
    await triggerKeyEvent(group, 'keydown', 'ArrowRight');
    assert.strictEqual(state.value, 'c', 'travelling is choosing');
    assert.strictEqual(activeIndex('data-tg-index'), '2', 'and focus followed');
    await triggerKeyEvent(group, 'keydown', 'End');
    assert.strictEqual(state.value, 'd');
    await triggerKeyEvent(group, 'keydown', 'ArrowRight');
    assert.strictEqual(state.value, 'a', 'a radiogroup is a ring, not a line');
    await triggerKeyEvent(group, 'keydown', 'Home');
    assert.strictEqual(state.value, 'a');
  });

  test('arrows move WITHOUT choosing in multi-select', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Channels'
          @multiple={{true}}
          @values={{state.values}}
          @onValuesChange={{state.setValues}}
        />
      </template>,
    );
    let group = one('[data-test-pretui-toggle-group]');
    await triggerKeyEvent(group, 'keydown', 'ArrowRight');
    await triggerKeyEvent(group, 'keydown', 'ArrowRight');
    assert.strictEqual(activeIndex('data-tg-index'), '2', 'focus travelled two');
    assert.deepEqual(
      state.values,
      [],
      'and nothing was selected on the way — with several legal answers the arrows cannot be the choice',
    );
    await click(document.activeElement as HTMLElement);
    assert.deepEqual(state.values, ['c'], 'Space/click is the choice instead');
  });

  test('multi-select reports the selection in options order, not click order', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Channels'
          @multiple={{true}}
          @values={{state.values}}
          @onValuesChange={{state.setValues}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-item="d"]');
    await click('[data-test-pretui-toggle-item="a"]');
    assert.deepEqual(state.values, ['a', 'd'], 'd was clicked first and still sorts last');
  });

  test('re-activating the chosen member clears a deselectable group', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Alignment'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-item="b"]');
    assert.strictEqual(state.value, undefined, 'the group emptied');
    assert.strictEqual(
      one('[data-test-pretui-toggle-item="b"]').getAttribute('aria-checked'),
      'false',
    );
  });

  test('deselectable={{false}} makes it a radio group again', async function (assert) {
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{state.options}}
          @label='Alignment'
          @value={{state.value}}
          @deselectable={{false}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-item="b"]');
    assert.strictEqual(state.value, 'b', 'the choice held');
    assert.deepEqual(state.valueCalls, [], 'and no spurious change fired');
  });

  test('a disabled member stays announced but never takes the tab stop', async function (assert) {
    let options: ToggleOption[] = [
      { value: 'a', label: 'Alpha', disabled: true },
      { value: 'b', label: 'Bravo' },
    ];
    let state = new GroupState();
    await render(
      <template>
        <ToggleGroup
          @options={{options}}
          @label='Channels'
          @multiple={{true}}
          @values={{state.values}}
          @onValuesChange={{state.setValues}}
        />
      </template>,
    );
    let first = one('[data-test-pretui-toggle-item="a"]');
    assert.strictEqual(first.getAttribute('aria-disabled'), 'true');
    assert.notOk(
      first.hasAttribute('disabled'),
      'aria-disabled, never disabled — a removed member changes the group shape between visits',
    );
    assert.strictEqual(first.tabIndex, -1, 'and it does not hold the tab stop');
    await click(first);
    assert.deepEqual(state.values, [], 'clicking it does nothing');
  });

  test('zero options says so instead of rendering silence', async function (assert) {
    let none: ToggleOption[] = [];
    await render(
      <template><ToggleGroup @options={{none}} @label='Channels' /></template>,
    );
    assert.ok(one('[data-test-pretui-toggle-group-empty]'), 'the empty line is there');
  });
});

// ─────────────────────────────────────────────────────────────────────────
class MatrixState {
  rows = ROWS;
  columns = COLUMNS;
  @tracked value: ToggleCell[] = [{ row: 'admin', column: 'view' }];
  toggles: string[] = [];
  batches = 0;
  setValue = (next: ToggleCell[]) => {
    this.value = next;
    this.batches++;
  };
  note = (row: string, column: string, live: boolean) => {
    this.toggles.push(row + '/' + column + '/' + (live ? 'on' : 'off'));
  };
}

module('Pretui | ToggleMatrix', function (hooks) {
  setupCardTest(hooks);

  test('it is a real table with real header semantics', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let grid = one('[data-test-pretui-toggle-matrix] table');
    assert.strictEqual(grid.tagName, 'TABLE', 'a table is a table');
    assert.strictEqual(grid.getAttribute('role'), 'grid');
    assert.strictEqual(grid.getAttribute('aria-label'), 'Role permissions');
    let colHeads = all('[data-test-pretui-toggle-matrix] th[scope="col"]');
    assert.strictEqual(colHeads.length, 4, 'the corner plus three columns');
    assert.strictEqual(colHeads[1].getAttribute('aria-label'), 'View');
    let rowHeads = all('[data-test-pretui-toggle-matrix] th[scope="row"]');
    assert.strictEqual(rowHeads.length, 3);
    assert.strictEqual(rowHeads[0].getAttribute('aria-label'), 'Admin');
  });

  test('a controlled bulk checkbox stays on @value when the owner ignores the click', async function (assert) {
    let state = new MatrixState();
    let ignore = () => {};
    await render(
      <template>
        <ToggleMatrix @rows={{state.rows}} @columns={{state.columns}} @label='Role permissions' @value={{state.value}} @onValueChange={{ignore}} />
      </template>,
    );
    let all = one('[data-test-pretui-toggle-matrix-all]') as HTMLInputElement;
    let before = all.checked;
    await click(all);
    assert.strictEqual(all.checked, before, 'the select-all checkbox did not drift');
  });

  test('a controlled mixed bulk checkbox stays mixed when the owner ignores the click', async function (assert) {
    let state = new MatrixState();
    let ignore = () => {};
    await render(
      <template>
        <ToggleMatrix @rows={{state.rows}} @columns={{state.columns}} @label='Role permissions' @value={{state.value}} @onValueChange={{ignore}} />
      </template>,
    );
    let all = one('[data-test-pretui-toggle-matrix-all]') as HTMLInputElement;
    assert.true(all.indeterminate, 'one granted cell makes the select-all box mixed');
    await click(all);
    assert.true(all.indeterminate, 'it is still drawn mixed');
    assert.false(all.checked);
  });

  test('every cell is named and carries its own pressed state', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let cells = all('[data-test-pretui-toggle-matrix-cell]');
    assert.strictEqual(cells.length, 9);
    assert.strictEqual(
      cells[0].getAttribute('aria-label'),
      'Admin, View',
      'the name carries both coordinates, so it survives focus mode',
    );
    assert.strictEqual(cells[0].getAttribute('aria-pressed'), 'true');
    assert.strictEqual(cells[1].getAttribute('aria-pressed'), 'false');
  });

  test('the whole grid is ONE tab stop', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let stops = all('[data-test-pretui-toggle-matrix] button, [data-test-pretui-toggle-matrix] input').filter(
      (el) => el.tabIndex === 0,
    );
    assert.strictEqual(
      stops.length,
      1,
      '9 cells plus 7 bulk boxes, and exactly one of the sixteen is tabbable',
    );
  });

  test('arrows navigate both axes, and the headers are row and column minus one', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let grid = one('[data-test-pretui-toggle-matrix] table');
    await triggerKeyEvent(grid, 'keydown', 'ArrowRight');
    assert.strictEqual(activeIndex('data-tm-c'), '1');
    assert.strictEqual(activeIndex('data-tm-r'), '0');
    await triggerKeyEvent(grid, 'keydown', 'ArrowDown');
    assert.strictEqual(activeIndex('data-tm-r'), '1', 'the second axis works too');
    await triggerKeyEvent(grid, 'keydown', 'ArrowLeft');
    await triggerKeyEvent(grid, 'keydown', 'ArrowLeft');
    assert.strictEqual(
      activeIndex('data-tm-c'),
      '-1',
      'arrowing off the left edge lands on the row select-all, not nowhere',
    );
    await triggerKeyEvent(grid, 'keydown', 'ArrowLeft');
    assert.strictEqual(activeIndex('data-tm-c'), '-1', 'and it clamps rather than wrapping');
  });

  test('Home, End and the Ctrl corners', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let grid = one('[data-test-pretui-toggle-matrix] table');
    await triggerKeyEvent(grid, 'keydown', 'End');
    assert.strictEqual(activeIndex('data-tm-c'), '2', 'End is the end of the ROW');
    assert.strictEqual(activeIndex('data-tm-r'), '0', 'and stays on it');
    await triggerKeyEvent(grid, 'keydown', 'End', { ctrlKey: true });
    assert.strictEqual(activeIndex('data-tm-r'), '2', 'Ctrl+End is the far corner');
    await triggerKeyEvent(grid, 'keydown', 'Home', { ctrlKey: true });
    assert.strictEqual(activeIndex('data-tm-r'), '-1');
    assert.strictEqual(activeIndex('data-tm-c'), '-1');
  });

  test('a cell toggles, and reports once per cell plus once for the batch', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
          @onToggle={{state.note}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-matrix-cell="editor/edit"]');
    assert.deepEqual(state.toggles, ['editor/edit/on']);
    assert.deepEqual(state.value, [
      { row: 'admin', column: 'view' },
      { row: 'editor', column: 'edit' },
    ]);
  });

  test('the value is always rebuilt in rows-by-columns order', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-matrix-cell="viewer/delete"]');
    await click('[data-test-pretui-toggle-matrix-cell="admin/edit"]');
    assert.deepEqual(
      state.value.map((cell) => cell.row + '/' + cell.column),
      ['admin/view', 'admin/edit', 'viewer/delete'],
      'clicked last-first-middle, serialized in declaration order',
    );
  });

  test('the row select-all carries a true indeterminate state', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let box = one(
      '[data-test-pretui-toggle-matrix-row="admin"]',
    ) as HTMLInputElement;
    assert.true(box.indeterminate, 'one of three granted is mixed, not unchecked');
    assert.false(box.checked);
    await click(box);
    let after = one('[data-test-pretui-toggle-matrix-row="admin"]') as HTMLInputElement;
    assert.false(after.indeterminate, 'and a mixed box resolves upward, per convention');
    assert.true(after.checked);
    assert.strictEqual(
      state.value.length,
      3,
      'admin gained the two it lacked; no other row moved',
    );
  });

  test('the column select-all fills a column', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
          @onToggle={{state.note}}
        />
      </template>,
    );
    await click('[data-test-pretui-toggle-matrix-col="view"]');
    assert.deepEqual(
      state.toggles,
      ['editor/view/on', 'viewer/view/on'],
      'one report per cell that ACTUALLY changed — admin was already granted',
    );
    assert.strictEqual(state.batches, 1, 'and one batch callback for the whole operation');
  });

  test('Shift+Arrow paints the rectangle the pointer would have dragged', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    // anchor on a cell and switch it on
    await click('[data-test-pretui-toggle-matrix-cell="admin/edit"]');
    let grid = one('[data-test-pretui-toggle-matrix] table');
    await triggerKeyEvent(grid, 'keydown', 'ArrowDown', { shiftKey: true });
    await triggerKeyEvent(grid, 'keydown', 'ArrowRight', { shiftKey: true });
    let painted = state.value.map((cell) => cell.row + '/' + cell.column);
    assert.ok(painted.includes('editor/edit'), 'the span grew down');
    assert.ok(painted.includes('editor/delete'), 'and across');
    assert.ok(painted.includes('admin/delete'), 'filling the whole rectangle');
    assert.notOk(painted.includes('viewer/edit'), 'and stopped at the anchor rectangle');
  });

  test('a disabled row is skipped by every bulk path and never dead-ends the tab stop', async function (assert) {
    let rows: ToggleMatrixRow[] = [
      { id: 'admin', label: 'Admin' },
      { id: 'locked', label: 'Locked', disabled: true },
    ];
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
          @onToggle={{state.note}}
        />
      </template>,
    );
    let box = one('[data-test-pretui-toggle-matrix-row="locked"]') as HTMLInputElement;
    assert.strictEqual(box.getAttribute('aria-disabled'), 'true');
    assert.notOk(
      box.hasAttribute('disabled'),
      'never natively disabled — it holds a navigation stop and must stay focusable',
    );
    await click(box);
    assert.deepEqual(state.toggles, [], 'and it grants nothing');
    await click('[data-test-pretui-toggle-matrix-col="view"]');
    assert.deepEqual(
      state.toggles,
      ['admin/view/off'],
      'the column operation touched the one live row and skipped the locked one',
    );
  });

  test('the current column is marked with aria-current, not only a tint', async function (assert) {
    let state = new MatrixState();
    await render(
      <template>
        <ToggleMatrix
          @rows={{state.rows}}
          @columns={{state.columns}}
          @label='Role permissions'
          @activeColumn='edit'
          @value={{state.value}}
          @onValueChange={{state.setValue}}
        />
      </template>,
    );
    let marked = all('[data-test-pretui-toggle-matrix] th[aria-current="true"]');
    assert.strictEqual(marked.length, 1);
    assert.strictEqual(marked[0].getAttribute('aria-label'), 'Edit');
  });

  test('no rows means a stated empty, not an invisible table', async function (assert) {
    let none: ToggleMatrixRow[] = [];
    let columns = COLUMNS;
    await render(
      <template>
        <ToggleMatrix @rows={{none}} @columns={{columns}} @label='Role permissions' />
      </template>,
    );
    assert.ok(one('[data-test-pretui-toggle-matrix-empty]'));
  });
});

// ─────────────────────────────────────────────────────────────────────────
class ActionState {
  fired: string[] = [];
  actions: HoverAction[] = [
    { id: 'preview', label: 'Preview', onSelect: () => this.fired.push('preview') },
    { id: 'edit', label: 'Edit', onSelect: () => this.fired.push('edit') },
    { id: 'copy', label: 'Duplicate', onSelect: () => this.fired.push('copy') },
    { id: 'remove', label: 'Delete', onSelect: () => this.fired.push('remove') },
  ];
  hostClicks = 0;
  onHost = () => {
    this.hostClicks++;
  };
  onSelect = (item: HoverAction) => {
    this.fired.push('outer:' + item.id);
  };
}

module('Pretui | HoverActions', function (hooks) {
  setupCardTest(hooks);

  test('the cluster is a named toolbar with one tab stop', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions for Q3 roadmap' @actions={{state.actions}}>
          <p>Q3 roadmap</p>
        </HoverActions>
      </template>,
    );
    let cluster = one('[data-test-pretui-hover-actions-cluster]');
    assert.strictEqual(cluster.getAttribute('role'), 'toolbar');
    assert.strictEqual(
      cluster.getAttribute('aria-label'),
      'Actions for Q3 roadmap',
      'the name says WHICH thing, so fifty rows are distinguishable',
    );
    let buttons = all('[data-test-pretui-hover-action]');
    assert.strictEqual(buttons.length, 4);
    assert.strictEqual(
      buttons.filter((el) => el.tabIndex === 0).length,
      1,
      'four buttons, one tab stop — the difference between 4 and 200 stops in a fifty-row list',
    );
  });

  test('every action is named even though it renders as a glyph', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions' @actions={{state.actions}}>
          <p>Host</p>
        </HoverActions>
      </template>,
    );
    let first = one('[data-test-pretui-hover-action="preview"]');
    assert.ok(
      (first.textContent ?? '').includes('Preview'),
      'the label is real text in the accessibility tree, not an arrow character',
    );
    assert.strictEqual(first.getAttribute('title'), 'Preview');
  });

  test('arrows move within the cluster and Escape returns focus to the host', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions' @actions={{state.actions}}>
          <p>Host</p>
        </HoverActions>
      </template>,
    );
    let cluster = one('[data-test-pretui-hover-actions-cluster]');
    await triggerKeyEvent(cluster, 'keydown', 'ArrowRight');
    assert.strictEqual(activeIndex('data-ha-index'), '1');
    await triggerKeyEvent(cluster, 'keydown', 'End');
    assert.strictEqual(activeIndex('data-ha-index'), '3');
    await triggerKeyEvent(cluster, 'keydown', 'ArrowRight');
    assert.strictEqual(activeIndex('data-ha-index'), '0', 'the toolbar wraps');
    await triggerKeyEvent(cluster, 'keydown', 'Escape');
    assert.strictEqual(
      document.activeElement,
      one('[data-test-pretui-hover-actions]'),
      'Escape hands focus back to the host rather than dropping it on the document',
    );
  });

  test('an action fires its own callback and the group one, and does not reach the host', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        {{!-- the host tile normally navigates on its own click --}}
        <div data-test-host-tile {{listen 'click' state.onHost}}>
          <HoverActions
            @label='Actions'
            @actions={{state.actions}}
            @onSelect={{state.onSelect}}
          >
            <p>Host</p>
          </HoverActions>
        </div>
      </template>,
    );
    await click('[data-test-pretui-hover-action="edit"]');
    assert.deepEqual(state.fired, ['edit', 'outer:edit'], 'own callback first, then the group');
    assert.strictEqual(
      state.hostClicks,
      0,
      'and the click never reached the host tile, so an action does not also navigate',
    );
  });

  test('past the budget the remainder folds into a Menu, trigger included in the count', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions' @actions={{state.actions}} @maxVisible={{3}}>
          <p>Host</p>
        </HoverActions>
      </template>,
    );
    assert.strictEqual(
      all('[data-test-pretui-hover-action]').length,
      2,
      'two inline buttons plus the trigger is the budget of three',
    );
    assert.ok(one('[data-test-pretui-hover-actions-more]'), 'and the overflow trigger is there');
  });

  test('reserve and overlay both render, and both keep the host in flow', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions' @actions={{state.actions}} @space='reserve'>
          <p data-test-host>Host</p>
        </HoverActions>
      </template>,
    );
    assert.strictEqual(
      one('[data-test-pretui-hover-actions]').getAttribute('data-space'),
      'reserve',
    );
    assert.ok(one('[data-test-host]'), 'the host content is still rendered');
  });

  test('focus reaching a hidden cluster is what reveals it — the root is the focus-within host', async function (assert) {
    let state = new ActionState();
    await render(
      <template>
        <HoverActions @label='Actions' @actions={{state.actions}}>
          <p>Host</p>
        </HoverActions>
      </template>,
    );
    let first = one('[data-test-pretui-hover-action="preview"]');
    await focus(first);
    assert.ok(
      one('[data-test-pretui-hover-actions]').contains(document.activeElement),
      'the focused button is inside the root, so :focus-within reveals the cluster — the cautionary source revealed on :hover only and left its buttons invisible',
    );
  });
});
