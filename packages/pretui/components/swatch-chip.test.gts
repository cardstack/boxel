// Pretui — SwatchChip unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SwatchChip } from './swatch-chip';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function styleOf(sel: string): string {
  return q(sel).getAttribute('style') ?? '';
}

module('Pretui | components/swatch-chip', function (hooks) {
  setupCardTest(hooks);

  test('SwatchChip is round by default and paints its colour through a custom property', async function (assert) {
    await render(<template><SwatchChip @color='#ff0000' /></template>);
    let chip = q('.pretui-swatch-chip');
    assert.strictEqual(chip.dataset['shape'], 'round');
    assert.strictEqual(chip.dataset['empty'], undefined);
    assert.strictEqual(
      chip.style.getPropertyValue('--pretui-swatch-color'),
      'rgb(100% 0% 0%)',
      'the colour is parsed and re-serialized by the engine — the caller\'s "#ff0000" never reaches the attribute',
    );
  });

  test('SwatchChip never lets the caller string reach the style attribute', async function (assert) {
    const EVIL = 'red; background: url(javascript:0)';
    await render(<template><SwatchChip @color={{EVIL}} /></template>);
    assert.strictEqual(
      styleOf('.pretui-swatch-chip'),
      '--pretui-swatch-color: transparent',
      'the unparseable string re-serializes to the transparent fallback — the whole attribute is that one declaration',
    );
  });

  test('SwatchChip marks an unparseable colour empty rather than painting nothing', async function (assert) {
    await render(<template><SwatchChip @color='not a colour' /></template>);
    assert.strictEqual(
      q('.pretui-swatch-chip').dataset['empty'],
      'true',
      'a crossed-out chip, not an invisible one — "no colour" is a state a reader can see',
    );
  });

  test('SwatchChip squares up and takes a clamped pixel size', async function (assert) {
    await render(
      <template>
        <SwatchChip @color='#000' @shape='square' @size={{32}} />
        <SwatchChip @color='#000' @size={{9999}} />
        <SwatchChip @color='#000' />
      </template>,
    );
    let chips = all('.pretui-swatch-chip');
    assert.strictEqual(chips[0]?.dataset['shape'], 'square');
    assert.true(chips[0]?.getAttribute('style')?.includes('--pretui-swatch-size: 32px'));
    assert.true(
      chips[1]?.getAttribute('style')?.includes('--pretui-swatch-size: 512px'),
      'an absurd size is clamped rather than emitted',
    );
    assert.notOk(
      chips[2]?.getAttribute('style')?.includes('--pretui-swatch-size'),
      'with no @size the token decides, so a themed swatch is not overridden',
    );
  });
});
