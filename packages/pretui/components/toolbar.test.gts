// Pretui — Toolbar unit tests. Imports from ../structure; when Toolbar moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Toolbar } from './toolbar';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/toolbar', function (hooks) {
  setupCardTest(hooks);

  test('Toolbar renders only the identity parts it was given, and always an action slot', async function (assert) {
    await render(<template><Toolbar @title='Suppliers'><button type='button' data-test-add>Add</button></Toolbar></template>);
    let el = q('[data-test-pretui-toolbar]');
    assert.strictEqual(el.querySelector('h2')?.textContent?.trim(), 'Suppliers');
    assert.notOk(el.querySelector('.pretui-eyebrow'), 'no empty eyebrow');
    assert.notOk(el.querySelector('.pretui-toolbar-meta'), 'no empty meta');
    assert.ok(el.querySelector('.pretui-toolbar-actions [data-test-add]'));
  });

  test('Toolbar stacks eyebrow, title and meta in that order', async function (assert) {
    await render(<template><Toolbar @eyebrow='Trade' @title='Suppliers' @meta='42 rows' /></template>);
    assert.deepEqual(
      Array.from(q('.pretui-toolbar-id').children).map((c) => c.textContent?.trim()),
      ['Trade', 'Suppliers', '42 rows'],
    );
    assert.ok(q('.pretui-toolbar-actions'), 'the action slot is always present, even with no block');
  });
});
