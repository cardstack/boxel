// Pretui — StatementTable unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>` is inert in this
// harness (the scoped-css attribute is stamped, the rules are not applied). What is asserted is
// the markup a reader, a screen reader and a test suite depend on.
import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { StatementTable } from './statement-table';
import type { StatementColumn, StatementRow } from './statement-table';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return [...document.querySelectorAll(sel)] as HTMLElement[];
}
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const COLS: StatementColumn[] = [
  { key: 'code', label: 'No.', kind: 'code' },
  { key: 'name', label: 'Account' },
  { key: 'amount', label: 'Amount', kind: 'amount' },
];
const ROWS: StatementRow[] = [
  { key: 'h', role: 'heading', cells: { code: 'Income' } },
  {
    key: '4000',
    depth: 1,
    cells: { code: '4000', name: 'Loose-leaf sales', amount: 481200 },
    data: { row: true, key: '4000', total: 481200 },
  },
  {
    key: '5200',
    depth: 1,
    cells: { code: '5200', name: 'Count adjustment', amount: 0 },
  },
  {
    key: 't',
    role: 'subtotal',
    cells: { name: 'Total income', amount: 481200 },
  },
  { key: 'net', role: 'total', cells: { name: 'Net income', amount: -16800 } },
];

const shown = (value: unknown) => String(value ?? '');

