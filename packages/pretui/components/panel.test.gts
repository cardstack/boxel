// Pretui — Panel unit tests. Imports from ../structure; when Panel moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Panel } from './panel';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/panel', function (hooks) {
  setupCardTest(hooks);

  test('Panel is a section defaulting to the card variant, with no header or footer of its own', async function (assert) {
    await render(<template><Panel>Body</Panel></template>);
    let el = q('[data-test-pretui-panel]');
    assert.strictEqual(el.tagName, 'SECTION', 'a landmark-capable element, not a div');
    assert.strictEqual(el.dataset['variant'], 'card');
    assert.strictEqual(el.dataset['scroll'], undefined);
    assert.notOk(el.querySelector('.pretui-panel-header'), 'no empty header');
    assert.notOk(el.querySelector('.pretui-panel-footer'), 'no empty footer');
    assert.strictEqual(el.querySelector('.pretui-panel-body')?.textContent?.trim(), 'Body');
  });

  test('Panel generates a header from @title and @eyebrow', async function (assert) {
    await render(<template><Panel @title='Curing log' @eyebrow='Batch 12'>Body</Panel></template>);
    let head = q('.pretui-panel-header');
    assert.strictEqual(head.querySelector('h2')?.textContent?.trim(), 'Curing log');
    assert.strictEqual(head.querySelector('.pretui-eyebrow')?.textContent?.trim(), 'Batch 12');
  });

  test('Panel lets a <:header> block replace the generated header entirely', async function (assert) {
    await render(
      <template>
        <Panel @title='ignored'>
          <:header><button type='button' data-test-close>Close</button></:header>
          <:default>Body</:default>
        </Panel>
      </template>,
    );
    assert.ok(q('.pretui-panel-header [data-test-close]'));
    assert.notOk(q('.pretui-panel-header h2'), '@title does not also render alongside the block');
  });

  test('Panel renders the footer for an actions-only panel', async function (assert) {
    // The invariant: either <:status> or <:actions> produces the footer. A
    // status-only gate would drop an actions-only panel's buttons without a
    // trace, which is what this guards against.
    await render(
      <template>
        <Panel>
          <:default>Body</:default>
          <:actions><button type='button' data-test-save>Save</button></:actions>
        </Panel>
      </template>,
    );
    assert.ok(q('.pretui-panel-footer'), 'the footer exists');
    assert.ok(q('.pretui-panel-actions [data-test-save]'), 'and the action is inside it');
  });

  test('Panel keeps status left and actions right when both are given', async function (assert) {
    await render(
      <template>
        <Panel>
          <:default>Body</:default>
          <:status>3 unsaved</:status>
          <:actions><button type='button'>Save</button></:actions>
        </Panel>
      </template>,
    );
    assert.strictEqual(q('.pretui-panel-status').textContent?.trim(), '3 unsaved');
    assert.strictEqual(q('.pretui-panel-actions').textContent?.trim(), 'Save');
  });

  test('Panel reflects the inspector variant and the scroll flag', async function (assert) {
    await render(<template><Panel @variant='inspector' @scroll={{true}}>Body</Panel></template>);
    let el = q('[data-test-pretui-panel]');
    assert.strictEqual(el.dataset['variant'], 'inspector');
    assert.strictEqual(el.dataset['scroll'], 'true');
  });
});
