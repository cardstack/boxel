// Pretui — ValueInput unit tests. Imports from ../design-value; when ValueInput moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ValueInput } from './value-input';
import type { ValueSpec } from './value-input';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-value-input]') as HTMLElement;
}

function spin(label: string): HTMLElement {
  let lab = Array.from(root().querySelectorAll('label.pretui-sr')).find((l) => l.textContent === label);
  return document.getElementById(lab?.getAttribute('for') ?? '') as HTMLElement;
}

function str(v: unknown): string {
  return String(v);
}

module('Pretui | components/value-input', function (hooks) {
  setupCardTest(hooks);

  test('each kind mounts its editor and stamps data-kind for the sheet CSS', async function (assert) {
    const NUM: Partial<ValueSpec> = { label: 'Width', min: 0, max: 100, unit: 'px' };
    await render(<template><ValueInput @kind='number' @value={{24}} @spec={{NUM}} /></template>);
    assert.strictEqual(root().dataset['kind'], 'number');
    assert.strictEqual(spin('Width').getAttribute('aria-valuenow'), '24', 'the spec label names the field');
    assert.ok(root().querySelector('[data-test-pretui-scrub-up]'), 'steppers on, this is a form not a canvas');

    await render(<template><ValueInput @kind='text' @value='hello' /></template>);
    assert.strictEqual((root().querySelector('[data-test-pretui-input] input') as HTMLInputElement).value, 'hello');

    await render(<template><ValueInput @kind='toggle' @value={{true}} /></template>);
    assert.true((root().querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement).checked);

    const SEL: Partial<ValueSpec> = { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
    await render(<template><ValueInput @kind='select' @value='b' @spec={{SEL}} /></template>);
    assert.ok(root().querySelector('[data-test-pretui-select]'));

    await render(<template><ValueInput @kind='angle' @value={{45}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-angle-plane]')?.getAttribute('aria-valuenow'), '45');

    const P = { x: 10, y: 20 };
    await render(<template><ValueInput @kind='point' @value={{P}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-joystick] [data-test-pretui-handle]')?.getAttribute('aria-label'), 'Value, 10%, 20%');

    await render(<template><ValueInput @kind='origin' @value={{P}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-origin-status]')?.textContent?.trim(), 'Custom · 10%, 20%');

    const C = { x1: 0, y1: 0, x2: 1, y2: 1 };
    await render(<template><ValueInput @kind='curve' @value={{C}} /></template>);
    assert.true(root().querySelector('[data-test-pretui-easing-curve]')?.getAttribute('style')?.startsWith('--pretui-curve-ease: cubic-bezier(0, 0, 1, 1)'));
  });

  test('a wrong-shaped value falls back per kind instead of throwing', async function (assert) {
    await render(<template><ValueInput @kind='number' @value='oops' /></template>);
    assert.strictEqual(root().querySelector('[role="spinbutton"]')?.getAttribute('aria-valuenow'), null, 'a string is not a number: empty spinbutton');
    await render(<template><ValueInput @kind='point' @value={{3}} /></template>);
    assert.strictEqual(root().querySelector('[data-test-pretui-handle]')?.getAttribute('aria-label'), 'Value, 50%, 50%', 'centre');
    await render(<template><ValueInput @kind='curve' @value='fast' /></template>);
    assert.true(root().querySelector('[data-test-pretui-easing-curve]')?.getAttribute('style')?.startsWith('--pretui-curve-ease: cubic-bezier(0.42, 0, 0.58, 1)'), 'ease-in-out');
    await render(<template><ValueInput @kind='toggle' @value='yes' /></template>);
    assert.false((root().querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement).checked, 'only literal true is on');
  });

  test('edits flow out through one onChange regardless of kind, and custom kinds yield to the block', async function (assert) {
    let seen: unknown[] = [];
    let onChange = (v: unknown) => seen.push(v);
    await render(<template><ValueInput @kind='toggle' @value={{false}} @onChange={{onChange}} /></template>);
    await click(root().querySelector('[data-test-pretui-checkbox] input') as HTMLElement);
    await render(<template><ValueInput @kind='text' @value='' @onChange={{onChange}} /></template>);
    await fillIn(root().querySelector('[data-test-pretui-input] input') as HTMLElement, 'wuyi');
    assert.deepEqual(seen, [true, 'wuyi']);

    await render(
      <template>
        <ValueInput @kind='custom' @value='#c00'>
          <:custom as |kind value|><i data-test-custom>{{kind}}={{str value}}</i></:custom>
        </ValueInput>
      </template>,
    );
    assert.strictEqual(root().querySelector('[data-test-custom]')?.textContent, 'custom=#c00');
  });

  test('disabled comes from the arg or the spec', async function (assert) {
    const SPEC: Partial<ValueSpec> = { disabled: true };
    await render(<template><ValueInput @kind='toggle' @value={{true}} @spec={{SPEC}} /></template>);
    assert.true((root().querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement).disabled);
    await render(<template><ValueInput @kind='toggle' @value={{true}} @disabled={{true}} /></template>);
    assert.true((root().querySelector('[data-test-pretui-checkbox] input') as HTMLInputElement).disabled);
  });
});
