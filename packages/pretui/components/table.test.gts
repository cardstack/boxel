// Pretui — Table unit tests. Imports from ../reading; when Table moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Table } from '../reading';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/table', function (hooks) {
  setupCardTest(hooks);

  test('Table routes its blocks into a real thead and tbody', async function (assert) {
    await render(
      <template>
        <Table>
          <:head><tr><th data-test-th>Supplier</th></tr></:head>
          <:body><tr><td data-test-td>Wuyi Origins</td></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    assert.ok(table.querySelector('thead [data-test-th]'), 'the head block lands in thead');
    assert.ok(table.querySelector('tbody [data-test-td]'), 'and the body block in tbody');
  });
});
