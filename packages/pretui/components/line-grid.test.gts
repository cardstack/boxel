// Pretui — LineGrid unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>` is inert in this
// harness. What is asserted is what the grid reports, what it derives, and the markup a reader and a
// screen reader depend on.
import { module, test } from 'qunit';
import {
  click,
  fillIn,
  render,
  settled,
  triggerKeyEvent,
} from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { LineGrid } from './line-grid';
import type { LineGridColumn, LineGridRow } from './line-grid';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return [...document.querySelectorAll(sel)] as HTMLElement[];
}
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const COLS: LineGridColumn[] = [
  { key: 'account', label: 'Account', kind: 'code', required: true },
  { key: 'dr', label: 'Debit', kind: 'amount', pairsWith: 'cr', total: true },
  { key: 'cr', label: 'Credit', kind: 'amount', pairsWith: 'dr', total: true },
];
const BALANCE: [string, string] = ['dr', 'cr'];

// The caller holds the lines and applies what the grid reports, as a card's fields would.
class Host {
  @tracked rows: LineGridRow[];
  changes: [number, string, unknown][] = [];
  constructor(rows: LineGridRow[]) {
    this.rows = rows;
  }
  change = (i: number, key: string, value: unknown) => {
    this.changes.push([i, key, value]);
    this.rows = this.rows.map((r, j) => (j === i ? { ...r, [key]: value } : r));
  };
  add = () => {
    this.rows = [...this.rows, {}];
  };
  remove = (i: number) => {
    this.rows = this.rows.filter((_, j) => j !== i);
  };
}

module('Pretui | components/line-grid', function (hooks) {
  setupCardTest(hooks);

  test('one row per line, each control named by its line and column', async function (assert) {
    let host = new Host([
      { account: '6950', dr: 1234, cr: 0 },
      { account: '2600', dr: 0, cr: 1234 },
    ]);
    await render(
      <template>
        <LineGrid
          @label='Journal lines'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    assert.strictEqual(all('tbody tr').length, 2);
    assert.deepEqual(
      all('thead th').map((th) => th.getAttribute('scope')),
      ['col', 'col', 'col'],
    );
    assert.ok(
      q('[aria-label="Line 2, Account"]'),
      'a text cell is named by its line and column',
    );
    assert.strictEqual(
      (q('[aria-label="Line 1, Account"]') as HTMLInputElement).value,
      '6950',
    );
  });

  test('an amount is shown in major units and reported in cents', async function (assert) {
    let host = new Host([{ account: '6950', dr: 1234, cr: 0 }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    let debit = q('td[data-col="dr"] input') as HTMLInputElement;
    assert.ok(debit.value.includes('12.34'), 'cents are shown as dollars');
    await fillIn(debit, '56.78');
    let last = host.changes.filter(([, k]) => k === 'dr').at(-1);
    assert.deepEqual(
      last,
      [0, 'dr', 5678],
      'typed dollars are reported as cents',
    );
  });

  test('typing a debit clears the same line’s credit', async function (assert) {
    let host = new Host([{ account: '6950', dr: 0, cr: 500 }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    await fillIn(q('td[data-col="dr"] input'), '5');
    assert.deepEqual(
      host.rows[0],
      { account: '6950', dr: 500, cr: 0 },
      'the line is one-sided',
    );
  });

  test('totals and the balance are derived; the status says by how much', async function (assert) {
    let host = new Host([
      { account: '6950', dr: 1234, cr: 0 },
      { account: '2600', dr: 0, cr: 1000 },
    ]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @balance={{BALANCE}}
          @onChange={{host.change}}
          @locale='en-US'
        />
      </template>,
    );
    assert.deepEqual(all('tfoot td[data-kind="amount"]').map(text), [
      '$12.34',
      '$10.00',
    ]);
    assert.strictEqual(text(q('[role="status"]')), 'Out of balance by $2.34');
    await fillIn(q('[data-row="1"][data-col="cr"] input'), '12.34');
    await settled();
    assert.strictEqual(text(q('[role="status"]')), 'Balanced');
    assert.strictEqual(
      q('[role="status"]').getAttribute('aria-live'),
      'polite',
      'announced as it changes',
    );
  });

  test('a started line with an empty required cell is invalid; a blank line is not', async function (assert) {
    let host = new Host([{ dr: 100, cr: 0 }, {}]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    assert.strictEqual(
      q('[aria-label="Line 1, Account"]').getAttribute('aria-invalid'),
      'true',
    );
    assert.notStrictEqual(
      q('[aria-label="Line 2, Account"]').getAttribute('aria-invalid'),
      'true',
    );
  });

  test('Add appends a line; Enter on the last line adds one too and moves the caret into it', async function (assert) {
    let host = new Host([{ account: '6950', dr: 100, cr: 0 }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
          @onAdd={{host.add}}
        />
      </template>,
    );
    await click(
      [...document.querySelectorAll('button')].find(
        (b) => text(b) === 'Add line',
      ) as HTMLElement,
    );
    assert.strictEqual(host.rows.length, 2, 'Add appended a line');
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
          @onAdd={{host.add}}
        />
      </template>,
    );
    await triggerKeyEvent(
      q('[data-row="1"][data-col="account"] input'),
      'keydown',
      'Enter',
    );
    await settled();
    assert.strictEqual(host.rows.length, 3, 'Enter on the last line added one');
    assert.strictEqual(
      document.activeElement
        ?.closest('[data-line-cell]')
        ?.getAttribute('data-row'),
      '2',
      'the caret moved into it',
    );
  });

  test('remove buttons are named per line and respect @minRows', async function (assert) {
    let host = new Host([{ account: 'a' }, { account: 'b' }, { account: 'c' }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
          @onRemove={{host.remove}}
          @minRows={{2}}
        />
      </template>,
    );
    assert.notOk(q('[aria-label="Remove line 1"]'), 'the first two lines stay');
    assert.ok(q('[aria-label="Remove line 3"]'));
    await click(q('[aria-label="Remove line 3"]'));
    assert.strictEqual(host.rows.length, 2);
  });

  test('without @onAdd or @onRemove there is no Add button and no remove column', async function (assert) {
    let host = new Host([{ account: 'a' }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    assert.notOk(
      [...document.querySelectorAll('button')].some(
        (b) => text(b) === 'Add line',
      ),
    );
    assert.strictEqual(all('thead th').length, 3, 'no remove column');
  });

  test('a choice column with no options falls back to a text box', async function (assert) {
    let cols: LineGridColumn[] = [
      { key: 'account', label: 'Account', kind: 'choice', options: [] },
    ];
    let host = new Host([{ account: '6950' }]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{cols}}
          @rows={{host.rows}}
          @onChange={{host.change}}
        />
      </template>,
    );
    assert.strictEqual(
      (q('[aria-label="Line 1, Account"]') as HTMLInputElement).value,
      '6950',
    );
  });

  test('<:footer> replaces the status and receives the derived state', async function (assert) {
    let host = new Host([
      { account: 'a', dr: 300, cr: 0 },
      { account: 'b', dr: 0, cr: 100 },
    ]);
    await render(
      <template>
        <LineGrid
          @label='l'
          @columns={{COLS}}
          @rows={{host.rows}}
          @balance={{BALANCE}}
          @onChange={{host.change}}
        >
          <:footer as |state|><span data-test-own>{{state.difference}}·{{if
                state.balanced
                'yes'
                'no'
              }}</span></:footer>
        </LineGrid>
      </template>,
    );
    assert.strictEqual(text(q('[data-test-own]')), '200·no');
  });
});
