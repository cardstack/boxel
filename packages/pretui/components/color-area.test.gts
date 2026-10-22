// Pretui — ColorArea unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ColorArea } from './color-area';
import { parseColor, toHex } from '../color-engine';
import type { ColorValue } from '../color-engine';

const RED = parseColor('#ff0000') as ColorValue;
function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function styleOf(sel: string): string {
  return q(sel).getAttribute('style') ?? '';
}

module('Pretui | components/color-area', function (hooks) {
  setupCardTest(hooks);

  test('ColorArea is a named group of two labelled axis ranges over a hidden canvas', async function (assert) {
    const noop = () => {};
    await render(<template><ColorArea @color={{RED}} @gamut='srgb' @onChange={{noop}} /></template>);
    let area = q('[data-test-pretui-color-area]');
    assert.strictEqual(area.getAttribute('role'), 'group');
    assert.true(
      (area.getAttribute('aria-label') ?? '').includes(' and '),
      'the group names both axes, so the two ranges inside it have context',
    );
    assert.strictEqual(
      area.querySelector('canvas')?.getAttribute('aria-hidden'),
      'true',
      'the painted plane is decoration; the ranges are the control',
    );
    let axes = all('.pretui-area-axis') as HTMLInputElement[];
    assert.strictEqual(axes.length, 2);
    assert.deepEqual(axes.map((a) => a.type), ['range', 'range']);
    axes.forEach((a) => {
      assert.true((a.getAttribute('aria-label') ?? '').length > 0, 'each axis names its own channel');
      assert.true((a.getAttribute('aria-valuetext') ?? '').length > 0, 'and speaks a sentence');
    });
  });

  test('ColorArea publishes the thumb position and its ink as custom properties', async function (assert) {
    const noop = () => {};
    await render(<template><ColorArea @color={{RED}} @gamut='srgb' @onChange={{noop}} /></template>);
    let style = styleOf('[data-test-pretui-color-area]');
    assert.true(/--pretui-area-x: [\d.]+%/.test(style));
    assert.true(/--pretui-area-y: [\d.]+%/.test(style));
    assert.true(style.includes('--pretui-area-thumb-color:'));
    assert.true(
      /--pretui-area-thumb-ink: (black|white)/.test(style),
      'the thumb outline is picked against its own colour, not left to contrast luck',
    );
  });

  test('ColorArea reports a new colour when an axis moves', async function (assert) {
    let seen: ColorValue[] = [];
    const onChange = (c: ColorValue) => seen.push(c);
    await render(<template><ColorArea @color={{RED}} @gamut='srgb' @onChange={{onChange}} /></template>);
    let x = all('.pretui-area-axis')[0] as HTMLInputElement;
    await fillIn(x, String(Number(x.value) / 2));
    assert.strictEqual(seen.length, 1);
    assert.notStrictEqual(toHex(seen[0] as ColorValue), toHex(RED), 'the colour actually moved');
  });

  test('ColorArea is inert while disabled', async function (assert) {
    let seen: ColorValue[] = [];
    const onChange = (c: ColorValue) => seen.push(c);
    await render(
      <template><ColorArea @color={{RED}} @gamut='srgb' @disabled={{true}} @onChange={{onChange}} /></template>,
    );
    assert.strictEqual(q('[data-test-pretui-color-area]').dataset['disabled'], 'true');
    assert.deepEqual(
      (all('.pretui-area-axis') as HTMLInputElement[]).map((a) => a.disabled),
      [true, true],
    );
  });

  test('ColorArea clamps its paint resolution to a sane band', async function (assert) {
    const noop = () => {};
    await render(
      <template>
        <ColorArea @color={{RED}} @gamut='srgb' @resolution={{4}} @onChange={{noop}} />
        <ColorArea @color={{RED}} @gamut='srgb' @resolution={{9999}} @onChange={{noop}} />
      </template>,
    );
    // The canvas is painted at native resolution, so its bitmap width IS the
    // clamped value.
    assert.deepEqual(
      (all('.pretui-area-canvas') as HTMLCanvasElement[]).map((c) => c.width),
      [16, 256],
      '4 is raised to the 16 floor; 9999 is cut to the 256 ceiling',
    );
  });
});
