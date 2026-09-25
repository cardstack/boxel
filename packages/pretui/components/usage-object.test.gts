// Pretui — UsageObject unit tests. Imports from ../freestyle; when UsageObject moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { UsageObject } from '../freestyle';

module('Pretui | components/usage-object', function (hooks) {
  setupCardTest(hooks);

  test('doc mode is an API row typed Object', async function (assert) {
    await render(<template><table><tbody><UsageObject @name='item' @description='The record' @required={{true}} /></tbody></table></template>);
    let cells = Array.from(document.querySelectorAll('tr.FreestyleUsageArgument td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    assert.deepEqual(cells, ['@item *', 'Object', 'The record', '—']);
  });

  test('prop mode shows the value as a labelled JSON tree, or nothing when controls are hidden', async function (assert) {
    const VALUE = { id: 7, tags: ['a', 'b'] };
    await render(<template><UsageObject @mode='prop' @name='item' @value={{VALUE}} @required={{true}} /></template>);
    assert.strictEqual(document.querySelector('.proprow-label')?.textContent?.replace(/\s+/g, ' ').trim(), 'item *');
    let tree = document.querySelector('.proprow [data-test-pretui-json-tree]') as HTMLElement;
    assert.ok(tree, 'a JsonTree, not a <pre> of stringified JSON');
    assert.true(tree.textContent?.includes('tags'));
    assert.true(tree.textContent?.includes('7'));

    await render(<template><div data-test-wrap><UsageObject @mode='prop' @name='item' @value={{VALUE}} @hideControls={{true}} /></div></template>);
    assert.strictEqual(document.querySelector('[data-test-wrap]')?.children.length, 0);
  });

  test('prop mode with no value still renders the tree, so a call site that passes no @value gets an empty state rather than "undefined"', async function (assert) {
    await render(<template><UsageObject @mode='prop' @name='item' /></template>);
    let tree = document.querySelector('.proprow [data-test-pretui-json-tree]') as HTMLElement;
    assert.ok(tree);
    assert.false(tree.textContent?.includes('undefined'));
  });
});
