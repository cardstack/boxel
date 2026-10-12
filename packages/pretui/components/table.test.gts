// Pretui — Table unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Table } from './table';

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

  test('with no caption and no label the table carries neither', async function (assert) {
    await render(
      <template>
        <Table>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    assert.notOk(table.querySelector('caption'), 'no caption element');
    assert.notOk(table.hasAttribute('aria-label'), 'and no aria-label');
    assert.notOk(table.hasAttribute('aria-labelledby'), 'and no aria-labelledby');
  });

  test('@caption renders a real caption as the first child of the table', async function (assert) {
    await render(
      <template>
        <Table @caption='Lots in the warehouse'>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    let caption = table.firstElementChild as HTMLElement;
    assert.strictEqual(caption?.tagName, 'CAPTION', 'the caption leads the table, where HTML requires it');
    assert.strictEqual(caption.textContent?.trim(), 'Lots in the warehouse');
    assert.strictEqual(table.querySelectorAll('caption').length, 1, 'exactly one caption');
  });

  test('the caption block renders inside the caption with its markup kept', async function (assert) {
    await render(
      <template>
        <Table>
          <:caption>Lots from <strong data-test-origin>Fujian</strong></:caption>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Lapsang</td></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    let caption = table.firstElementChild as HTMLElement;
    assert.strictEqual(caption?.tagName, 'CAPTION', 'the block lands in a real caption');
    assert.ok(caption.querySelector('[data-test-origin]'), 'the markup survives');
    assert.strictEqual(caption.textContent?.replace(/\s+/g, ' ').trim(), 'Lots from Fujian');
  });

  test('the caption block wins over @caption', async function (assert) {
    await render(
      <template>
        <Table @caption='From the arg'>
          <:caption>From the block</:caption>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Lapsang</td></tr></:body>
        </Table>
      </template>,
    );
    let captions = document.querySelectorAll('[data-test-pretui-table] caption');
    assert.strictEqual(captions.length, 1, 'one caption, not two');
    assert.strictEqual(captions[0]?.textContent?.trim(), 'From the block');
  });

  test('@label names the table when no caption renders', async function (assert) {
    await render(
      <template>
        <Table @label='Targets'>
          <:head><tr><th scope='col'>Priority</th></tr></:head>
          <:body><tr><th scope='row'>Urgent</th></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    assert.strictEqual(table.getAttribute('aria-label'), 'Targets', 'aria-label lands on the table, not the wrapper');
    assert.notOk(table.querySelector('caption'), 'with no visible caption');
    assert.notOk(q('[data-test-pretui-table]').hasAttribute('aria-label'), 'the wrapper stays unnamed');
  });

  test('a caption wins over @label', async function (assert) {
    await render(
      <template>
        <Table @caption='Visible name' @label='Hidden name' data-test-arg>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
        <Table @label='Hidden name' data-test-block>
          <:caption>Block name</:caption>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    for (let which of ['arg', 'block']) {
      let table = q(`[data-test-${which}] table`);
      assert.ok(table.querySelector('caption'), `${which}: the caption renders`);
      assert.notOk(table.hasAttribute('aria-label'), `${which}: and @label does not override it`);
    }
  });

  test('@labelledBy points the table at the on-screen element that names it', async function (assert) {
    await render(
      <template>
        <h2 id='sla-targets-heading'>SLA targets</h2>
        <Table @labelledBy='sla-targets-heading'>
          <:head><tr><th scope='col'>Priority</th></tr></:head>
          <:body><tr><th scope='row'>Urgent</th></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    assert.strictEqual(table.getAttribute('aria-labelledby'), 'sla-targets-heading', 'aria-labelledby lands on the table');
    assert.strictEqual(
      document.getElementById(table.getAttribute('aria-labelledby') ?? '')?.textContent?.trim(),
      'SLA targets',
      'and resolves to the visible heading',
    );
    assert.notOk(table.hasAttribute('aria-label'), 'with no aria-label beside it');
    assert.notOk(table.querySelector('caption'), 'and no caption');
    assert.notOk(q('[data-test-pretui-table]').hasAttribute('aria-labelledby'), 'the wrapper stays unnamed');
  });

  test('a caption wins over @labelledBy', async function (assert) {
    await render(
      <template>
        <h2 id='lots-heading'>Lots</h2>
        <Table @caption='Visible name' @labelledBy='lots-heading' data-test-arg>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
        <Table @labelledBy='lots-heading' data-test-block>
          <:caption>Block name</:caption>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    for (let which of ['arg', 'block']) {
      let table = q(`[data-test-${which}] table`);
      assert.ok(table.querySelector('caption'), `${which}: the caption renders`);
      assert.notOk(table.hasAttribute('aria-labelledby'), `${which}: and @labelledBy does not override it`);
    }
  });

  test('@labelledBy wins over @label', async function (assert) {
    await render(
      <template>
        <h2 id='lots-heading'>Lots</h2>
        <Table @labelledBy='lots-heading' @label='Hidden name'>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    let table = q('[data-test-pretui-table] table');
    assert.strictEqual(table.getAttribute('aria-labelledby'), 'lots-heading', 'the on-screen name is used');
    assert.notOk(table.hasAttribute('aria-label'), 'and the typed-in name is dropped, so the two cannot disagree');
  });

  test('a table is framed by default, and @framed=false marks it frameless', async function (assert) {
    await render(
      <template>
        <Table data-test-framed>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
        <Table @framed={{false}} data-test-frameless>
          <:head><tr><th>Lot</th></tr></:head>
          <:body><tr><td>Keemun</td></tr></:body>
        </Table>
      </template>,
    );
    assert.notOk(q('[data-test-framed]').hasAttribute('data-framed'), 'the default carries no frameless marker');
    assert.strictEqual(q('[data-test-frameless]').getAttribute('data-framed'), 'false', 'a frameless table says so');
  });
});
