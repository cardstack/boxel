// Pretui — DataGrid unit tests. Imports from ../reading; when DataGrid moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DataGrid } from '../reading';
import type { ColumnSpec, Row, SortSpec } from '../reading';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function bodyColumn(index: number): (string | undefined)[] {
  return all('.pretui-datagrid tbody tr').map((tr) =>
    tr.querySelectorAll('td')[index]?.textContent?.trim(),
  );
}
/** `get` is not in scope in a strict-mode template; the lookup is a plain
    function instead. */
const cellOf = (row: Row, column: ColumnSpec) => row[column.key];
const COLUMNS: ColumnSpec[] = [
  { key: 'name', label: 'Supplier' },
  { key: 'lots', label: 'Lots', num: true, align: 'right' },
];
const ROWS: Row[] = [
  { id: 'b', name: 'Wuyi Origins', lots: 12 },
  { id: 'a', name: 'Anxi Cooperative', lots: 3 },
  { id: 'c', name: 'Fuding Estate', lots: 7 },
];

module('Pretui | components/data-grid', function (hooks) {
  setupCardTest(hooks);

  test('DataGrid renders rows in source order until something asks it to sort', async function (assert) {
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} /></template>);
    assert.deepEqual(bodyColumn(0), ['Wuyi Origins', 'Anxi Cooperative', 'Fuding Estate']);
    assert.deepEqual(
      all('.pretui-datagrid thead th').map((th) => th.textContent?.trim()),
      ['Supplier', 'Lots'],
    );
    assert.strictEqual(all('.pretui-datagrid thead th')[0]?.dataset['sort'], undefined, 'no sort claimed');
  });

  test('DataGrid reflects the column alignment onto both the header and the cells', async function (assert) {
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} /></template>);
    assert.deepEqual(
      all('.pretui-datagrid thead th').map((th) => th.dataset['align']),
      ['left', 'right'],
      'a column with no @align still declares one, so the CSS never guesses',
    );
    assert.true(
      all('.pretui-datagrid tbody tr')[0]?.querySelectorAll('td')[1]?.classList.contains('pretui-num'),
      'the numeric column is marked in the body too',
    );
  });

  test('DataGrid cycles a header through ascending, descending, and back to unsorted', async function (assert) {
    let seen: (SortSpec | null)[] = [];
    const record = (s: SortSpec | null) => seen.push(s);
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} @onSortChange={{record}} /></template>);
    let header = () => all('.pretui-th-btn')[1] as HTMLElement;

    await click(header());
    assert.deepEqual(bodyColumn(1), ['3', '7', '12'], 'ascending');
    assert.strictEqual(all('.pretui-datagrid thead th')[1]?.dataset['sort'], 'asc');
    assert.true(header().textContent?.includes('↑'), 'the direction is visible, not only in a data attribute');

    await click(header());
    assert.deepEqual(bodyColumn(1), ['12', '7', '3'], 'descending');
    assert.true(header().textContent?.includes('↓'));

    await click(header());
    assert.deepEqual(bodyColumn(1), ['12', '3', '7'], 'back to the caller order');
    assert.strictEqual(all('.pretui-datagrid thead th')[1]?.dataset['sort'], undefined);
    assert.deepEqual(seen, [{ key: 'lots', dir: 'asc' }, { key: 'lots', dir: 'desc' }, null]);
  });

  test('DataGrid restarts at ascending when the sort moves to another column', async function (assert) {
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} /></template>);
    await click(all('.pretui-th-btn')[1] as HTMLElement);
    await click(all('.pretui-th-btn')[1] as HTMLElement);
    await click(all('.pretui-th-btn')[0] as HTMLElement);
    assert.deepEqual(bodyColumn(0), ['Anxi Cooperative', 'Fuding Estate', 'Wuyi Origins']);
    assert.strictEqual(all('.pretui-datagrid thead th')[1]?.dataset['sort'], undefined, 'the old column lets go');
  });

  test('DataGrid opens on @defaultSort', async function (assert) {
    const SORT: SortSpec = { key: 'name', dir: 'desc' };
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} @defaultSort={{SORT}} /></template>);
    assert.deepEqual(bodyColumn(0), ['Wuyi Origins', 'Fuding Estate', 'Anxi Cooperative']);
  });

  test('DataGrid ignores a click on a column marked unsortable', async function (assert) {
    const FIXED: ColumnSpec[] = [
      { key: 'name', label: 'Supplier', sortable: false },
      { key: 'lots', label: 'Lots' },
    ];
    let seen: (SortSpec | null)[] = [];
    const record = (s: SortSpec | null) => seen.push(s);
    await render(<template><DataGrid @columns={{FIXED}} @rows={{ROWS}} @onSortChange={{record}} /></template>);
    await click(all('.pretui-th-btn')[0] as HTMLElement);
    assert.deepEqual(bodyColumn(0), ['Wuyi Origins', 'Anxi Cooperative', 'Fuding Estate'], 'nothing moved');
    assert.deepEqual(seen, [], 'and nothing was reported');
  });

  test('DataGrid selects rows by key and reports the set', async function (assert) {
    let seen: unknown[][] = [];
    const record = (keys: unknown[]) => seen.push([...keys]);
    await render(
      <template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} @selectable={{true}} @onSelectedChange={{record}} /></template>,
    );
    let rowBoxes = () => all('[aria-label="Select row"]') as HTMLInputElement[];
    assert.strictEqual(rowBoxes().length, 3);

    await click(rowBoxes()[0] as HTMLElement);
    assert.deepEqual(seen, [['b']], 'the row key, not the index');
    assert.true(rowBoxes()[0]?.checked);
    assert.strictEqual(all('.pretui-datagrid tbody tr')[0]?.dataset['state'], 'selected');

    await click(rowBoxes()[0] as HTMLElement);
    assert.deepEqual(seen[1], [], 'clicking again deselects');
    assert.strictEqual(all('.pretui-datagrid tbody tr')[0]?.dataset['state'], undefined);
  });

  test('DataGrid select-all toggles the whole page and reflects a full manual selection', async function (assert) {
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{ROWS}} @selectable={{true}} /></template>);
    let allBox = () => q('[aria-label="Select all"]') as HTMLInputElement;
    let rowBoxes = () => all('[aria-label="Select row"]') as HTMLInputElement[];
    assert.false(allBox().checked);

    await click(allBox());
    assert.deepEqual(rowBoxes().map((b) => b.checked), [true, true, true]);

    await click(rowBoxes()[1] as HTMLElement);
    assert.false(allBox().checked, 'unchecking one row releases the header box');

    await click(rowBoxes()[1] as HTMLElement);
    assert.true(allBox().checked, 'and selecting the last one takes it back');

    await click(allBox());
    assert.deepEqual(rowBoxes().map((b) => b.checked), [false, false, false]);
  });

  test('DataGrid takes the row key from @rowKey', async function (assert) {
    const SLUGGED: Row[] = [{ slug: 'wuyi', name: 'Wuyi Origins', lots: 12 }];
    let seen: unknown[][] = [];
    const record = (keys: unknown[]) => seen.push([...keys]);
    await render(
      <template>
        <DataGrid @columns={{COLUMNS}} @rows={{SLUGGED}} @rowKey='slug' @selectable={{true}} @onSelectedChange={{record}} />
      </template>,
    );
    await click(q('[aria-label="Select row"]'));
    assert.deepEqual(seen, [['wuyi']]);
  });

  test('DataGrid drops a selection whose row has left the set', async function (assert) {
    class State {
      @tracked rows: Row[] = ROWS;
    }
    let state = new State();
    await render(
      <template><DataGrid @columns={{COLUMNS}} @rows={{state.rows}} @selectable={{true}} /></template>,
    );
    await click(all('[aria-label="Select row"]')[0] as HTMLElement);

    // The selected supplier is filtered away. Pruning protects the per-row
    // toggle, whose base is `selectedInRows`: with the stale 'b' still counted,
    // selecting 'a' would read as 2 of 2 and check the header box.
    state.rows = ROWS.filter((r) => r['id'] !== 'b');
    await settled();
    assert.strictEqual(all('[aria-label="Select row"]').length, 2);
    assert.deepEqual(
      (all('[aria-label="Select row"]') as HTMLInputElement[]).map((b) => b.checked),
      [false, false],
    );

    await click(all('[aria-label="Select row"]')[0] as HTMLElement);
    assert.false(
      (q('[aria-label="Select all"]') as HTMLInputElement).checked,
      'one of two selected — the pruned key does not make it two of two',
    );
    await click(all('[aria-label="Select row"]')[0] as HTMLElement);

    await click(q('[aria-label="Select all"]'));
    assert.true((q('[aria-label="Select all"]') as HTMLInputElement).checked, 'select-all is reachable again');
  });

  test('DataGrid select-all stays off for an empty grid', async function (assert) {
    const NONE: Row[] = [];
    await render(<template><DataGrid @columns={{COLUMNS}} @rows={{NONE}} @selectable={{true}} /></template>);
    assert.false((q('[aria-label="Select all"]') as HTMLInputElement).checked, 'nothing selected is not everything selected');
    assert.strictEqual(all('.pretui-datagrid tbody tr').length, 0);
  });

  test('DataGrid hands the cell block the row and its column', async function (assert) {
    await render(
      <template>
        <DataGrid @columns={{COLUMNS}} @rows={{ROWS}}>
          <:cell as |row column|>
            <span data-test-cell>{{column.key}}={{cellOf row column}}</span>
          </:cell>
        </DataGrid>
      </template>,
    );
    assert.deepEqual(
      all('[data-test-cell]').slice(0, 2).map((c) => c.textContent?.trim()),
      ['name=Wuyi Origins', 'lots=12'],
    );
  });
});
