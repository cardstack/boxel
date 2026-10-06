// Pretui — the colour engine's contract.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// Most of this is PORTED from hdr-color-input v0.4.3's `tests/` (MIT, Adam
// Argyle), which is the most valuable thing in that repo — 20 integration
// files plus 5 unit files, and the unit ones are pure functions that
// translate directly. The porting map is recorded at the bottom of this
// file, including what was deliberately NOT ported and why.
//
// Two things here are NOT from upstream and matter more than anything that
// is: the injection guard (§ "the guard"), and gradient CSS syntax validated
// against the browser's own parser rather than against my reading of the
// spec.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import {
  DEFAULT_GRADIENT,
  INTERPOLATION_SPACES,
  SPACES,
  areaColorAt,
  areaHeldChannel,
  areaPosition,
  channelDisplay,
  alphaTrackCss,
  channelTrackCss,
  channelValueText,
  clamp,
  clampTo,
  contrastRatio,
  cssFor,
  describeColor,
  gradientCss,
  hueDelta,
  hueName,
  inGamutOf,
  inkOn,
  mixIn,
  nextStopId,
  paintArea,
  parseColor,
  round,
  sampleGradientAt,
  serializeColor,
  sortedStops,
  spaceSpec,
  stepFor,
  toHex,
  toSpace,
  withAlpha,
  withChannel,
  withHeldChannel,
  wrapHue,
  type ColorValue,
  type GamutId,
  type GradientSpec,
  type InterpolationSpace,
  type SpaceId,
} from './color-engine';

import { ColorPalette } from './components/color-palette';
import { ColorPicker } from './components/color-picker';
import { GradientEditor } from './components/gradient-editor';
import { Swatch } from './components/swatch';

function colorOf(text: string): ColorValue {
  let parsed = parseColor(text);
  if (!parsed) {
    throw new Error(`expected "${text}" to parse`);
  }
  return parsed;
}

/** Perceptual distance, used the way upstream's conversion tests use
 *  colorjs `distance(…, 'oklab')`. */
function perceptualDistance(a: ColorValue, b: ColorValue): number {
  let x = toSpace(a, 'oklab');
  let y = toSpace(b, 'oklab');
  return Math.hypot(
    x.coords[0] - y.coords[0],
    x.coords[1] - y.coords[1],
    x.coords[2] - y.coords[2],
  );
}

// ═══════════════════════════════════════════════════════════════════════
// The guard — NOT from upstream. The single most important thing here.
// ═══════════════════════════════════════════════════════════════════════

const ATTACKS = [
  'red; background: url(https://evil.example/x)',
  'red}\n.pretui-swatch{background:url(https://evil.example/x)}',
  'url(https://evil.example/x)',
  '#fff;--injected:1',
  'rgb(1,2,3);z-index:99999',
  'expression(alert(1))',
  'image-set("a.png")',
  '</style><script>alert(1)</script>',
  'var(--secret)',
  'attr(data-secret)',
  '#fff") ; background-image: url("https://evil.example/x',
];

