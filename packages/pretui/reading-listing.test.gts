// Pretui — runtime proof for the record-listing territory
// (reading-listing.gts: DataTable, List, Item, Descriptions).
//
// What is asserted is exactly what the corpus gets wrong: sort semantics
// that never reach assistive technology, row selection with no accessible
// state, a scroll box with no tab stop, an expander with no aria-controls,
// a filtered-empty state indistinguishable from an empty dataset, and pin
// offsets that silently overlap. Structure, roles, ARIA and callbacks only —
// `boxel test` stamps the scoped-CSS attribute but delivers no stylesheet,
// so a computed style would read as an initial value and prove nothing.
//
// LOCAL-ONLY. Never push a *.test.gts to a realm.
import { module, test } from 'qunit';
import { tracked } from '@glimmer/tracking';
import { render, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DataTable } from './components/data-table';
import { Descriptions } from './components/descriptions';
import { Item } from './components/item';
import { List } from './components/list';
import { RowCursor } from './internal/reading-listing';
import type { DataColumn, FilterState } from './components/data-table';
import type { DescriptionsItem } from './components/descriptions';
import type { RowKey, SortState } from './data-component';
import { DEMOS_DATA_TABLE } from './components/data-table.usage';
import { DEMOS_DESCRIPTIONS } from './components/descriptions.usage';
import { DEMOS_ITEM } from './components/item.usage';
import { DEMOS_LIST } from './components/list.usage';
import { resolveSize } from './pretui-primitives';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_DATA_TABLE, ...DEMOS_DESCRIPTIONS, ...DEMOS_ITEM, ...DEMOS_LIST };
const LISTING_USAGE_PAGES = ['DataTable', 'List', 'Item', 'Descriptions'];

