// Pretui — UsageCssVariable unit tests. Imports from ../freestyle; when UsageCssVariable moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { UsageCssVariable } from './usage-css-variable';

module('Pretui | components/usage-css-variable', function (hooks) {
  setupCardTest(hooks);

  test('doc mode is an API row typed CSS with no sigil', async function (assert) {
    await render(<template><table><tbody><UsageCssVariable @name='--pretui-gap' @description='Grid gutter' @defaultValue='8px' /></tbody></table></template>);
    let cells = Array.from(document.querySelectorAll('tr.FreestyleUsageArgument td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    assert.deepEqual(cells, ['--pretui-gap', 'CSS', 'Grid gutter', '8px']);
  });

  test('prop mode renders a labelled text knob only when there is something to feed', async function (assert) {
    let seen: string[] = [];
    let onInput = (v: string) => seen.push(v);
    await render(<template><UsageCssVariable @mode='prop' @name='--pretui-gap' @value='8px' @onInput={{onInput}} /></template>);
    assert.strictEqual(document.querySelector('.proprow-label')?.textContent?.trim(), '--pretui-gap');
    let input = document.querySelector('.proprow input') as HTMLInputElement;
    assert.strictEqual(input.getAttribute('aria-label'), '--pretui-gap');
    assert.strictEqual(input.value, '8px');
    await fillIn(input, '12px');
    assert.deepEqual(seen, ['12px']);

    await render(<template><div data-test-wrap><UsageCssVariable @mode='prop' @name='--pretui-gap' @value='8px' /></div></template>);
    assert.strictEqual(document.querySelector('[data-test-wrap]')?.children.length, 0, 'no onInput, no knob');
  });
});
