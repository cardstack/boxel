// Pretui — UsageArgument unit tests. Imports from ../freestyle; when UsageArgument moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { UsageArgument } from '../freestyle';

function cellTexts(): string[] {
  return Array.from(document.querySelectorAll('tr.FreestyleUsageArgument td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

module('Pretui | components/usage-argument', function (hooks) {
  setupCardTest(hooks);

  test('doc mode is one API-table row: sigil + name, type, description, default', async function (assert) {
    await render(<template><table><tbody><UsageArgument @name='variant' @type='String' @description='Visual weight' @defaultValue='primary' /></tbody></table></template>);
    assert.deepEqual(cellTexts(), ['@variant', 'String', 'Visual weight', 'primary']);
    assert.strictEqual(document.querySelector('.u-req'), null);
  });

  test('a missing default reads as a dash, required adds the asterisk, and typeLabel overrides type', async function (assert) {
    await render(<template><table><tbody><UsageArgument @name='items' @type='Array' @typeLabel='Item[]' @required={{true}} /></tbody></table></template>);
    assert.deepEqual(cellTexts(), ['@items *', 'Item[]', '', '—']);
    assert.strictEqual(document.querySelector('.u-req')?.getAttribute('title'), 'Required');
    await render(<template><table><tbody><UsageArgument @name='count' @type='Number' @defaultValue={{0}} /></tbody></table></template>);
    assert.strictEqual(cellTexts()[3], '0', 'zero is a real default, not a missing one');
  });

  test('the sigil follows the kind: yields are mustached, CSS variables are bare', async function (assert) {
    await render(<template><table><tbody><UsageArgument @name='header' @type='Yield' /></tbody></table></template>);
    assert.strictEqual(cellTexts()[0], '{{header}}');
    await render(<template><table><tbody><UsageArgument @name='--pretui-gap' @typeLabel='CSS' /></tbody></table></template>);
    assert.strictEqual(cellTexts()[0], '--pretui-gap');
    await render(<template><table><tbody><UsageArgument @name='--pretui-gap' @type='CSS' /></tbody></table></template>);
    assert.strictEqual(cellTexts()[0], '--pretui-gap');
  });

  test('prop mode renders nothing — a plain argument has no knob', async function (assert) {
    await render(<template><div data-test-wrap><UsageArgument @mode='prop' @name='variant' @type='String' /></div></template>);
    assert.strictEqual(document.querySelector('[data-test-wrap]')?.children.length, 0);
  });
});