/* eslint-disable @typescript-eslint/no-explicit-any -- a DEMOS registry is
   Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;

interface Lot {
  id: string;
  tea: string;
  place: string;
  kg: number;
}

const LOTS: Lot[] = [
  { id: 'B-1', tea: 'Gyokuro', place: 'Uji', kg: 61 },
  { id: 'B-2', tea: 'Da Hong Pao', place: 'Wuyishan', kg: 24 },
  { id: 'B-3', tea: 'Silver Needle', place: 'Fuding', kg: 88 },
];

const PLACE_OPTIONS = [
  { value: 'Uji', label: 'Uji' },
  { value: 'Wuyishan', label: 'Wuyishan' },
  { value: 'Fuding', label: 'Fuding' },
];

const COLUMNS: DataColumn<Lot>[] = [
  { key: 'id', label: 'Lot', width: '6em', alwaysVisible: true },
  { key: 'tea', label: 'Tea', filter: { kind: 'text' } },
  { key: 'place', label: 'Origin', filter: { kind: 'options', options: PLACE_OPTIONS } },
  { key: 'kg', label: 'Weight', align: 'end', sortable: true },
];

// Deliberately id-less, so `defaultRowKey` falls back to the index.
// rows deliberately missing `id`, typed as Lot so the same columns apply
const UNKEYED = LOTS.map((row) => ({
  tea: row.tea,
  place: row.place,
  kg: row.kg,
})) as unknown as Lot[];

const rowKey = (row: Lot): RowKey => row.id;
const rowLabel = (row: Lot): string => row.tea;

// ── scoped query helpers ────────────────────────────────────────────────
// Every query is scoped to the component root. An unscoped
// `document.querySelector('button')` can hit QUnit's own chrome and has hung
// the whole suite before.

function tableRoot(): HTMLElement {
  return document.querySelector('[data-test-pretui-datatable]') as HTMLElement;
}
function heads(): HTMLElement[] {
  return Array.from(
    tableRoot().querySelectorAll('[data-test-pretui-dt-head]'),
  ) as HTMLElement[];
}
function bodyRows(): HTMLElement[] {
  return Array.from(
    tableRoot().querySelectorAll('[data-test-pretui-dt-row]'),
  ) as HTMLElement[];
}
function cellTexts(index: number): string[] {
  return bodyRows().map((tr) => {
    let cells = Array.from(
      tr.querySelectorAll('[data-test-pretui-dt-cell]'),
    ) as HTMLElement[];
    return (cells[index]?.textContent ?? '').trim();
  });
}
function listRoot(): HTMLElement {
  return document.querySelector('[data-test-pretui-list]') as HTMLElement;
}
function listRows(): HTMLElement[] {
  return Array.from(
    listRoot().querySelectorAll('[data-test-pretui-list-row]'),
  ) as HTMLElement[];
}

class Knobs {
  @tracked selectionMode: 'none' | 'single' | 'multi' = 'none';
  @tracked visibleColumns: string[] | undefined = undefined;
  @tracked filters: FilterState | undefined = undefined;
  @tracked pageSize = 0;
  sorts: (SortState | null)[] = [];
  selections: RowKey[][] = [];
  filterLog: FilterState[] = [];
  expandLog: RowKey[][] = [];
  activations: string[] = [];
  onSortChange = (s: SortState | null) => this.sorts.push(s);
  onSelectionChange = (keys: RowKey[]) => this.selections.push(keys);
  onFiltersChange = (f: FilterState) => this.filterLog.push(f);
  onExpandedChange = (keys: RowKey[]) => this.expandLog.push(keys);
  onActivate = (row: Lot) => this.activations.push(row.id);
}

module('Pretui | reading-listing', function (hooks) {
  setupCardTest(hooks);

  // ── RowCursor (no DOM) ────────────────────────────────────────────────

  test('RowCursor clamps, moves and reports consumption', function (assert) {
    let count = 3;
    let cursor = new RowCursor(() => count);
    assert.strictEqual(cursor.active, 0, 'starts at the first row');
    assert.true(cursor.handleKey('ArrowDown'), 'ArrowDown is consumed');
    assert.strictEqual(cursor.active, 1);
    assert.true(cursor.handleKey('End'));
    assert.strictEqual(cursor.active, 2, 'End goes to the last row');
    assert.true(cursor.handleKey('ArrowDown'));
    assert.strictEqual(cursor.active, 2, 'does not run past the end');
    assert.false(cursor.handleKey('KeyQ'), 'an unknown key is not consumed');
    // The collection shrinks under the cursor — the clamp is what keeps a
    // stale index from pointing at nothing.
    count = 1;
    assert.strictEqual(cursor.active, 0, 'clamps when the collection shrinks');
  });

  test('resolveSize narrows every accepted spelling', function (assert) {
    assert.strictEqual(resolveSize(undefined), 'm');
    assert.strictEqual(resolveSize('sm'), 's');
    assert.strictEqual(resolveSize('md'), 'm');
    assert.strictEqual(resolveSize('lg'), 'l');
    assert.strictEqual(resolveSize('default'), 'm');
    assert.strictEqual(resolveSize('middle'), 'm');
    assert.strictEqual(resolveSize('xl'), 'xl');
    assert.strictEqual(resolveSize('nonsense'), 'm', 'unknown falls back');
  });

  // ── DataTable: header semantics ───────────────────────────────────────

  test('every header is a scoped th, and sortable ones carry aria-sort', async function (assert) {
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @caption='Lots'
        />
      </template>,
    );
    let hs = heads();
    assert.strictEqual(hs.length, 4, 'four data columns');
    for (let h of hs) {
      assert.strictEqual(h.getAttribute('scope'), 'col', 'th is scope=col');
      assert.strictEqual(
        h.getAttribute('aria-sort'),
        'none',
        'a sortable column says so before it is sorted',
      );
    }
    let caption = tableRoot().querySelector('caption');
    assert.strictEqual(
      (caption?.textContent ?? '').trim(),
      'Lots',
      'the caption is a real <caption>',
    );
    assert.dom('[data-test-pretui-datatable] table').doesNotHaveAttribute(
      'role',
      'role=grid is not claimed',
    );
  });

  test('a non-sortable column carries no aria-sort and no button', async function (assert) {
    const cols: DataColumn<Lot>[] = [
      { key: 'id', label: 'Lot', sortable: false },
      { key: 'tea', label: 'Tea' },
    ];
    await render(
      <template>
        <DataTable @columns={{cols}} @rows={{LOTS}} @key={{rowKey}} />
      </template>,
    );
    let hs = heads();
    assert.strictEqual(hs[0]?.hasAttribute('aria-sort'), false);
    assert.strictEqual(
      hs[0]?.querySelector('[data-test-pretui-dt-sort]'),
      null,
      'no sort control on a column that cannot sort',
    );
    assert.strictEqual(hs[1]?.getAttribute('aria-sort'), 'none');
  });

  test('the sort cycle is ascending then descending then unsorted, and aria-sort follows', async function (assert) {
    let knobs = new Knobs();
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @onSortChange={{knobs.onSortChange}}
        />
      </template>,
    );
    let weight = heads()[3] as HTMLElement;
    let button = weight.querySelector(
      '[data-test-pretui-dt-sort]',
    ) as HTMLElement;
    assert.strictEqual(button.tagName, 'BUTTON', 'the sort control is a button');

    await click(button);
    assert.strictEqual(weight.getAttribute('aria-sort'), 'ascending');
    assert.deepEqual(cellTexts(3), ['24', '61', '88'], 'rows sort ascending');

    await click(button);
    assert.strictEqual(weight.getAttribute('aria-sort'), 'descending');
    assert.deepEqual(cellTexts(3), ['88', '61', '24']);

    await click(button);
    assert.strictEqual(
      weight.getAttribute('aria-sort'),
      'none',
      'the third step returns to unsorted',
    );
    assert.deepEqual(cellTexts(3), ['61', '24', '88'], 'original order returns');
    assert.deepEqual(
      knobs.sorts.map((s) => (s ? s.key + ':' + s.dir : 'null')),
      ['kg:asc', 'kg:desc', 'null'],
      'every step reports, including the null one',
    );
  });

  test('the sort button announces the state it will move to', async function (assert) {
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{LOTS}} @key={{rowKey}} />
      </template>,
    );
    let button = (heads()[3] as HTMLElement).querySelector(
      '[data-test-pretui-dt-sort]',
    ) as HTMLElement;
    assert.true(
      (button.textContent ?? '').includes('activate to sort ascending'),
      'the hidden mirror names the next state, not just the current one',
    );
    await click(button);
    assert.true(
      (button.textContent ?? '').includes('sorted ascending'),
      'and updates with it',
    );
  });

  // ── DataTable: selection ──────────────────────────────────────────────

  test('row selection carries aria-selected, a named checkbox, and a mixed select-all', async function (assert) {
    let knobs = new Knobs();
    knobs.selectionMode = 'multi';
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @rowLabel={{rowLabel}}
          @selectionMode={{knobs.selectionMode}}
          @onSelectionChange={{knobs.onSelectionChange}}
        />
      </template>,
    );
    let rows = bodyRows();
    assert.strictEqual(
      rows[0]?.getAttribute('aria-selected'),
      'false',
      'a selectable row advertises its state before anything is picked',
    );
    let boxes = Array.from(
      tableRoot().querySelectorAll('[data-test-pretui-dt-select]'),
    ) as HTMLInputElement[];
    assert.strictEqual(
      boxes[0]?.getAttribute('aria-label'),
      'Gyokuro',
      'the per-row control is named by the row, not "Select row"',
    );

    await click(boxes[0] as HTMLElement);
    assert.strictEqual(bodyRows()[0]?.getAttribute('aria-selected'), 'true');
    assert.strictEqual(bodyRows()[0]?.getAttribute('data-selected'), 'true');
    assert.deepEqual(knobs.selections[0], ['B-1']);

    let all = tableRoot().querySelector(
      '[data-test-pretui-dt-selectall]',
    ) as HTMLInputElement;
    assert.true(all.indeterminate, 'a partial selection is genuinely mixed');
    assert.strictEqual(
      all.getAttribute('aria-label'),
      'Select all 3 results',
      'select-all names the count it covers, so it cannot be mistaken for "these rows"',
    );
    await click(all);
    assert.deepEqual(
      knobs.selections[knobs.selections.length - 1],
      ['B-1', 'B-2', 'B-3'],
      'select-all takes every visible row',
    );
    assert.false(
      (
        tableRoot().querySelector(
          '[data-test-pretui-dt-selectall]',
        ) as HTMLInputElement
      ).indeterminate,
      'and stops being mixed once it is whole',
    );
  });

  test('row identity is absolute across pages, so selection does not leak', async function (assert) {
    let knobs = new Knobs();
    knobs.pageSize = 2;
    knobs.selectionMode = 'multi';
    // No @key and no `id` on the rows: the documented fallback is then the
    // row INDEX, which is exactly the case a page-local index would break.
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{UNKEYED}}
          @selectionMode={{knobs.selectionMode}}
          @pageSize={{knobs.pageSize}}
          @onSelectionChange={{knobs.onSelectionChange}}
        />
      </template>,
    );
    await click(
      tableRoot().querySelector('[data-test-pretui-dt-select]') as HTMLElement,
    );
    assert.deepEqual(knobs.selections[0], [0], 'page 1 row 1 keys to index 0');
    let pager = document.querySelector(
      '[data-test-pretui-pagination]',
    ) as HTMLElement;
    let pages = Array.from(pager.querySelectorAll('button'));
    await click(pages[2] as HTMLElement);
    assert.strictEqual(bodyRows().length, 1, 'page 2 holds the last row');
    assert.strictEqual(
      bodyRows()[0]?.getAttribute('aria-selected'),
      'false',
      'page 2 row 1 is a different record, not the same index',
    );
  });

  test('a non-selectable table advertises no selection state at all', async function (assert) {
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{LOTS}} @key={{rowKey}} />
      </template>,
    );
    assert.false(
      (bodyRows()[0] as HTMLElement).hasAttribute('aria-selected'),
      'no aria-selected when nothing can be selected',
    );
    assert.strictEqual(
      tableRoot().querySelector('[data-test-pretui-dt-select]'),
      null,
    );
  });

  // ── DataTable: column visibility ──────────────────────────────────────

  test('column visibility is controlled, and alwaysVisible columns cannot leave', async function (assert) {
    let knobs = new Knobs();
    knobs.visibleColumns = ['tea'];
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @visibleColumns={{knobs.visibleColumns}}
        />
      </template>,
    );
    let labels = heads().map((h) => (h.textContent ?? '').trim().split('\n')[0]);
    assert.strictEqual(heads().length, 2, 'Lot survives, Origin and Weight go');
    assert.true(
      (labels[0] ?? '').startsWith('Lot'),
      'the alwaysVisible column stays',
    );
  });

  test('a column marked hidden starts out of the table but stays in the model', async function (assert) {
    const cols: DataColumn<Lot>[] = [
      { key: 'id', label: 'Lot' },
      { key: 'tea', label: 'Tea', hidden: true },
    ];
    await render(
      <template>
        <DataTable @columns={{cols}} @rows={{LOTS}} @key={{rowKey}} />
      </template>,
    );
    assert.strictEqual(heads().length, 1);
    assert.dom('[data-test-pretui-dt-columns]').exists(
      'the column switcher is offered because something is hideable',
    );
  });

  // ── DataTable: filters ────────────────────────────────────────────────

  test('a text filter narrows the rows, reports, and offers a way out when it matches nothing', async function (assert) {
    let knobs = new Knobs();
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @itemNoun='lot'
          @onFiltersChange={{knobs.onFiltersChange}}
        />
      </template>,
    );
    let field = tableRoot().querySelector(
      '[data-test-pretui-dt-filter]',
    ) as HTMLInputElement;
    assert.ok(field, 'a filterable column gets a labelled toolbar control');

    await fillIn(field, 'silver');
    assert.strictEqual(bodyRows().length, 1, 'contains match, case-insensitive');
    assert.deepEqual(knobs.filterLog[0], { tea: 'silver' });
    assert.dom('[data-test-pretui-dt-live]').hasText(
      '1 of 3 lots',
      'the count is honest about what was filtered away',
    );

    await fillIn(field, 'nothing at all');
    assert.strictEqual(bodyRows().length, 0);
    assert.dom('[data-test-pretui-dt-noresults]').exists(
      'a filtered-empty table is its own state, not the empty dataset',
    );
    await click('[data-test-pretui-dt-clear]');
    assert.strictEqual(bodyRows().length, 3, 'clearing brings every row back');
  });

  test('an options filter is applied from controlled state', async function (assert) {
    let knobs = new Knobs();
    knobs.filters = { place: ['Uji', 'Fuding'] };
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @filters={{knobs.filters}}
        />
      </template>,
    );
    assert.strictEqual(bodyRows().length, 2);
    let origin = heads()[2] as HTMLElement;
    assert.strictEqual(
      origin.getAttribute('data-filtered'),
      'true',
      'the filtered column is marked in the header, not only in the toolbar',
    );
  });

  test('a column filter can replace the matcher entirely', async function (assert) {
    const cols: DataColumn<Lot>[] = [
      { key: 'tea', label: 'Tea' },
      {
        key: 'kg',
        label: 'Weight',
        filter: {
          kind: 'text',
          match: (row: Lot, value) => row.kg > Number(value),
        },
      },
    ];
    const filters: FilterState = { kg: '50' };
    await render(
      <template>
        <DataTable
          @columns={{cols}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @filters={{filters}}
        />
      </template>,
    );
    assert.strictEqual(bodyRows().length, 2, 'only the lots over 50kg');
  });

  // ── DataTable: expansion ──────────────────────────────────────────────

  test('the expander is a button whose aria-controls names the detail row', async function (assert) {
    let knobs = new Knobs();
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @rowLabel={{rowLabel}}
          @onExpandedChange={{knobs.onExpandedChange}}
        >
          <:expanded as |row|>
            <p data-test-detail>{{row.place}}</p>
          </:expanded>
        </DataTable>
      </template>,
    );
    let toggle = tableRoot().querySelector(
      '[data-test-pretui-dt-expand]',
    ) as HTMLElement;
    assert.strictEqual(toggle.tagName, 'BUTTON');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(
      toggle.getAttribute('aria-label'),
      'Expand Gyokuro',
      'the expander is named by its row',
    );

    await click(toggle);
    let controls = toggle.getAttribute('aria-controls') as string;
    let detail = tableRoot().querySelector('#' + controls) as HTMLElement;
    assert.ok(detail, 'aria-controls resolves to a real element');
    assert.dom(detail.querySelector('[data-test-detail]')).hasText('Uji');
    assert.strictEqual(
      detail.querySelector('td')?.getAttribute('colspan'),
      '5',
      'the detail cell spans the expander plus four data columns',
    );
    assert.deepEqual(knobs.expandLog[0], ['B-1']);
  });

  // ── DataTable: pinning ────────────────────────────────────────────────

  test('a pinned column pins, and a pinned column behind an unmeasurable one does not', async function (assert) {
    const cols: DataColumn<Lot>[] = [
      { key: 'id', label: 'Lot', width: '6em', pin: 'start' },
      { key: 'tea', label: 'Tea', pin: 'start' },
      { key: 'place', label: 'Origin', pin: 'start' },
      { key: 'kg', label: 'Weight' },
    ];
    await render(
      <template>
        <DataTable @columns={{cols}} @rows={{LOTS}} @key={{rowKey}} />
      </template>,
    );
    let hs = heads();
    assert.strictEqual(hs[0]?.getAttribute('data-pin'), 'start', 'first pins');
    assert.strictEqual(
      hs[1]?.getAttribute('data-pin'),
      'start',
      'the second pins off the first column’s declared width',
    );
    assert.strictEqual(
      hs[2]?.getAttribute('data-pin'),
      null,
      'the third cannot be placed behind an unmeasurable column, so it is left unpinned rather than overlapping',
    );
    assert.true(
      (hs[1]?.getAttribute('style') ?? '').includes('inset-inline-start'),
      'the offset is a logical inset, so RTL is free',
    );
  });

  // ── DataTable: chrome ─────────────────────────────────────────────────

  test('the scroll container is a named region that the keyboard can reach', async function (assert) {
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @label='Lots on the desk'
        />
      </template>,
    );
    let region = tableRoot().querySelector('[role="region"]') as HTMLElement;
    assert.strictEqual(region.getAttribute('aria-label'), 'Lots on the desk');
    assert.strictEqual(region.tabIndex, 0, 'a scrollable box needs a tab stop');
  });

  test('paging slices the rows and the count stays honest', async function (assert) {
    let knobs = new Knobs();
    knobs.pageSize = 2;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{LOTS}}
          @key={{rowKey}}
          @itemNoun='lot'
          @pageSize={{knobs.pageSize}}
        />
      </template>,
    );
    assert.strictEqual(bodyRows().length, 2, 'one page of two');
    assert.dom('[data-test-pretui-pagination]').exists('paging composes Pagination');
    assert
      .dom('[data-test-pretui-pagination] button[data-state="active"]')
      .hasAttribute(
        'aria-current',
        'page',
        'the current page is exposed to assistive technology',
      );
    assert
      .dom(
        '[data-test-pretui-pagination] button[aria-label^="Page "]:not([data-state="active"])',
      )
      .doesNotHaveAttribute(
        'aria-current',
        'inactive page buttons omit aria-current',
      );
    assert.dom('[data-test-pretui-dt-live]').hasText(
      '3 lots',
      'the announcement counts the result set, not the page',
    );
  });

  test('an empty dataset gets the empty state, never a filtered-empty one', async function (assert) {
    const none: Lot[] = [];
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{none}} @key={{rowKey}} />
      </template>,
    );
    assert.dom('[data-test-pretui-empty]').exists();
    assert.dom('[data-test-pretui-dt-noresults]').doesNotExist();
  });

  // ── List ──────────────────────────────────────────────────────────────

  test('List is a real ul/li with one tab stop and arrow navigation', async function (assert) {
    await render(
      <template>
        <List @items={{LOTS}} @key={{rowKey}} @label='Lots'>
          <:item as |row|>{{row.tea}}</:item>
        </List>
      </template>,
    );
    let list = listRoot().querySelector('ul') as HTMLElement;
    assert.strictEqual(list.getAttribute('aria-label'), 'Lots');
    assert.strictEqual(
      list.getAttribute('role'),
      null,
      'a list of rich rows is a list, not a listbox',
    );
    let rows = listRows();
    assert.strictEqual(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.tabIndex),
      [0, -1, -1],
      'exactly one row is in the tab sequence',
    );

    (rows[0] as HTMLElement).focus();
    await triggerKeyEvent(rows[0] as HTMLElement, 'keydown', 'ArrowDown');
    assert.deepEqual(
      listRows().map((r) => r.tabIndex),
      [-1, 0, -1],
      'the tab stop roves with the cursor',
    );
    await triggerKeyEvent(listRows()[1] as HTMLElement, 'keydown', 'End');
    assert.deepEqual(listRows().map((r) => r.tabIndex), [-1, -1, 0]);
    await triggerKeyEvent(listRows()[2] as HTMLElement, 'keydown', 'Home');
    assert.deepEqual(listRows().map((r) => r.tabIndex), [0, -1, -1]);
  });

  test('List selection is a named control, and Space toggles it from the row', async function (assert) {
    let knobs = new Knobs();
    knobs.selectionMode = 'multi';
    await render(
      <template>
        <List
          @items={{LOTS}}
          @key={{rowKey}}
          @rowLabel={{rowLabel}}
          @selectionMode={{knobs.selectionMode}}
          @onSelectionChange={{knobs.onSelectionChange}}
        >
          <:item as |row|>{{row.tea}}</:item>
        </List>
      </template>,
    );
    let picks = Array.from(
      listRoot().querySelectorAll('[data-test-pretui-list-select]'),
    ) as HTMLInputElement[];
    assert.strictEqual(picks[0]?.type, 'checkbox');
    assert.strictEqual(picks[0]?.getAttribute('aria-label'), 'Gyokuro');

    let first = listRows()[0] as HTMLElement;
    first.focus();
    await triggerKeyEvent(first, 'keydown', ' ');
    assert.deepEqual(knobs.selections[0], ['B-1'], 'Space selects the row');
    assert.strictEqual(listRows()[0]?.getAttribute('data-selected'), 'true');

    await click(
      listRoot().querySelectorAll(
        '[data-test-pretui-list-select]',
      )[1] as HTMLElement,
    );
    assert.deepEqual(knobs.selections[1], ['B-1', 'B-2']);
  });

  test('single-select uses radios, and Enter activates rather than selects', async function (assert) {
    let knobs = new Knobs();
    knobs.selectionMode = 'single';
    await render(
      <template>
        <List
          @items={{LOTS}}
          @key={{rowKey}}
          @rowLabel={{rowLabel}}
          @selectionMode={{knobs.selectionMode}}
          @onActivate={{knobs.onActivate}}
        >
          <:item as |row|>{{row.tea}}</:item>
        </List>
      </template>,
    );
    let picks = Array.from(
      listRoot().querySelectorAll('[data-test-pretui-list-select]'),
    ) as HTMLInputElement[];
    assert.strictEqual(picks[0]?.type, 'radio');
    assert.strictEqual(
      picks[0]?.name,
      picks[1]?.name,
      'one radio group, so the browser enforces the single choice',
    );
    let first = listRows()[0] as HTMLElement;
    first.focus();
    await triggerKeyEvent(first, 'keydown', 'Enter');
    assert.deepEqual(knobs.activations, ['B-1']);
  });

  test('a click on a List row activates it, but a click on its radio only selects', async function (assert) {
    let knobs = new Knobs();
    knobs.selectionMode = 'single';
    await render(
      <template>
        <List @items={{LOTS}} @key={{rowKey}} @rowLabel={{rowLabel}} @selectionMode={{knobs.selectionMode}} @onActivate={{knobs.onActivate}}>
          <:item as |row|><span data-test-tea>{{row.tea}}</span></:item>
        </List>
      </template>,
    );
    await click(listRoot().querySelectorAll('[data-test-tea]')[1] as HTMLElement);
    assert.deepEqual(knobs.activations, ['B-2'], 'the row text activates');
    await click(listRoot().querySelectorAll('[data-test-pretui-list-select]')[0] as HTMLElement);
    assert.deepEqual(knobs.activations, ['B-2'], 'the radio does not');
  });

  test('List yields the row API and shows an empty state', async function (assert) {
    const none: Lot[] = [];
    await render(
      <template>
        <List @items={{none}} @key={{rowKey}}>
          <:item as |row|>{{row.tea}}</:item>
        </List>
      </template>,
    );
    assert.dom('[data-test-pretui-empty]').exists();
    assert.strictEqual(listRoot().querySelector('ul'), null);
  });

  // ── Item ──────────────────────────────────────────────────────────────

  test('Item renders title and description without inventing a heading', async function (assert) {
    await render(
      <template>
        <Item @title='Gyokuro' @description='Uji Valley Growers' />
      </template>,
    );
    let root = document.querySelector('[data-test-pretui-item]') as HTMLElement;
    assert.dom(root).hasText('Gyokuro Uji Valley Growers');
    assert.strictEqual(
      root.querySelector('h1, h2, h3, h4, h5, h6'),
      null,
      'no heading is emitted — Ant hard-codes an h4 here',
    );
    assert.strictEqual(root.querySelector('li'), null, 'Item is not an li');
  });

  test('Item with @href makes the title a real link', async function (assert) {
    await render(
      <template><Item @title='Gyokuro' @href='/lots/B-1' /></template>,
    );
    let root = document.querySelector('[data-test-pretui-item]') as HTMLElement;
    let link = root.querySelector('a') as HTMLAnchorElement;
    assert.strictEqual(link.getAttribute('href'), '/lots/B-1');
    assert.dom(link).hasText('Gyokuro');
  });

  // ── Descriptions ──────────────────────────────────────────────────────

  test('Descriptions is a description list, not a table', async function (assert) {
    const items: DescriptionsItem[] = [
      { label: 'Lot', value: 'B-1', mono: true },
      { label: 'Tea', value: 'Gyokuro' },
      { label: 'Note', value: 'Bright', span: 'fill' },
      { label: 'Empty', value: undefined },
    ];
    await render(
      <template>
        <Descriptions @items={{items}} @columns={{3}} @bordered={{true}} @title='Lot record' />
      </template>,
    );
    let root = document.querySelector(
      '[data-test-pretui-descriptions]',
    ) as HTMLElement;
    assert.ok(root.querySelector('dl'), 'a dl in every mode, bordered or not');
    assert.strictEqual(root.querySelector('table'), null, 'never a table');
    let terms = Array.from(root.querySelectorAll('dt')).map((n) =>
      (n.textContent ?? '').trim(),
    );
    assert.deepEqual(terms, ['Lot', 'Tea', 'Note', 'Empty']);
    let pairs = Array.from(
      root.querySelectorAll('[data-test-pretui-descriptions-pair]'),
    ) as HTMLElement[];
    assert.strictEqual(pairs[2]?.getAttribute('data-span'), 'fill');
    assert.strictEqual(root.getAttribute('data-bordered'), 'true');
    assert.strictEqual(
      (root.querySelectorAll('dd')[3]?.textContent ?? '').trim(),
      '—',
      'a missing value is the placeholder, never the string "undefined"',
    );
  });

  test('Descriptions colon is decorative and the value block wins over the string', async function (assert) {
    const items: DescriptionsItem[] = [{ label: 'Lot', value: 'B-1' }];
    await render(
      <template>
        <Descriptions @items={{items}} @colon={{true}}>
          <:value as |item|><b data-test-value>{{item.label}} block</b></:value>
        </Descriptions>
      </template>,
    );
    let root = document.querySelector(
      '[data-test-pretui-descriptions]',
    ) as HTMLElement;
    assert.dom(root.querySelector('[data-test-value]')).hasText('Lot block');
    let colon = root.querySelector('[data-test-pretui-descriptions-colon]') as HTMLElement;
    assert.strictEqual(
      colon.getAttribute('aria-hidden'),
      'true',
      'the colon is punctuation, not content',
    );
  });
});

// ── the usage pages ─────────────────────────────────────────────────────
// A clean index proves the module evaluates, not that a page renders. This
// mounts all four, which is the only evidence that counts. It is the same
// job forms-render.test.gts does for the gallery; that file belongs to the
// integrator, so the registry is proved here until it is wired in.

module('Pretui | reading-listing | controlled selection', function (hooks) {
  setupCardTest(hooks);

  test('a controlled row checkbox stays on @selected when the owner ignores the change', async function (assert) {
    const NONE: RowKey[] = [];
    let asked: RowKey[][] = [];
    let ignore = (keys: RowKey[]) => asked.push(keys);
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{LOTS}} @key={{rowKey}} @rowLabel={{rowLabel}} @selectionMode='multi' @selected={{NONE}} @onSelectionChange={{ignore}} />
      </template>,
    );
    let box = document.querySelector('[data-test-pretui-dt-select]') as HTMLInputElement;
    await click(box);
    assert.strictEqual(asked.length, 1, 'the owner is asked');
    assert.false(box.checked, 'and the box did not drift');
  });

  test('a rejected radio change keeps the owner\'s radio checked', async function (assert) {
    const HELD: RowKey[] = ['B-2'];
    let ignore = () => {};
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{LOTS}} @key={{rowKey}} @rowLabel={{rowLabel}} @selectionMode='single' @selected={{HELD}} @onSelectionChange={{ignore}} />
      </template>,
    );
    let radios = () => Array.from(document.querySelectorAll('input.pretui-dt-radio')) as HTMLInputElement[];
    let held = radios().findIndex((r) => r.checked);
    let other = held === 0 ? 1 : 0;
    await click(radios()[other] as HTMLElement);
    assert.true(radios()[held]?.checked, 'the held row is still checked');
    assert.false(radios()[other]?.checked, 'the clicked one is not');
  });

  test('a rejected select-all keeps the box indeterminate', async function (assert) {
    const SOME: RowKey[] = ['B-2'];
    let ignore = () => {};
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{LOTS}} @key={{rowKey}} @rowLabel={{rowLabel}} @selectionMode='multi' @selected={{SOME}} @onSelectionChange={{ignore}} />
      </template>,
    );
    let all = document.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
    assert.true(all.indeterminate, 'some selected at rest');
    await click(all);
    assert.false(all.checked, 'not all selected');
    assert.true(all.indeterminate, 'and still reads as some');
  });
});

module('Pretui | reading-listing | usage pages', function (hooks) {
  setupCardTest(hooks);

  for (let name of LISTING_USAGE_PAGES) {
    test(name + ' usage page renders', async function (assert) {
      let Page = PAGES[name] as AnyComponent;
      assert.ok(Page, name + ' present');
      await render(<template><Page /></template>);
      assert.ok(
        document.querySelector('[data-test-pretui-usage]'),
        name + ' rendered a FreestyleUsage shell',
      );
    });
  }
});
