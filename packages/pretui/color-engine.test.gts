// Pretui — gradient sampling against what CSS renders. Pure functions, no DOM.
import { module, test } from 'qunit';
import { mixIn, parseColor, sampleGradientAt, toHex } from './color-engine';
import type { GradientSpec, InterpolationSpace } from './color-engine';

function hexMix(a: string, b: string, space: InterpolationSpace) {
  return toHex(mixIn(parseColor(a)!, parseColor(b)!, 0.5, space));
}

module('Pretui | color-engine | mixIn', function () {
  test('red to blue at 50% lands where CSS does in each space', function (assert) {
    assert.strictEqual(hexMix('#ff0000', '#0000ff', 'lab'), '#c10088');
    assert.strictEqual(hexMix('#ff0000', '#0000ff', 'lch'), '#cd007e');
    assert.strictEqual(hexMix('#ff0000', '#0000ff', 'hwb'), '#ff00ff');
    assert.strictEqual(hexMix('#ff0000', '#0000ff', 'srgb-linear'), '#bc00bc');
    assert.strictEqual(hexMix('#ff0000', '#0000ff', 'srgb'), '#800080');
  });

  test('an achromatic stop takes the other stop’s hue', function (assert) {
    assert.strictEqual(hexMix('#ffffff', '#0000ff', 'oklch'), '#74a3ff');
  });

  test('alpha is premultiplied, so a transparent stop does not tint', function (assert) {
    let mixed = mixIn(parseColor('rgb(255 0 0 / 0)')!, parseColor('#0000ff')!, 0.5, 'srgb');
    assert.strictEqual(toHex(mixed), '#0000ff80');
  });
});

module('Pretui | color-engine | sampleGradientAt', function () {
  test('samples between stops in the gradient’s own space', function (assert) {
    let spec: GradientSpec = {
      kind: 'linear',
      angle: 90,
      centerX: 50,
      centerY: 50,
      interpolation: 'srgb-linear',
      hueMethod: 'shorter',
      stops: [
        { id: 'a', position: 0, color: '#ff0000' },
        { id: 'b', position: 100, color: '#0000ff' },
      ],
    };
    assert.strictEqual(toHex(sampleGradientAt(spec, 50)), '#bc00bc');
    assert.strictEqual(toHex(sampleGradientAt(spec, 0)), '#ff0000');
  });
});
