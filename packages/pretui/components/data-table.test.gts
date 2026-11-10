// Pretui — DataTable unit tests: the text-size contract. The broader DataTable
// behavior is covered in reading-listing.test.gts.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied), so the sizes the stylesheet reads from data-size, from
// --pretui-size-* and from --pretui-data-table-font-size are checked on the
// usage page, not here.
import { on } from '@ember/modifier';
import { module, test } from 'qunit';
import { click, focus, render, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DataTable } from './data-table';
import { Menu } from './menu';
import type { MenuEntry } from '../internal/menu';
import type { DataColumn } from './data-table';
import { DEMOS_DATA_TABLE } from './data-table.usage';

interface Row {
  id: string;
  name: string;
}
const COLUMNS: DataColumn<Row>[] = [{ key: 'name', label: 'Name' }];
const ROWS: Row[] = [{ id: 'a', name: 'Assam' }];
const rowKey = (row: Row) => row.id;

/* eslint-disable @typescript-eslint/no-explicit-any -- a DEMOS registry is
   Record<string, unknown> by contract; mounting one requires the cast. */
const Usage = DEMOS_DATA_TABLE.DataTable as any;

function sizeOf(selector: string): string | null {
  return document.querySelector(selector)!.getAttribute('data-size');
}

module('Pretui | components/data-table', function (hooks) {
  setupCardTest(hooks);

  test('@size stamps the house size on the root, none by default', async function (assert) {
    await render(
      <template>
        <DataTable
          data-test-dt-default
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
        />
        <DataTable
          data-test-dt-default-arg
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='default'
        />
        <DataTable
          data-test-dt-s
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='s'
        />
        <DataTable
          data-test-dt-m
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='m'
        />
        <DataTable
          data-test-dt-lg
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='lg'
        />
      </template>,
    );
    assert.strictEqual(
      sizeOf('[data-test-dt-default]'),
      null,
      'no @size: the default comes from --pretui-data-table-font-size',
    );
    assert.strictEqual(
      sizeOf('[data-test-dt-default-arg]'),
      null,
      "'default' is no step",
    );
    assert.strictEqual(sizeOf('[data-test-dt-s]'), 's');
    assert.strictEqual(sizeOf('[data-test-dt-m]'), 'm');
    assert.strictEqual(sizeOf('[data-test-dt-lg]'), 'l', 'lg is a spelling of l');
  });

  test('the usage page documents both size knobs', async function (assert) {
    await render(<template><Usage /></template>);
    assert
      .dom('[data-test-pretui-usage]')
      .includesText('pretui-data-table-font-size');
    assert.dom('[data-test-pretui-usage]').includesText('--pretui-size-*');
  });

  test('the table body sits in a DataShell inside the root', async function (assert) {
    // The root sets --pretui-data-font-size: 1em, which reaches DataShell only
    // by inheritance, so the shell, and the table in it, must be descendants.
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='l'
        />
      </template>,
    );
    assert
      .dom('[data-test-pretui-datatable] [data-test-pretui-data] table')
      .exists();
  });

  test('@onActivate: row click and Enter activate; controls inside do not', async function (assert) {
    let calls: string[] = [];
    let onActivate = (row: Row, index: number) =>
      calls.push(row.id + '@' + String(index));
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @onActivate={{onActivate}}
        >
          <:cell as |text|>
            <button type='button' data-test-cell-button>{{text}}</button>
          </:cell>
        </DataTable>
      </template>,
    );
    assert.dom('[data-test-pretui-dt-row]').hasAttribute('tabindex', '0');
    await click('[data-test-cell-button]');
    assert.deepEqual(calls, [], 'a control inside the row does not activate');
    await click('[data-test-pretui-dt-row]');
    assert.deepEqual(calls, ['a@0'], 'a click on the row activates');
    await focus('[data-test-pretui-dt-row]');
    await triggerKeyEvent('[data-test-pretui-dt-row]', 'keydown', 'Enter');
    assert.deepEqual(calls, ['a@0', 'a@0'], 'Enter activates');
  });

  test('@onActivate: Enter from a control inside the row stays with the control', async function (assert) {
    let activated = 0;
    let onActivate = () => activated++;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @onActivate={{onActivate}}
        >
          <:cell as |text|>
            <button type='button' data-test-cell-button>{{text}}</button>
          </:cell>
        </DataTable>
      </template>,
    );
    await focus('[data-test-cell-button]');
    await triggerKeyEvent('[data-test-cell-button]', 'keydown', 'Enter');
    assert.strictEqual(
      activated,
      0,
      'Enter on a cell control does not open the row',
    );
  });

  test('@onActivate: a press on a widget inside the row does not activate it', async function (assert) {
    let activated = 0;
    let onActivate = () => activated++;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @onActivate={{onActivate}}
        >
          <:cell as |text|>
            <div role='slider' tabindex='0' aria-valuenow='0' data-test-cell-widget>{{text}}</div>
          </:cell>
        </DataTable>
      </template>,
    );
    await click('[data-test-cell-widget]');
    assert.strictEqual(activated, 0, 'a non-native widget keeps its click');
  });

  test('@onActivate: choosing an item in a row Menu does not activate the row', async function (assert) {
    let activated = 0;
    let chosen = '';
    let onActivate = () => activated++;
    let items: MenuEntry[] = [
      { label: 'Archive', onSelect: () => (chosen = 'archive') },
    ];
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @onActivate={{onActivate}}
        >
          <:actions>
            <Menu @items={{items}} @label='Row actions'>
              <:trigger as |isOpen toggle|>
                <button
                  type='button'
                  data-open={{if isOpen 'true'}}
                  data-test-menu-trigger
                  {{on 'click' toggle}}
                >⋯</button>
              </:trigger>
            </Menu>
          </:actions>
        </DataTable>
      </template>,
    );
    await click('[data-test-menu-trigger]');
    await click('[role="menuitem"]');
    assert.strictEqual(chosen, 'archive', 'the menu item ran');
    assert.strictEqual(activated, 0, 'and the row did not open');
  });

  test('@onActivate: ending a text selection inside the row does not activate it', async function (assert) {
    let activated = 0;
    let onActivate = () => activated++;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @onActivate={{onActivate}}
        />
      </template>,
    );
    let cell = document.querySelector(
      '[data-test-pretui-dt-row] td:last-of-type',
    )!;
    window.getSelection()!.selectAllChildren(cell);
    await click('[data-test-pretui-dt-row]');
    window.getSelection()!.removeAllRanges();
    assert.strictEqual(
      activated,
      0,
      'a drag-select that ends in a click keeps the row closed',
    );
    await click('[data-test-pretui-dt-row]');
    assert.strictEqual(activated, 1, 'a plain click still opens it');
  });

  test('@onActivate with selectionMode: a row click activates, the checkbox selects', async function (assert) {
    let activated = 0;
    let onActivate = () => activated++;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @selectionMode='multi'
          @onActivate={{onActivate}}
        />
      </template>,
    );
    await click('[data-test-pretui-dt-row]');
    assert.strictEqual(activated, 1, 'a click on the row activates');
    assert
      .dom('[data-test-pretui-dt-row]')
      .hasAttribute('aria-selected', 'false', 'and does not select it');
    await click('[data-test-pretui-dt-select]');
    assert.strictEqual(activated, 1, 'the checkbox does not activate');
    assert
      .dom('[data-test-pretui-dt-row]')
      .hasAttribute('aria-selected', 'true');
    await triggerKeyEvent('[data-test-pretui-dt-row]', 'keydown', 'Enter');
    assert.strictEqual(activated, 2, 'Enter activates');
  });

  test('@onActivate with single selection: the radio selects, a row click activates', async function (assert) {
    let activated = 0;
    let onActivate = () => activated++;
    await render(
      <template>
        <DataTable
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @selectionMode='single'
          @onActivate={{onActivate}}
        />
      </template>,
    );
    await click('[data-test-pretui-dt-select]');
    assert.dom('[data-test-pretui-dt-select]').isChecked();
    assert.strictEqual(activated, 0, 'the radio does not activate');
    await click('[data-test-pretui-dt-row]');
    assert.strictEqual(activated, 1, 'a row click activates');
    assert
      .dom('[data-test-pretui-dt-select]')
      .isChecked('and leaves the selection');
  });

  test('without @onActivate rows are not focusable', async function (assert) {
    await render(
      <template>
        <DataTable @columns={{COLUMNS}} @rows={{ROWS}} @key={{rowKey}} />
      </template>,
    );
    assert.dom('[data-test-pretui-dt-row]').doesNotHaveAttribute('tabindex');
    assert.dom('[data-test-pretui-dt-row]').doesNotHaveAttribute('data-activatable');
  });
});
