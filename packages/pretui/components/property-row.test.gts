// Pretui — PropertyRow unit tests. Imports from ../design-tools; when PropertyRow moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PropertyRow } from './property-row';

function row(): HTMLElement {
  return document.querySelector('[data-test-pretui-property-row]') as HTMLElement;
}

module('Pretui | components/property-row', function (hooks) {
  setupCardTest(hooks);

  test('wires the label to the yielded control id and the hint to the yielded hint id', async function (assert) {
    await render(
      <template>
        <PropertyRow @label='Width' @hint='In pixels' as |controlId hintId|>
          <input id={{controlId}} aria-describedby={{hintId}} data-test-ctl />
        </PropertyRow>
      </template>,
    );
    let ctl = row().querySelector('[data-test-ctl]') as HTMLInputElement;
    let label = row().querySelector('label') as HTMLLabelElement;
    assert.strictEqual(label.textContent, 'Width');
    assert.strictEqual(label.getAttribute('for'), ctl.id, 'clicking the label focuses the control');
    assert.strictEqual(row().querySelector('.pretui-property-hint')?.id, ctl.getAttribute('aria-describedby'));
    assert.strictEqual(row().querySelector('.pretui-property-hint')?.textContent, 'In pixels');
    assert.strictEqual(row().dataset['layout'], 'row');
    assert.strictEqual(row().dataset['mixed'], undefined);
    assert.strictEqual(row().dataset['modified'], undefined);
    assert.strictEqual(row().querySelector('[data-test-pretui-property-reset]'), null);
    assert.strictEqual(row().querySelector('[data-test-pretui-property-dot]'), null);
  });

  test('a modified row shows a reset button when it can reset, and a plain dot when it cannot', async function (assert) {
    let resets = 0;
    let onReset = () => resets++;
    await render(<template><PropertyRow @label='Width' @modified={{true}} @onReset={{onReset}}>x</PropertyRow></template>);
    assert.strictEqual(row().dataset['modified'], 'true');
    let reset = row().querySelector('[data-test-pretui-property-reset]') as HTMLElement;
    assert.strictEqual(reset.getAttribute('aria-label'), 'Reset Width');
    await click(reset);
    assert.strictEqual(resets, 1);

    await render(<template><PropertyRow @modified={{true}}>x</PropertyRow></template>);
    assert.strictEqual(row().querySelector('[data-test-pretui-property-reset]'), null);
    assert.strictEqual(row().querySelector('[data-test-pretui-property-dot] .pretui-sr')?.textContent, 'Changed from default');
  });

  test('mixed flags the row and adds a Mixed badge; a stacked layout, label block and actions block are honoured', async function (assert) {
    await render(
      <template>
        <PropertyRow @mixed={{true}} @layout='stack' @disabled={{true}}>
          <:label as |controlId|><span data-test-custom-label data-for={{controlId}}>Fill</span></:label>
          <:default as |controlId|><input id={{controlId}} /></:default>
          <:actions><button type='button' data-test-action>Link</button></:actions>
        </PropertyRow>
      </template>,
    );
    assert.strictEqual(row().dataset['mixed'], 'true');
    assert.strictEqual(row().querySelector('[data-test-pretui-property-mixed]')?.textContent, 'Mixed');
    assert.strictEqual(row().dataset['layout'], 'stack');
    assert.strictEqual(row().dataset['disabled'], 'true', 'dimmed; the control itself carries the disabled state');
    assert.strictEqual(row().querySelector('label'), null, 'the label block replaces the default label');
    assert.strictEqual(row().querySelector('[data-test-custom-label]')?.getAttribute('data-for'), row().querySelector('input')?.id);
    assert.ok(row().querySelector('.pretui-property-tail [data-test-action]'));
  });

  test('labelWidth is written as a custom property only when it is a plain CSS length', async function (assert) {
    await render(<template><PropertyRow @label='Width' @labelWidth='12rem'>x</PropertyRow></template>);
    assert.strictEqual(row().getAttribute('style'), '--pretui-property-label-w: 12rem');
    await render(<template><PropertyRow @label='Width' @labelWidth='12rem; color: red'>x</PropertyRow></template>);
    assert.strictEqual(row().getAttribute('style'), null, 'a second declaration is dropped whole');
  });
});