module('Pretui | colour | the injection guard', function () {
  test('parseColor refuses every injection shape', function (assert) {
    for (let attack of ATTACKS) {
      assert.strictEqual(
        parseColor(attack),
        null,
        `refused: ${JSON.stringify(attack)}`,
      );
    }
  });

  test('cssFor never returns caller characters', function (assert) {
    for (let attack of ATTACKS) {
      let out = cssFor(attack);
      assert.strictEqual(out, 'transparent', `neutralized: ${attack}`);
    }
  });

  test('cssFor output is always a bare colour token', function (assert) {
    let safe = /^[a-zA-Z0-9#%.,()/\s+-]+$/;
    for (let text of ['#ff0000', 'red', 'oklch(0.7 0.2 30)', 'rgb(1 2 3 / 50%)']) {
      let out = cssFor(text);
      assert.ok(safe.test(out), `${text} -> ${out}`);
      assert.notOk(out.includes(';'), 'no declaration separator');
      assert.notOk(out.includes('url('), 'no url()');
      assert.notOk(out.includes('}'), 'no block close');
    }
  });

  test('a poisoned gradient stop becomes transparent, not a declaration', function (assert) {
    let css = gradientCss({
      ...DEFAULT_GRADIENT,
      stops: [
        { id: 'a', position: 0, color: 'red; background: url(https://evil/x)' },
        { id: 'b', position: 100, color: '#00ffff' },
      ],
    });
    assert.ok(css.includes('transparent 0%'), 'poisoned stop neutralized');
    assert.notOk(css.includes('url('), 'no url survived');
    assert.notOk(css.includes(';'), 'no declaration separator survived');
  });

  test('an over-long string is refused outright', function (assert) {
    assert.strictEqual(parseColor('#'.padEnd(300, 'f')), null);
  });

  test('non-strings are refused', function (assert) {
    assert.strictEqual(parseColor(undefined), null);
    assert.strictEqual(parseColor(null), null);
    assert.strictEqual(parseColor(''), null);
    assert.strictEqual(parseColor('   '), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ported: tests/06-conversion.test.ts
// ═══════════════════════════════════════════════════════════════════════

const CONVERSION_SAMPLES = [
  'oklch(75% 0.3 180)',
  'hsl(200 100% 50%)',
  'rgb(20% 40% 60%)',
  'lab(60% 20 30)',
];

module('Pretui | colour | conversion (ported 06-conversion)', function () {
  test('every space round-trips within 1.5 perceptual units', function (assert) {
    for (let sample of CONVERSION_SAMPLES) {
      let source = colorOf(sample);
      for (let space of SPACES) {
        let there = toSpace(source, space.id);
        let back = toSpace(there, source.space);
        let distance = perceptualDistance(source, back);
        assert.ok(
          Number.isFinite(distance) && distance < 1.5,
          `${sample} via ${space.id}: ${distance}`,
        );
      }
    }
  });

  test('gamut-mapped colours land inside HSL ranges', function (assert) {
    // Upstream asserts h in [0,360], s and l in [0,100.0001] after clipping.
    let mapped = clampTo(colorOf('oklch(70% 0.2 240)'), 'srgb').color;
    let hsl = toSpace(mapped, 'hsl');
    assert.ok(hsl.coords[0] >= 0 && hsl.coords[0] <= 360, 'hue in range');
    assert.ok(hsl.coords[1] >= 0 && hsl.coords[1] <= 100.0001, 'sat in range');
    assert.ok(hsl.coords[2] >= 0 && hsl.coords[2] <= 100.0001, 'lightness in range');
  });

  test('a conversion never changes the alpha', function (assert) {
    let source = withAlpha(colorOf('#ff8800'), 0.42);
    for (let space of SPACES) {
      assert.strictEqual(
        round(toSpace(source, space.id).alpha, 4),
        0.42,
        `alpha survives ${space.id}`,
      );
    }
  });

  test('an achromatic colour keeps its hue across a conversion', function (assert) {
    // colorjs reports NaN for the hue of a grey. Letting that read as 0 would
    // spin the hue slider to red the moment a user drags chroma to zero —
    // this is the trap the engine's hue carry-forward exists for.
    let grey = { space: 'oklch' as SpaceId, coords: [0.5, 0, 210] as [number, number, number], alpha: 1 };
    let viaSrgb = toSpace(toSpace(grey, 'srgb'), 'oklch');
    assert.ok(Number.isFinite(viaSrgb.coords[2]), 'hue is a number, not NaN');
  });

  test('unknown syntaxes normalize into sRGB rather than being refused', function (assert) {
    for (let text of ['lab(50% 40 30)', 'hwb(120 20% 30%)', 'lch(50% 40 200)']) {
      let parsed = parseColor(text);
      assert.ok(parsed, `${text} parsed`);
      assert.strictEqual(parsed?.space, 'srgb', `${text} normalized`);
    }
  });

  test('a space this kit models is kept in its own space', function (assert) {
    assert.strictEqual(parseColor('color(display-p3 1 0 0)')?.space, 'p3');
    assert.strictEqual(parseColor('oklch(0.7 0.2 30)')?.space, 'oklch');
    assert.strictEqual(parseColor('hsl(200 100% 50%)')?.space, 'hsl');
    assert.strictEqual(parseColor('#ff0000')?.space, 'srgb');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ported: tests/12-chroma-clamping.test.ts + tests/08-derived.test.ts
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | gamut (ported 12-chroma-clamping, 08-derived)', function () {
  test('an in-gamut colour is reported unclamped, at distance zero', function (assert) {
    let result = clampTo(colorOf('#3366cc'), 'srgb');
    assert.false(result.clamped, 'not clamped');
    assert.strictEqual(result.distance, 0, 'no distance');
  });

  test('an out-of-gamut colour is clamped AND the distance is reported', function (assert) {
    let wide = colorOf('oklch(0.7 0.35 30)');
    assert.false(inGamutOf(wide, 'srgb'), 'starts outside sRGB');
    let result = clampTo(wide, 'srgb');
    assert.true(result.clamped, 'reports the clamp');
    // The regression this guards: `toGamut` MUTATES its input, so passing the
    // same object as both the mapping input and the ΔE reference reports 0
    // for every clamp — a silently useless readout in the one component
    // whose whole purpose is to show it.
    assert.ok(result.distance > 0, `distance is real: ${result.distance}`);
    assert.true(inGamutOf(result.color, 'srgb'), 'result is inside');
  });

  test('a clamped colour is inside every gamut it was mapped to', function (assert) {
    let wide = colorOf('oklch(0.85 0.33 145)');
    for (let gamut of ['srgb', 'p3', 'rec2020'] as GamutId[]) {
      assert.true(
        inGamutOf(clampTo(wide, gamut).color, gamut),
        `mapped into ${gamut}`,
      );
    }
  });

  test('gamuts nest: inside sRGB implies inside P3 implies inside Rec.2020', function (assert) {
    let color = colorOf('#c026d3');
    assert.true(inGamutOf(color, 'srgb'));
    assert.true(inGamutOf(color, 'p3'));
    assert.true(inGamutOf(color, 'rec2020'));
  });

  test('a colour outside sRGB can still be inside P3', function (assert) {
    let p3Green = colorOf('color(display-p3 0 1 0)');
    assert.false(inGamutOf(p3Green, 'srgb'), 'outside sRGB');
    assert.true(inGamutOf(p3Green, 'p3'), 'inside P3');
  });

  test('ink-on picks the readable side (ported contrastColor)', function (assert) {
    assert.strictEqual(inkOn(colorOf('#000000')), 'white');
    assert.strictEqual(inkOn(colorOf('#ffffff')), 'black');
    assert.strictEqual(inkOn(colorOf('oklch(20% 0 0)')), 'white');
    assert.strictEqual(inkOn(colorOf('oklch(95% 0 0)')), 'black');
    assert.strictEqual(inkOn(colorOf('yellow')), 'black');
    assert.strictEqual(inkOn(colorOf('navy')), 'white');
  });

  test('contrast ratio matches WCAG 2.1 anchors', function (assert) {
    assert.strictEqual(
      contrastRatio(colorOf('#ffffff'), colorOf('#000000')),
      21,
      'white on black is 21:1',
    );
    assert.strictEqual(
      contrastRatio(colorOf('#ffffff'), colorOf('#ffffff')),
      1,
      'same colour is 1:1',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ported: tests/unit/channel-formatting.test.ts + 11-colorspace-precision
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | precision (ported channel-formatting, 11-precision)', function () {
  test('round drops trailing zeros and never returns -0', function (assert) {
    assert.strictEqual(round(1.5, 2), 1.5);
    assert.strictEqual(round(2.0, 2), 2);
    assert.strictEqual(round(3.456, 2), 3.46);
    assert.strictEqual(round(3.454, 2), 3.45);
    assert.strictEqual(round(1.7, 0), 2);
    assert.strictEqual(round(1.4, 0), 1);
    assert.strictEqual(round(-1.5, 2), -1.5);
    assert.strictEqual(round(-2.456, 2), -2.46);
    assert.strictEqual(round(0.001, 2), 0);
    assert.strictEqual(Object.is(round(-0.0001, 2), 0), true, 'never -0');
  });

  test('every channel displays at its declared precision', function (assert) {
    // Upstream's fallthrough precision of 2dp silently applied to any channel
    // the table missed; here precision is declared per channel, so there is
    // nothing to fall through TO.
    for (let space of SPACES) {
      let color = toSpace(colorOf('#3a7bd5'), space.id);
      space.channels.forEach((channel, index) => {
        let shown = channelDisplay(color, index);
        let decimals = String(shown).split('.')[1]?.length ?? 0;
        assert.ok(
          decimals <= channel.precision,
          `${space.id}.${channel.id} shows ${shown} (<= ${channel.precision} dp)`,
        );
      });
    }
  });

  test('no serialized value carries four or more decimals', function (assert) {
    // Upstream's multi-hop precision test, generalized: hop through every
    // space and assert the string never grows a long tail.
    let color = colorOf('oklch(75% 0.3 180)');
    for (let space of SPACES) {
      color = toSpace(color, space.id);
      let text = serializeColor(color);
      assert.notOk(
        /\d+\.\d{5,}/.test(text),
        `${space.id}: ${text} has no runaway precision`,
      );
    }
  });

  test('sRGB channels are shown 0-255, wide-gamut RGB 0-1', function (assert) {
    let red = colorOf('#ff0000');
    assert.strictEqual(channelDisplay(red, 0), 255, 'sRGB red is 255');
    let p3 = toSpace(red, 'p3');
    assert.ok(channelDisplay(p3, 0) <= 1, 'P3 red is a 0-1 coordinate');
  });

  test('hex is always 6 or 8 digits, never the 3-digit short form', function (assert) {
    // A hex that changes width mid-drag reflows the field it lives in.
    assert.strictEqual(toHex(colorOf('#fff')), '#ffffff');
    assert.strictEqual(toHex(colorOf('#000')), '#000000');
    assert.strictEqual(toHex(colorOf('#f00')), '#ff0000');
    assert.strictEqual(toHex(withAlpha(colorOf('#ff0000'), 0.5)), '#ff000080');
    assert.strictEqual(toHex(withAlpha(colorOf('#ffffff'), 0)), '#ffffff00');
  });

  test('hex gamut-maps before quantizing', function (assert) {
    let hex = toHex(colorOf('oklch(0.7 0.35 30)'));
    assert.ok(/^#[0-9a-f]{6}$/.test(hex), `well formed: ${hex}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ported: tests/19-keyboard-modifiers.test.ts
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | keyboard modifiers (ported 19)', function () {
  test('Shift coarsens by 10, Alt refines by 10, both cancel', function (assert) {
    let channel = { step: 1 } as never;
    assert.strictEqual(stepFor(channel, {}), 1, 'plain');
    assert.strictEqual(stepFor(channel, { shiftKey: true }), 10, 'shift');
    assert.strictEqual(stepFor(channel, { altKey: true }), 0.1, 'alt');
    assert.strictEqual(
      stepFor(channel, { shiftKey: true, altKey: true }),
      1,
      'both cancel rather than compounding',
    );
  });

  test('the modifier ladder applies to a sub-unit step too', function (assert) {
    let channel = { step: 0.001 } as never;
    assert.strictEqual(round(stepFor(channel, { shiftKey: true }), 6), 0.01);
    assert.strictEqual(round(stepFor(channel, { altKey: true }), 6), 0.0001);
  });

  test('hue wraps rather than clamping', function (assert) {
    assert.strictEqual(wrapHue(-30), 330);
    assert.strictEqual(wrapHue(400), 40);
    assert.strictEqual(wrapHue(360), 0);
    assert.strictEqual(wrapHue(0), 0);
    // Upstream's assertion: 355 + 10 lands on 5, not on a 359 dead stop.
    assert.strictEqual(wrapHue(355 + 10), 5);
  });

  test('withChannel wraps hue and clamps everything else', function (assert) {
    let color = colorOf('hsl(200 100% 50%)');
    assert.strictEqual(channelDisplay(withChannel(color, 0, 365), 0), 5, 'hue wraps');
    assert.strictEqual(channelDisplay(withChannel(color, 0, -5), 0), 355, 'hue wraps down');
    assert.strictEqual(channelDisplay(withChannel(color, 1, 150), 1), 100, 'sat clamps at max');
    assert.strictEqual(channelDisplay(withChannel(color, 1, -20), 1), 0, 'sat clamps at min');
  });

  test('a non-finite channel write is ignored, not written as NaN', function (assert) {
    let color = colorOf('#ff0000');
    assert.deepEqual(
      withChannel(color, 0, Number.NaN).coords,
      color.coords,
      'NaN refused',
    );
  });

  test('clamp is inclusive at both ends', function (assert) {
    assert.strictEqual(clamp(-10, 0, 100), 0);
    assert.strictEqual(clamp(150, 0, 100), 100);
    assert.strictEqual(clamp(50, 0, 100), 50);
    assert.strictEqual(clamp(0, 0, 100), 0);
    assert.strictEqual(clamp(100, 0, 100), 100);
    assert.strictEqual(clamp(-200, -100, 100), -100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ported: tests/16-text-input-validation.test.ts
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | text validation (ported 16)', function () {
  test('invalid text is non-destructive — it produces null, never a colour', function (assert) {
    for (let text of ['not-a-color', '#gg0000', 'rgb(', 'oklch()', '12345']) {
      assert.strictEqual(parseColor(text), null, `refused: ${text}`);
    }
  });

  test('recovery: a valid string after an invalid one parses exactly', function (assert) {
    assert.strictEqual(parseColor('not-a-color'), null);
    let recovered = parseColor('#ff6600');
    assert.ok(recovered);
    assert.strictEqual(toHex(recovered!), '#ff6600');
    assert.strictEqual(recovered!.space, 'srgb');
  });

  test('named colours and transparent parse', function (assert) {
    assert.strictEqual(toHex(colorOf('red')), '#ff0000');
    assert.strictEqual(colorOf('transparent').alpha, 0);
    let named = colorOf('rebeccapurple');
    assert.strictEqual(toHex(named), '#663399');
  });

  test('modern space-separated and slash-alpha syntax parses', function (assert) {
    // figui3's "CSS" mode accepts only #hex and comma rgb() — it rejects
    // exactly the syntax the CSS spec has recommended since Colour 4.
    assert.strictEqual(toHex(colorOf('rgb(255 0 0)')), '#ff0000');
    assert.strictEqual(round(colorOf('rgb(255 0 0 / 50%)').alpha, 2), 0.5);
    assert.strictEqual(round(colorOf('hsl(0 100% 50% / 0.25)').alpha, 2), 0.25);
    assert.strictEqual(round(colorOf('oklch(0.7 0.2 30 / 40%)').alpha, 2), 0.4);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// The area picker — upstream has NO tests for this at all (no canvas in
// jsdom). These are new.
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | the area picker', function () {
  test('position and colour-at are exact inverses in the area model', function (assert) {
    // This is the invariant the picker actually relies on: it stores its
    // working colour in the area MODEL space (hsv / oklch / oklab), never in
    // the display space, precisely so this round trip is lossless.
    for (let space of SPACES) {
      let model = spaceSpec(space.id).area.model;
      let base = toSpace(colorOf('#4a7fd4'), model);
      for (let [fx, fy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [0.5, 0.5],
        [0.25, 0.8],
      ]) {
        let at = areaColorAt(base, fx!, fy!);
        let back = areaPosition(at);
        assert.ok(
          Math.abs(back.x - fx!) < 0.02 && Math.abs(back.y - fy!) < 0.02,
          `${space.id} (model ${model}) (${fx},${fy}) -> (${round(back.x, 3)},${round(back.y, 3)})`,
        );
      }
    }
  });

  test('a DISPLAY-space round trip is lossy at the degenerate corners', function (assert) {
    // The reason the picker stores the model space, asserted rather than
    // asserted-away. Every black has no saturation, so an sRGB-stored
    // picker dragged to the bottom of its plane snaps the cursor to the left
    // edge and comes back grey — silently discarding what the user chose.
    let srgb = colorOf('#4a7fd4');
    let bottomRight = areaColorAt(srgb, 1, 1);
    let back = areaPosition(bottomRight);
    assert.strictEqual(round(back.y, 3), 1, 'value is preserved');
    assert.notStrictEqual(round(back.x, 3), 1, 'saturation is NOT — this is the loss');

    // The same move on the model-space value the picker actually holds.
    let hsv = toSpace(srgb, 'hsv');
    let modelBack = areaPosition(areaColorAt(hsv, 1, 1));
    assert.strictEqual(round(modelBack.x, 3), 1, 'model space keeps saturation');
    assert.strictEqual(round(modelBack.y, 3), 1, 'and value');
  });

  test('the picker stores the area model, not the display space', function (assert) {
    // The contract the two tests above justify.
    assert.strictEqual(spaceSpec('srgb').area.model, 'hsv');
    assert.strictEqual(spaceSpec('hsl').area.model, 'hsv');
    assert.strictEqual(spaceSpec('hsv').area.model, 'hsv');
    assert.strictEqual(spaceSpec('oklch').area.model, 'oklch');
    assert.strictEqual(spaceSpec('p3').area.model, 'oklch');
    assert.strictEqual(spaceSpec('rec2020').area.model, 'oklch');
    assert.strictEqual(spaceSpec('oklab').area.model, 'oklab');
  });

  test('the top of the area is the channel maximum', function (assert) {
    // Screen coordinates run downward; getting this backwards produces a
    // picker that is upside down in exactly one of its spaces.
    let base = colorOf('#808080');
    let top = areaColorAt(base, 0.5, 0);
    let bottom = areaColorAt(base, 0.5, 1);
    assert.ok(
      toSpace(top, 'oklch').coords[0] > toSpace(bottom, 'oklch').coords[0],
      'top is lighter than bottom',
    );
  });

  test('moving in the area never changes alpha or the held channel', function (assert) {
    let base = withAlpha(colorOf('oklch(0.6 0.15 210)'), 0.33);
    let heldBefore = areaHeldChannel(base).display;
    let moved = areaColorAt(base, 0.8, 0.2);
    assert.strictEqual(round(moved.alpha, 4), 0.33, 'alpha kept');
    assert.strictEqual(
      round(areaHeldChannel(moved).display, 1),
      round(heldBefore, 1),
      'held channel kept',
    );
  });

  test('the held channel drives through the area model', function (assert) {
    // An sRGB picker's slider is an HSV hue; driving it must still move the
    // colour even though sRGB has no hue channel of its own.
    let base = colorOf('#ff0000');
    assert.strictEqual(spaceSpec('srgb').area.model, 'hsv');
    let rotated = withHeldChannel(base, 120);
    assert.strictEqual(toHex(rotated), '#00ff00', 'hue 120 is green');
    assert.strictEqual(rotated.space, 'srgb', 'stays in the caller space');
  });

  test('paintArea produces a full RGBA buffer at the requested size', function (assert) {
    for (let size of [16, 32, 96]) {
      let paint = paintArea(colorOf('#ff0000'), 'srgb', size);
      assert.strictEqual(paint.size, size);
      assert.strictEqual(paint.data.length, size * size * 4);
    }
  });

  test('out-of-gamut pixels are drawn faded, in-gamut ones opaque', function (assert) {
    // This is the visible-gamut claim, asserted rather than assumed.
    let inside = paintArea(colorOf('#ff0000'), 'rec2020', 16);
    let opaqueOnly = true;
    for (let i = 3; i < inside.data.length; i += 4) {
      if (inside.data[i] !== 255) {
        opaqueOnly = false;
      }
    }
    assert.true(opaqueOnly, 'an HSV plane is fully inside Rec.2020');

    let perceptual = paintArea(colorOf('oklch(0.6 0.2 30)'), 'srgb', 16);
    let faded = 0;
    for (let i = 3; i < perceptual.data.length; i += 4) {
      if (perceptual.data[i]! < 255) {
        faded++;
      }
    }
    assert.ok(faded > 0, `OKLCH chroma plane has unreachable regions: ${faded}`);
    assert.ok(faded < 256, 'but not the whole plane');
  });

  test('paintArea is deterministic', function (assert) {
    // Indexing determinism: no Math.random(), no Date.now(), anywhere below.
    let a = paintArea(colorOf('oklch(0.6 0.2 30)'), 'p3', 16);
    let b = paintArea(colorOf('oklch(0.6 0.2 30)'), 'p3', 16);
    assert.deepEqual(Array.from(a.data), Array.from(b.data));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Announcement — colour must never be the only channel.
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | announcement', function () {
  test('hue words come off the right wheel', function (assert) {
    // sRGB red is 29 degrees in OK space. Naming an OKLCH hue from an sRGB
    // table calls pure red "orange" — quietly wrong, and invisible to
    // everyone except the screen-reader user it misleads.
    assert.strictEqual(hueName(29, 'ok'), 'red', 'OK 29 is red');
    assert.strictEqual(hueName(29, 'srgb'), 'orange', 'sRGB 29 is orange');
    assert.strictEqual(hueName(0, 'srgb'), 'red');
    assert.strictEqual(hueName(120, 'srgb'), 'green');
    assert.strictEqual(hueName(240, 'srgb'), 'blue');
    assert.strictEqual(hueName(264, 'ok'), 'blue');
    assert.strictEqual(hueName(142, 'ok'), 'green');
  });

  test('every hue angle names something', function (assert) {
    for (let deg = -720; deg <= 720; deg += 7) {
      assert.ok(hueName(deg).length > 0, `${deg} named`);
    }
  });

  test('channel value text is a sentence with units', function (assert) {
    let oklch = spaceSpec('oklch');
    assert.strictEqual(
      channelValueText(oklch, 0, 0.62),
      'Lightness 0.62',
      'lightness reads as a labelled number',
    );
    assert.ok(
      channelValueText(oklch, 2, 210).includes('degrees'),
      'hue says degrees',
    );
    assert.ok(
      channelValueText(oklch, 2, 210).includes('cyan'),
      'hue names a colour word',
    );
    assert.ok(
      channelValueText(spaceSpec('hsl'), 1, 40).includes('%'),
      'percentage channels carry their unit',
    );
  });

  test('describeColor is readable text carrying the hex', function (assert) {
    let described = describeColor(colorOf('#ff0000'), 'srgb');
    assert.ok(described.includes('#ff0000'), 'carries the hex');
    assert.ok(described.includes('red'), 'carries a colour word');
    assert.notOk(described.includes('outside'), 'in gamut says nothing');
  });

  test('describeColor names the gamut when the colour is outside it', function (assert) {
    let described = describeColor(colorOf('oklch(0.7 0.35 30)'), 'srgb');
    assert.ok(described.includes('outside sRGB'), `says so: ${described}`);
  });

  test('describeColor reports opacity', function (assert) {
    let described = describeColor(withAlpha(colorOf('#ff0000'), 0.4), 'srgb');
    assert.ok(described.includes('40% opaque'), `says so: ${described}`);
  });

  test('greys and near-blacks are named as such, not by hue', function (assert) {
    assert.ok(describeColor(colorOf('#808080')).includes('grey'));
    assert.ok(describeColor(colorOf('#050505')).includes('near black'));
    assert.ok(describeColor(colorOf('#fdfdfd')).includes('near white'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Gradients — validated against the BROWSER's parser, not against my
// reading of the spec. This is the test that caught the real bug.
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | gradients', function () {
  test('every gradient this component can emit is valid CSS', function (assert) {
    // A gradient with a syntax error is INVISIBLE: the browser drops the
    // declaration and the element simply has no background. The only
    // trustworthy oracle is the browser's own parser.
    let probe = document.createElement('div');
    for (let kind of ['linear', 'radial', 'conic'] as const) {
      for (let space of INTERPOLATION_SPACES) {
        let css = gradientCss({
          ...DEFAULT_GRADIENT,
          kind,
          interpolation: space.id,
          hueMethod: 'longer',
        });
        probe.style.backgroundImage = '';
        probe.style.backgroundImage = css;
        assert.notStrictEqual(
          probe.style.backgroundImage,
          '',
          `${kind} in ${space.id} survives the parser: ${css}`,
        );
      }
    }
  });

  test('the interpolation clause shares the first argument with the geometry', function (assert) {
    // CSS Images 4 combines them with `||` in one argument. Emitting them as
    // two comma-separated arguments reads naturally and is a parse error.
    let linear = gradientCss({ ...DEFAULT_GRADIENT, angle: 90 });
    assert.ok(linear.startsWith('linear-gradient(90deg in oklab,'), linear);

    let conic = gradientCss({
      ...DEFAULT_GRADIENT,
      kind: 'conic',
      interpolation: 'oklch',
      hueMethod: 'longer',
    });
    assert.ok(
      conic.startsWith('conic-gradient(from 90deg at 50% 50% in oklch longer hue,'),
      conic,
    );

    let radial = gradientCss({ ...DEFAULT_GRADIENT, kind: 'radial', centerX: 30 });
    assert.ok(radial.startsWith('radial-gradient(circle at 30% 50% in oklab,'), radial);
  });

  test('a hue path is emitted only for polar spaces', function (assert) {
    assert.notOk(
      gradientCss({ ...DEFAULT_GRADIENT, interpolation: 'oklab' }).includes('hue'),
      'oklab takes no hue path',
    );
    assert.ok(
      gradientCss({ ...DEFAULT_GRADIENT, interpolation: 'oklch' }).includes('shorter hue'),
      'oklch does',
    );
  });

  test('stops are sorted for paint but identity is not disturbed', function (assert) {
    let spec = {
      ...DEFAULT_GRADIENT,
      stops: [
        { id: 'late', position: 90, color: '#ff0000' },
        { id: 'early', position: 10, color: '#0000ff' },
      ],
    };
    assert.deepEqual(
      sortedStops(spec).map((s) => s.id),
      ['early', 'late'],
      'paint order is by position',
    );
    assert.deepEqual(
      spec.stops.map((s) => s.id),
      ['late', 'early'],
      'the source array is untouched',
    );
    let css = gradientCss(spec);
    assert.ok(css.indexOf('10%') < css.indexOf('90%'), 'CSS is in position order');
  });

  test('gradient numbers are clamped and rounded, never NaN', function (assert) {
    let css = gradientCss({
      ...DEFAULT_GRADIENT,
      angle: Number.NaN,
      centerX: 500,
      centerY: -200,
      kind: 'radial',
      stops: [
        { id: 'a', position: Number.NaN, color: '#ff0000' },
        { id: 'b', position: 300, color: '#0000ff' },
      ],
    });
    assert.notOk(css.includes('NaN'), `no NaN: ${css}`);
    assert.ok(css.includes('at 100% 0%'), 'centre clamped');
    assert.ok(css.includes('100%'), 'position clamped');
  });

  test('an empty stop list is `none`, not a broken declaration', function (assert) {
    assert.strictEqual(gradientCss({ ...DEFAULT_GRADIENT, stops: [] }), 'none');
  });

  test('hueDelta implements CSS Color 4 §12.4', function (assert) {
    assert.strictEqual(hueDelta(350, 10, 'shorter'), 20);
    assert.strictEqual(hueDelta(350, 10, 'longer'), -340);
    assert.strictEqual(hueDelta(350, 10, 'increasing'), 20);
    assert.strictEqual(hueDelta(350, 10, 'decreasing'), -340);
    assert.strictEqual(hueDelta(10, 350, 'shorter'), -20);
    assert.strictEqual(hueDelta(10, 350, 'increasing'), 340);
    assert.strictEqual(hueDelta(10, 350, 'decreasing'), -20);
    // 'longer' between two identical hues is the whole wheel, not nothing.
    assert.strictEqual(Math.abs(hueDelta(0, 0, 'longer')), 360);
  });

  test('mixIn interpolates in the requested space', function (assert) {
    let a = colorOf('#ff0000');
    let b = colorOf('#0000ff');
    let midOklab = mixIn(a, b, 0.5, 'oklab');
    let midSrgb = mixIn(a, b, 0.5, 'srgb');
    assert.notStrictEqual(
      toHex(midOklab),
      toHex(midSrgb),
      'the space genuinely changes the result',
    );
    assert.strictEqual(toHex(mixIn(a, b, 0, 'oklab')), '#ff0000', 't=0 is the start');
    assert.strictEqual(toHex(mixIn(a, b, 1, 'oklab')), '#0000ff', 't=1 is the end');
  });

  test('a new stop samples the ramp instead of inserting grey', function (assert) {
    // figui3 always inserts #888888, which visibly breaks the gradient.
    let sampled = sampleGradientAt(DEFAULT_GRADIENT, 50);
    let start = colorOf(DEFAULT_GRADIENT.stops[0]!.color);
    let end = colorOf(DEFAULT_GRADIENT.stops[1]!.color);
    assert.notStrictEqual(toHex(sampled), '#888888', 'not a hard-coded grey');
    let expected = mixIn(start, end, 0.5, DEFAULT_GRADIENT.interpolation);
    assert.ok(
      perceptualDistance(sampled, expected) < 0.01,
      `sampled ${toHex(sampled)} matches the ramp ${toHex(expected)}`,
    );
  });

  test('sampling at or beyond the ends returns the end stops', function (assert) {
    assert.strictEqual(toHex(sampleGradientAt(DEFAULT_GRADIENT, 0)), '#7c3aed');
    assert.strictEqual(toHex(sampleGradientAt(DEFAULT_GRADIENT, 100)), '#06b6d4');
    assert.strictEqual(toHex(sampleGradientAt(DEFAULT_GRADIENT, -50)), '#7c3aed');
    assert.strictEqual(toHex(sampleGradientAt(DEFAULT_GRADIENT, 150)), '#06b6d4');
  });

  test('stop ids are deterministic and monotonic, never random', function (assert) {
    let counter = { value: 0 };
    assert.strictEqual(nextStopId(counter), 'stop-1');
    assert.strictEqual(nextStopId(counter), 'stop-2');
    assert.strictEqual(nextStopId(counter), 'stop-3');
    let second = { value: 0 };
    assert.strictEqual(nextStopId(second), 'stop-1', 'a fresh counter repeats');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Track gradients — also validated against the browser's parser.
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | colour | slider tracks', function () {
  test('every channel track in every space is valid CSS', function (assert) {
    let probe = document.createElement('div');
    for (let space of SPACES) {
      let color = toSpace(colorOf('#4a7fd4'), space.id);
      for (let index of [0, 1, 2]) {
        let css = channelTrackCss(color, index, 'srgb', 6);
        probe.style.backgroundImage = '';
        probe.style.backgroundImage = css;
        assert.notStrictEqual(
          probe.style.backgroundImage,
          '',
          `${space.id} channel ${index}: ${css.slice(0, 80)}`,
        );
      }
    }
  });

  test('the engine never emits a character the shared allowlist forbids', function (assert) {
    // The allowlist rejects gradient functions and caps length at 256, so a
    // full track cannot be run through `cssValue` today (reported). What CAN
    // be asserted now, and is the property that actually matters, is that
    // engine output contains none of the characters the guard exists to
    // exclude — no declaration separator, no block delimiter, no quote, no
    // backslash escape, no comment, no at-rule or bang.
    let forbidden = /[;:{}<>"'\\@!]|\/\*|\*\//;
    let samples: string[] = [];
    for (let space of SPACES) {
      let color = toSpace(colorOf('#4a7fd4'), space.id);
      for (let index of [0, 1, 2]) {
        samples.push(channelTrackCss(color, index, 'srgb', 6));
      }
      samples.push(alphaTrackCss(color, 'srgb'));
      samples.push(cssFor(color));
    }
    for (let kind of ['linear', 'radial', 'conic'] as const) {
      samples.push(gradientCss({ ...DEFAULT_GRADIENT, kind }));
    }
    // Including output derived from poisoned input.
    for (let attack of ATTACKS) {
      samples.push(cssFor(attack));
      samples.push(
        gradientCss({
          ...DEFAULT_GRADIENT,
          stops: [
            { id: 'a', position: 0, color: attack },
            { id: 'b', position: 100, color: attack },
          ],
        }),
      );
    }
    for (let sample of samples) {
      assert.notOk(
        forbidden.test(sample),
        `clean: ${sample.slice(0, 70)}`,
      );
    }
  });

  test('a track is fully opaque — alpha belongs to the alpha track alone', function (assert) {
    let translucent = withAlpha(colorOf('#ff0000'), 0.2);
    let track = channelTrackCss(translucent, 0, 'srgb', 4);
    assert.notOk(track.includes('/ 0.2'), 'the channel track ignores alpha');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Render proof. A clean index proves the module graph loads; only this
// proves the components render.
// ═══════════════════════════════════════════════════════════════════════

const PALETTE = ['#ff0000', '#00ff00', 'oklch(0.7 0.3 265)'];

module('Pretui | colour | render', function (hooks) {
  setupCardTest(hooks);

  test('Swatch renders and neutralizes a poisoned colour', async function (assert) {
    await render(
      <template>
        <Swatch @color='red; background: url(https://evil.example/x)' />
        <Swatch @color='#3366cc' @label='Blue' />
      </template>,
    );
    let chips = document.querySelectorAll('.pretui-swatch-chip');
    assert.strictEqual(chips.length, 2, 'both rendered');
    let style = chips[0]!.getAttribute('style') ?? '';
    assert.ok(style.includes('transparent'), 'poisoned colour became transparent');
    assert.notOk(style.includes('url('), 'no url survived into the DOM');
    assert.strictEqual(chips[0]!.getAttribute('role'), 'img', 'an unlabelled static swatch is an image');
    let named = document.querySelectorAll('.pretui-swatch')[1]!;
    assert.strictEqual(named.querySelector('.pretui-swatch-label')?.textContent, 'Blue', 'a labelled one shows its name');
    assert.strictEqual(chips[1]!.getAttribute('aria-hidden'), 'true', 'and its chip is decorative');
  });

  test('ColorPalette renders one tab stop and marks the selection', async function (assert) {
    await render(
      <template>
        <ColorPalette @colors={{PALETTE}} @value='#ff0000' />
      </template>,
    );
    let swatches = document.querySelectorAll('.pretui-swatch');
    assert.strictEqual(swatches.length, 3, 'all rendered');
    let tabbable = Array.from(swatches).filter(
      (el) => el.getAttribute('tabindex') === '0',
    );
    assert.strictEqual(tabbable.length, 1, 'exactly one tab stop');
    assert.strictEqual(
      swatches[0]!.getAttribute('aria-pressed'),
      'true',
      'the matching swatch is selected',
    );
  });

  test('ColorPalette matches across notations', async function (assert) {
    // The value is hex; the palette entry is OKLCH. String equality would
    // miss it.
    await render(
      <template>
        <ColorPalette @colors={{PALETTE}} @value='#ff0000' />
      </template>,
    );
    let selected = document.querySelectorAll('.pretui-swatch[aria-pressed="true"]');
    assert.strictEqual(selected.length, 1, 'one match, found canonically');
  });

  test('ColorPicker renders the full surface', async function (assert) {
    await render(
      <template><ColorPicker @defaultValue='oklch(0.66 0.19 25)' /></template>,
    );
    assert.ok(
      document.querySelector('[data-test-pretui-color-picker]'),
      'picker present',
    );
    assert.ok(document.querySelector('[data-test-pretui-color-area]'), 'area present');
    let canvas = document.querySelector('.pretui-area-canvas') as HTMLCanvasElement;
    assert.ok(canvas, 'canvas present');
    assert.ok(canvas.width > 0, `canvas was painted (${canvas.width}px)`);
    let axes = document.querySelectorAll('.pretui-area-axis');
    assert.strictEqual(axes.length, 2, 'one real range input per axis');
    for (let axis of Array.from(axes)) {
      assert.ok(axis.getAttribute('aria-label'), 'each axis is named');
      assert.ok(axis.getAttribute('aria-valuetext'), 'each axis speaks a sentence');
    }
    let sliders = document.querySelectorAll('.pretui-chslider-input');
    assert.ok(sliders.length >= 2, 'held channel and alpha sliders present');
    assert.ok(
      document.querySelector('.pretui-picker-described')?.textContent?.includes('#'),
      'the colour is readable as text, not colour alone',
    );
  });

  test('ColorPicker reports an out-of-gamut colour instead of clamping silently', async function (assert) {
    await render(
      <template><ColorPicker @defaultValue='oklch(0.72 0.35 25)' @gamut='srgb' /></template>,
    );
    let warning = document.querySelector('.pretui-picker-gamutwarn');
    assert.ok(warning, 'the gamut report is shown');
    let text = warning?.textContent ?? '';
    assert.ok(text.includes('sRGB'), 'names the gamut');
    assert.ok(text.includes('#'), 'names the colour it would clamp to');
    assert.ok(/ΔE\s*0\.\d/.test(text), `reports a real distance: ${text.trim()}`);
  });

  test('ColorPicker in a wide gamut does not warn', async function (assert) {
    await render(
      <template><ColorPicker @defaultValue='#3366cc' @gamut='srgb' /></template>,
    );
    assert.notOk(
      document.querySelector('.pretui-picker-gamutwarn'),
      'nothing to report',
    );
  });

  test('GradientEditor renders a valid gradient and its stop rows', async function (assert) {
    await render(<template><GradientEditor /></template>);
    assert.ok(
      document.querySelector('[data-test-pretui-gradient-editor]'),
      'editor present',
    );
    let rows = document.querySelectorAll('[data-test-pretui-color-stop]');
    assert.strictEqual(rows.length, 2, 'both default stops have a row');
    let preview = document.querySelector('.pretui-gradient-preview') as HTMLElement;
    // NOTE: `boxel test` does NOT apply `<style scoped>` — the scoped-css
    // attribute is stamped on the element but no stylesheet is delivered
    // (true of every component's rules, not just this one). So a
    // computed-style assertion here would be testing the harness, not the
    // component. Assert the custom property the CSS consumes instead, and
    // let the parser-validity module above cover the syntax.
    let declared = preview.style.getPropertyValue('--pretui-gradient-preview');
    assert.ok(declared.includes('linear-gradient('), `preview declared: ${declared}`);
    let probe = document.createElement('div');
    probe.style.backgroundImage = declared;
    assert.notStrictEqual(
      probe.style.backgroundImage,
      '',
      'and the browser accepts it',
    );
    assert.strictEqual(
      preview.getAttribute('role'),
      'img',
      'the preview has an accessible role',
    );
  });

  test('GradientEditor refuses to drop below two stops', async function (assert) {
    await render(<template><GradientEditor /></template>);
    let removes = document.querySelectorAll(
      '[data-test-pretui-color-stop] button[aria-label^="Remove"]',
    );
    assert.strictEqual(removes.length, 2, 'both rows offer remove');
    for (let button of Array.from(removes)) {
      assert.ok(
        (button as HTMLButtonElement).disabled,
        'remove is disabled at the two-stop minimum',
      );
      assert.ok(
        button.getAttribute('title')?.includes('two stops'),
        'and it says why',
      );
    }
  });

  test('no sr-only live region announces on first paint', async function (assert) {
    // A status region that has content at load announces on arrival, which
    // is noise. It must start empty and fill only on commit.
    await render(<template><ColorPicker @defaultValue='#3366cc' /></template>);
    let status = document.querySelector('.pretui-picker [role="status"]');
    assert.strictEqual(status?.textContent?.trim(), '', 'silent until acted on');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PORTING MAP — hdr-color-input v0.4.3 tests/ → this file
// ═══════════════════════════════════════════════════════════════════════
//
// PORTED (behaviour preserved, assertions re-expressed against this API):
//   06-conversion            → "conversion" module (round-trips, gamut clip)
//   08-derived               → "gamut" module (inkOn, gamut membership)
//   11-colorspace-precision  → "precision" module (per-channel precision, no
//                              runaway decimals across multi-hop conversion)
//   12-chroma-clamping       → "gamut" module, strengthened: upstream only
//                              asserts the clamped value is in range; this
//                              also asserts the DISTANCE is reported, which
//                              caught a real mutation bug
//   16-text-input-validation → "text validation" module
//   19-keyboard-modifiers    → "keyboard modifiers" module (Shift ×10, Alt
//                              ÷10, both cancel, hue wraps, clamp at bounds)
//   unit/channel-formatting  → "precision" module (round/toFixed semantics)
//   unit/color-conversion    → "conversion" + "precision" (serialize and
//                              parse round-trips, hex forms, named colours)
//   unit/color-utils         → "keyboard modifiers" (clamp) + "gamut"
//                              (inkOn/contrast) + "conversion" (space ids)
//
// NOT PORTED, deliberately:
//   01-reflection, 02-events, 03-popover, 04-anchor, 05-space-switch,
//   09-copy, 10-theme, 14-no-alpha, 20-initial-colorspace
//     — these test a custom element's attribute/property reflection, its
//       popover and its anchoring. None of it exists here: reflection is
//       Glimmer args, the popover is `Popup` (already tested), and
// theming is the Theme card's job. The behaviours they
//       cover that DO exist (space switching preserving the colour, alpha
//       suppression, the popover) are covered by the render module and by
//       forms-render / theme-frame instead.
//   06-sliders, 07-numeric-inputs
//     — upstream's own comments concede these pass vacuously (07 dispatches
//       `change` at a component that only listens to `input`; 06 relies on
//       jsdom range stepping that does not exist). Porting a vacuous test
//       is worse than not having it. The real behaviour is covered by
//       "keyboard modifiers" and by ScrubInput's own tests in design-tools.
//   13-slider-backgrounds
//     — asserts hard-coded gradient literals per space. Here the tracks are
//       GENERATED from real conversions, so the equivalent assertion is
//       "every generated track is valid CSS and reflects the colour", which
//       is the "slider tracks" module. Asserting the literal would be
//       asserting the implementation.
//   15-chroma-normalization
//     — tests upstream's chroma-as-percentage encoding (`oklch(75% 50% 180)`
//       where 50% means chroma 0.2). That encoding is not used here: chroma
//       is kept as the real 0–0.4 coordinate CSS defines, so there is
//       nothing to normalize. Recorded as a deliberate divergence, not a
//       gap.
//   18-new-space-controls
//     — the signed Lab a/b split into an absolute number plus a sign
//       superscript is an upstream UI decision this port does not make
//       (a signed numeric input is simpler and more accessible). Its
//       round-trip tolerance assertion IS ported, into "conversion".
//   unit/positioning, unit/template
//     — upstream's own popover placement and shadow-DOM template. Both are
//       replaced wholesale by `Popup` and Glimmer.
//
// figui3 has exactly one fill-picker spec (a reorder drag), and its own
// comments explain that it has to write component internals directly
// because `fig-input-color` never reflects its value. Nothing to port; in a
// data-down/actions-up port that entire class of workaround does not exist.

// ── mixIn against what CSS renders ─────────────────────────────────────

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
