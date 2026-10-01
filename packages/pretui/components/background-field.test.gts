// Pretui — BackgroundField unit tests. Imports from ../texture; when
// BackgroundField moves to its own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { BackgroundField } from './background-field';
import type { BackgroundFieldName } from './background-field';

function field(): HTMLElement {
  return document.querySelector('[data-test-pretui-background-field]') as HTMLElement;
}
function layers(): string[] {
  return Array.from(field().querySelectorAll('.pretui-field-l')).map((l) => (l as HTMLElement).dataset['l'] as string);
}

module('Pretui | components/background-field', function (hooks) {
  setupCardTest(hooks);

  test('defaults to a still dot grid whose paint is hidden from assistive tech', async function (assert) {
    await render(<template><BackgroundField /></template>);
    assert.strictEqual(field().dataset['field'], 'dot-grid');
    assert.strictEqual(field().dataset['animated'], 'false', 'chrome that moves by default is a tax on every card');
    assert.strictEqual(field().dataset['fade'], 'none');
    assert.strictEqual(field().querySelector('.pretui-field-paint')?.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(layers(), ['1', '2']);
    assert.strictEqual(field().querySelector('.pretui-field-content'), null, 'no content wrapper without a block');
  });

  test('renders exactly the layers each field composes', async function (assert) {
    await render(<template><BackgroundField @variant='aurora' /></template>);
    assert.deepEqual(layers(), ['1', '2', '3']);
    await render(<template><BackgroundField @variant='grain' /></template>);
    assert.deepEqual(layers(), ['1']);
  });

  test('falls back to the dot grid for a variant it does not know', async function (assert) {
    const UNKNOWN = 'plasma' as BackgroundFieldName;
    await render(<template><BackgroundField @variant={{UNKNOWN}} /></template>);
    assert.strictEqual(field().dataset['field'], 'dot-grid', 'never a dead data-field the CSS cannot paint');
  });

  test('animates only when asked and at a positive speed', async function (assert) {
    await render(<template><BackgroundField @animated={{true}} /></template>);
    assert.strictEqual(field().dataset['animated'], 'true');
    await render(<template><BackgroundField @animated={{true}} @speed={{0}} /></template>);
    assert.strictEqual(field().dataset['animated'], 'false', 'speed 0 is a stop');
  });

  test('clamps its knobs and validates its hues before they reach the style attribute', async function (assert) {
    await render(
      <template><BackgroundField @scale={{9}} @opacity={{2}} @speed={{0.01}} @hue='var(--chart-2)' @hue2='red; background: url(javascript:0)' @fade='edges' /></template>,
    );
    let prop = (name: string) => field().style.getPropertyValue(name);
    assert.strictEqual(prop('--pretui-field-scale'), '4', 'scale clamps to 4');
    assert.strictEqual(prop('--pretui-field-opacity'), '1', 'opacity clamps to 1');
    assert.strictEqual(prop('--pretui-field-speed'), '0.05', 'speed floors at 0.05');
    assert.strictEqual(prop('--pretui-field-hue'), 'var(--chart-2)');
    assert.strictEqual(
      field().getAttribute('style'),
      '--pretui-field-scale: 4; --pretui-field-opacity: 1; --pretui-field-speed: 0.05; --pretui-field-hue: var(--chart-2)',
      'the whole attribute: the rejected hue2 is dropped as a declaration, nothing else leaks in',
    );
    assert.strictEqual(field().dataset['fade'], 'edges');
  });

  test('stacks yielded content above the paint', async function (assert) {
    await render(<template><BackgroundField><h2 data-test-title>Spring bookings</h2></BackgroundField></template>);
    assert.ok(field().querySelector('.pretui-field-content [data-test-title]'));
  });
});
