// Pretui — DataTable unit tests: the text-size contract. The broader DataTable
// behaviour is covered in reading-listing.test.gts.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied), so what the stylesheet reads from data-size and from
// --pretui-data-table-font-size is checked on the usage page, not here.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DataTable } from './data-table';
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

  test('@size stamps the house size on the root, m by default', async function (assert) {
    await render(
      <template>
        <DataTable
          data-test-dt-default
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
        />
        <DataTable
          data-test-dt-s
          @columns={{COLUMNS}}
          @rows={{ROWS}}
          @key={{rowKey}}
          @size='s'
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
    assert.strictEqual(sizeOf('[data-test-dt-default]'), 'm');
    assert.strictEqual(sizeOf('[data-test-dt-s]'), 's');
    assert.strictEqual(sizeOf('[data-test-dt-lg]'), 'l', 'lg is a spelling of l');
  });

  test('the usage page documents --pretui-data-table-font-size', async function (assert) {
    await render(<template><Usage /></template>);
    assert
      .dom('[data-test-pretui-usage]')
      .includesText('pretui-data-table-font-size');
  });
});