module('Pretui | components/statement-table', function (hooks) {
  setupCardTest(hooks);

  test('columns are real column headers and lines are rows of cells', async function (assert) {
    await render(
      <template>
        <StatementTable @label='P&L' @columns={{COLS}} @rows={{ROWS}} />
      </template>,
    );
    let heads = all('[data-test-pretui-statement-table] thead th');
    assert.deepEqual(
      heads.map((h) => h.getAttribute('scope')),
      ['col', 'col', 'col'],
      'every column header is scoped to its column',
    );
    assert.deepEqual(heads.map(text), ['No.', 'Account', 'Amount']);
    assert.strictEqual(all('tbody tr').length, 5, 'one tr per row');
  });

  test('a heading spans the table and reads its title from the first column', async function (assert) {
    await render(
      <template>
        <StatementTable @label='P&L' @columns={{COLS}} @rows={{ROWS}} />
      </template>,
    );
    let th = q('tr[data-role="heading"] th');
    assert.strictEqual(th.getAttribute('scope'), 'rowgroup');
    assert.strictEqual(
      th.getAttribute('colspan'),
      '3',
      'it spans every column',
    );
    assert.strictEqual(text(th), 'Income');
  });

  test('a subtotal and a total are named by a row header on their label; a line has none', async function (assert) {
    await render(
      <template>
        <StatementTable @label='P&L' @columns={{COLS}} @rows={{ROWS}} />
      </template>,
    );
    let subtotal = q('tr[data-role="subtotal"] th[scope="row"]');
    assert.strictEqual(
      text(subtotal),
      'Total income',
      'the label cell is the header, past the empty code column',
    );
    assert.strictEqual(
      all('tr[data-role="subtotal"] th').length,
      1,
      'one row header',
    );
    assert.strictEqual(
      text(q('tr[data-role="total"] th[scope="row"]')),
      'Net income',
    );
    assert.strictEqual(
      all('tr[data-role="line"] th').length,
      0,
      'a line has no row header',
    );
  });

  test('amounts are cents set as currency; a negative balance is in parentheses and spoken with a minus', async function (assert) {
    await render(
      <template>
        <StatementTable
          @label='P&L'
          @columns={{COLS}}
          @rows={{ROWS}}
          @locale='en-US'
        />
      </template>,
    );
    assert.strictEqual(
      text(q('tr[data-key="4000"] td[data-kind="amount"]')),
      '$4,812.00',
      '481200 cents',
    );
    let net = q('tr[data-role="total"] [data-kind="amount"]');
    assert.ok(
      text(net.querySelector('[aria-hidden="true"]')).includes('($168.00)'),
      'the eye sees parentheses',
    );
    assert.strictEqual(
      text(net.querySelector('[data-test-pretui-statement-sr]')),
      '-$168.00',
      'a screen reader hears the minus',
    );
  });

  test('a malformed @locale still renders the table and its spoken negatives', async function (assert) {
    await render(
      <template>
        <StatementTable
          @label='P&L'
          @columns={{COLS}}
          @rows={{ROWS}}
          @locale='en_US'
        />
      </template>,
    );
    let net = q('tr[data-role="total"]');
    assert.ok(net, 'the table rendered');
    assert.ok(
      text(net.querySelector('[data-test-pretui-statement-sr]')).length > 0,
      'the negative still has its spoken mirror',
    );
  });

  test('@negative="minus" sets a negative with a sign and no mirror', async function (assert) {
    await render(
      <template>
        <StatementTable
          @label='P&L'
          @columns={{COLS}}
          @rows={{ROWS}}
          @negative='minus'
          @locale='en-US'
        />
      </template>,
    );
    let net = q('tr[data-role="total"] [data-kind="amount"]');
    assert.strictEqual(text(net), '-$168.00');
    assert.notOk(
      net.querySelector('[data-test-pretui-statement-sr]'),
      'nothing to mirror',
    );
  });

  test('zero is blank by default, a dash or a figure on request', async function (assert) {
    await render(
      <template>
        <StatementTable
          @label='a'
          @columns={{COLS}}
          @rows={{ROWS}}
          @locale='en-US'
        />
      </template>,
    );
    assert.strictEqual(
      text(q('tr[data-role="line"]:nth-of-type(3) [data-kind="amount"]')),
      '',
      'blank',
    );
    await render(
      <template>
        <StatementTable
          @label='b'
          @columns={{COLS}}
          @rows={{ROWS}}
          @zero='dash'
          @locale='en-US'
        />
      </template>,
    );
    assert.strictEqual(
      text(q('tr[data-role="line"]:nth-of-type(3) [data-kind="amount"]')),
      '—',
      'a dash',
    );
    await render(
      <template>
        <StatementTable
          @label='c'
          @columns={{COLS}}
          @rows={{ROWS}}
          @zero='show'
          @locale='en-US'
        />
      </template>,
    );
    assert.strictEqual(
      text(q('tr[data-role="line"]:nth-of-type(3) [data-kind="amount"]')),
      '$0.00',
      'a figure',
    );
  });

  test('a change column always shows its sign and never uses parentheses', async function (assert) {
    let cols: StatementColumn[] = [
      { key: 'name', label: 'Line' },
      { key: 'v', label: 'Variance', kind: 'amount', sign: 'change' },
    ];
    let rows: StatementRow[] = [
      { key: 'a', cells: { name: 'Over', v: -8000 } },
      { key: 'b', cells: { name: 'Under', v: 12000 } },
    ];
    await render(
      <template>
        <StatementTable
          @label='v'
          @columns={{cols}}
          @rows={{rows}}
          @locale='en-US'
        />
      </template>,
    );
    let cells = all('td[data-kind="amount"]').map(text);
    assert.deepEqual(cells, ['-$80.00', '+$120.00']);
  });

  test('scale reads a percent held in basis points and a quantity held in thousandths', async function (assert) {
    let cols: StatementColumn[] = [
      { key: 'p', label: '%', kind: 'percent', scale: 4 },
      { key: 'q', label: 'Kg', kind: 'quantity', scale: 3, digits: 1 },
    ];
    let rows: StatementRow[] = [{ key: 'a', cells: { p: 4320, q: 12500 } }];
    await render(
      <template>
        <StatementTable
          @label='s'
          @columns={{cols}}
          @rows={{rows}}
          @locale='en-US'
        />
      </template>,
    );
    assert.deepEqual(all('td').map(text), ['43.2%', '12.5']);
  });

  test('data lands on the row as kebab-case data attributes; null, undefined and false are left off', async function (assert) {
    let rows: StatementRow[] = [
      {
        key: 'a',
        cells: { name: 'x' },
        data: {
          row: true,
          key: '4000',
          drMinor: 12,
          skipped: false,
          gone: null,
        },
      },
    ];
    await render(
      <template>
        <StatementTable @label='d' @columns={{COLS}} @rows={{rows}} />
      </template>,
    );
    let tr = q('tbody tr');
    assert.strictEqual(
      tr.getAttribute('data-row'),
      '',
      'true is a bare attribute',
    );
    assert.strictEqual(tr.getAttribute('data-key'), '4000');
    assert.strictEqual(
      tr.getAttribute('data-dr-minor'),
      '12',
      'camelCase becomes kebab-case',
    );
    assert.notOk(tr.hasAttribute('data-skipped'));
    assert.notOk(tr.hasAttribute('data-gone'));
  });

  test('a custom column yields its value, the row and the column to <:cell>', async function (assert) {
    let cols: StatementColumn[] = [
      { key: 'name', label: 'Line' },
      { key: 'flag', label: 'Flag', kind: 'custom' },
    ];
    let rows: StatementRow[] = [
      { key: 'a', cells: { name: 'Leaf', flag: 'Over budget' } },
    ];
    await render(
      <template>
        <StatementTable @label='c' @columns={{cols}} @rows={{rows}}>
          <:cell as |value row column|><b data-test-flag>{{shown
                value
              }}·{{row.key}}·{{column.key}}</b></:cell>
        </StatementTable>
      </template>,
    );
    assert.strictEqual(text(q('[data-test-flag]')), 'Over budget·a·flag');
  });

  test('@onRowSelect makes each line’s first cell a button that hands back the row; totals never drill', async function (assert) {
    let picked: string[] = [];
    let onSelect = (row: StatementRow) => picked.push(row.key);
    await render(
      <template>
        <StatementTable
          @label='p'
          @columns={{COLS}}
          @rows={{ROWS}}
          @onRowSelect={{onSelect}}
        />
      </template>,
    );
    let buttons = all('tbody button');
    assert.strictEqual(
      buttons.length,
      2,
      'one per line, none on headings, subtotals or totals',
    );
    await click(buttons[0]);
    assert.deepEqual(picked, ['4000']);
  });

  test('a selectable figure keeps its format inside the button', async function (assert) {
    let onSelect = () => {};
    await render(
      <template>
        <StatementTable
          @label='p'
          @columns={{COLS}}
          @rows={{ROWS}}
          @onRowSelect={{onSelect}}
          @selectColumn='amount'
          @locale='en-US'
        />
      </template>,
    );
    assert.strictEqual(text(all('tbody button')[0]), '$4,812.00');
  });

  test('a named table is a reachable scroll region; an unnamed one is not', async function (assert) {
    await render(
      <template>
        <StatementTable @label='Ledger' @columns={{COLS}} @rows={{ROWS}} />
      </template>,
    );
    let region = q('[data-test-pretui-statement-scroll]');
    assert.strictEqual(region.getAttribute('role'), 'region');
    assert.strictEqual(region.getAttribute('tabindex'), '0');
    assert.strictEqual(region.getAttribute('aria-label'), 'Ledger');
    assert.strictEqual(
      q('table').getAttribute('aria-label'),
      'Ledger',
      'the label names the table too',
    );
    await render(
      <template><StatementTable @columns={{COLS}} @rows={{ROWS}} /></template>,
    );
    assert.notOk(q('[data-test-pretui-statement-scroll]').hasAttribute('role'));
    assert.notOk(
      q('[data-test-pretui-statement-scroll]').hasAttribute('tabindex'),
    );
  });

  test('a table named by @labelledBy is a reachable region named the same way', async function (assert) {
    await render(
      <template>
        <h2 id='ledger-heading'>Ledger</h2>
        <StatementTable
          @labelledBy='ledger-heading'
          @columns={{COLS}}
          @rows={{ROWS}}
        />
      </template>,
    );
    let region = q('[data-test-pretui-statement-scroll]');
    assert.strictEqual(region.getAttribute('role'), 'region');
    assert.strictEqual(region.getAttribute('tabindex'), '0');
    assert.strictEqual(
      region.getAttribute('aria-labelledby'),
      'ledger-heading',
    );
    assert.strictEqual(
      q('table').getAttribute('aria-labelledby'),
      'ledger-heading',
    );
  });

  test('@caption renders a real caption, and wins over @label for the table’s name', async function (assert) {
    await render(
      <template>
        <StatementTable
          @caption='Owed to suppliers'
          @label='ignored'
          @columns={{COLS}}
          @rows={{ROWS}}
        />
      </template>,
    );
    let table = q('table');
    assert.strictEqual(table.firstElementChild?.tagName, 'CAPTION');
    assert.strictEqual(text(table.firstElementChild), 'Owed to suppliers');
    assert.notOk(table.hasAttribute('aria-label'));
  });

  test('a secondary column marks its header and cells for the narrow fold', async function (assert) {
    let cols: StatementColumn[] = [
      { key: 'name', label: 'Line' },
      { key: 'q2', label: 'Q2', kind: 'amount', priority: 'secondary' },
    ];
    let rows: StatementRow[] = [{ key: 'a', cells: { name: 'x', q2: 100 } }];
    await render(
      <template>
        <StatementTable @label='n' @columns={{cols}} @rows={{rows}} />
      </template>,
    );
    assert.strictEqual(
      q('thead th:last-child').getAttribute('data-priority'),
      'secondary',
    );
    assert.strictEqual(
      q('tbody td:last-child').getAttribute('data-priority'),
      'secondary',
    );
  });

  test('a row with children opens in place behind a disclosure button', async function (assert) {
    let rows: StatementRow[] = [
      {
        key: '4000',
        cells: { code: '4000', name: 'Loose-leaf sales', amount: 900 },
        children: [
          { key: 'jan', cells: { name: 'January', amount: 400 } },
          { key: 'feb', cells: { name: 'February', amount: 500 } },
        ],
      },
      { key: 'total', role: 'total', cells: { name: 'Total', amount: 900 } },
    ];
    let label = (row: StatementRow) => `Show ${row.cells['name']} by month`;
    await render(
      <template>
        <StatementTable
          @label='x'
          @columns={{COLS}}
          @rows={{rows}}
          @expandLabel={{label}}
        />
      </template>,
    );
    let toggle = q('[aria-label="Show Loose-leaf sales by month"]');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(all('tr[data-child]').length, 0, 'closed');
    await click(toggle);
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      all('tr[data-child]').map((tr) =>
        text(tr.querySelector('td:nth-child(2)')),
      ),
      ['January', 'February'],
    );
    assert.ok(
      toggle
        .getAttribute('aria-controls')!
        .split(' ')
        .every((id) => document.getElementById(id)),
      'it names the rows it opens',
    );
    assert.strictEqual(
      q('tr[data-child]').getAttribute('data-depth'),
      '1',
      'children sit one level deeper',
    );
  });

  test('@expanded controls which rows are open, and @onExpandedChange hears the toggle', async function (assert) {
    let rows: StatementRow[] = [
      {
        key: 'a',
        cells: { name: 'A' },
        children: [{ key: 'x', cells: { name: 'X' } }],
      },
    ];
    let heard: string[][] = [];
    let open = ['a'];
    let onChange = (keys: string[]) => heard.push(keys);
    await render(
      <template>
        <StatementTable
          @label='x'
          @columns={{COLS}}
          @rows={{rows}}
          @expanded={{open}}
          @onExpandedChange={{onChange}}
        />
      </template>,
    );
    assert.strictEqual(
      all('tr[data-child]').length,
      1,
      'open because @expanded says so',
    );
    await click(q('tbody button'));
    assert.deepEqual(heard, [[]], 'the toggle reports the new set');
    assert.strictEqual(
      all('tr[data-child]').length,
      1,
      'and the caller decides: still open',
    );
  });

  test('with no rows it shows the empty state, and <:empty> replaces it', async function (assert) {
    let none: StatementRow[] = [];
    await render(
      <template>
        <StatementTable @label='e' @columns={{COLS}} @rows={{none}} />
      </template>,
    );
    assert.notOk(q('table'), 'no empty table');
    assert.ok(
      text(q('[data-test-pretui-statement-table]')).includes(
        'Nothing to report',
      ),
    );
    await render(
      <template>
        <StatementTable @label='e' @columns={{COLS}} @rows={{none}}><:empty><p
              data-test-own
            >No closed months yet</p></:empty></StatementTable>
      </template>,
    );
    assert.ok(q('[data-test-own]'));
  });
});
