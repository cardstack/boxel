// Pretui — the caller-value guard, pinned.
//
// `cssValue` is a pure function, so it is testable directly and the injection
// cases are exactly what a test should hold still: every one of these strings
// reached `htmlSafe` unmodified before 2026-08-13.
import { module, test } from 'qunit';
import {
  cssValue,
  cssNumber,
  cssDeclaration,
  cssStyle,
  cssStyleFrom,
  PRETUI_Z,
  zVarName,
  PRETUI_Z_SCALE_CSS,
} from './pretui-css';

module('Pretui | cssValue guard', function () {
  test('rejects the injection cases', function (assert) {
    let attacks: [string, string][] = [
      ['red; background: url(https://evil.example/x)', 'the reported attack'],
      ['red;background:red', 'no whitespace does not help'],
      ['red\\3b background: red', 'a CSS escape for the semicolon'],
      ['</style><script>alert(1)</script>', 'escaping the style element'],
      ['expression(alert(1))', 'a legacy IE expression'],
      ['url(https://evil.example/x)', 'a bare url()'],
      ['image-set(url(x))', 'url() one level down'],
      ["attr(data-x, 'red')", 'attr() and a quote'],
      ['var(--x', 'unbalanced open paren'],
      ['var(--x))', 'unbalanced close paren'],
      [';', 'a bare semicolon'],
      [':', 'a bare colon'],
      ['red !important', 'kit law says never, so the guard says never'],
      ['red /* ; */', 'a comment that could hide a semicolon'],
      ['red } .other { color: red', 'closing the implied block'],
      ['@import "evil.css"', 'an at-rule'],
      ['#12', 'a malformed hex literal'],
      ['#nothex', 'a # that is not a colour at all'],
      ['(red)', 'a bare grouping paren, not a function call'],
      ['{color: red}', 'a declaration block'],
      ['red\nbackground: blue', 'a newline instead of a semicolon'],
    ];
    for (let [input, why] of attacks) {
      assert.strictEqual(cssValue(input), undefined, why + ' — ' + input);
    }
  });

  test('rejects non-strings, blanks and absurd lengths', function (assert) {
    assert.strictEqual(cssValue(undefined), undefined, 'undefined');
    assert.strictEqual(cssValue(null), undefined, 'null');
    assert.strictEqual(cssValue(42), undefined, 'a number');
    assert.strictEqual(cssValue({}), undefined, 'an object');
    assert.strictEqual(cssValue(''), undefined, 'empty');
    assert.strictEqual(cssValue('   '), undefined, 'whitespace only');
    assert.strictEqual(
      cssValue('a'.repeat(5000)),
      undefined,
      'longer than any legitimate value',
    );
    assert.strictEqual(
      cssValue('var(var(var(var(var(var(--x))))))'),
      undefined,
      'nested deeper than any legitimate value',
    );
  });

  test('passes the values the kit actually routes through it', function (assert) {
    let good = [
      'red',
      'currentColor',
      'transparent',
      '#f0a',
      '#ff00aa',
      '#ff00aa80',
      'rgb(255 0 128 / 0.5)',
      'rgba(255, 0, 128, 0.5)',
      'hsl(320 100% 50%)',
      'oklch(0.72 0.16 163)',
      'var(--chart-1)',
      'var(--chart-1, oklch(0.72 0.16 163))',
      'color-mix(in srgb, var(--hue) 14%, var(--card))',
      'light-dark(var(--a), var(--b))',
      '320px',
      '40vh',
      '100%',
      '1.5rem',
      'calc(100vh - 40px)',
      'min(60ch, 100%)',
      'clamp(200px, 40vw, 480px)',
      'max(2px, 0.5em)',
      'ease-in-out',
      'cubic-bezier(0.23, 1, 0.32, 1)',
      'steps(4, end)',
    ];
    for (let input of good) {
      assert.strictEqual(cssValue(input), input, 'passes ' + input);
    }
    assert.strictEqual(cssValue('  red  '), 'red', 'trims');
  });

  test('rejects grid/url-adjacent functions the kit never needs', function (assert) {
    assert.strictEqual(cssValue('repeat(3, 1fr)'), undefined, 'repeat()');
    // Gradients WERE rejected here. They are now allowed, because the colour
    // work measured the cost of refusing them: every generated channel track
    // and gradient preview was being silently dropped. Admitting the function
    // names widens nothing — their arguments still pass through the same
    // character and function allowlist, which is what the next two assertions
    // pin down.
    assert.strictEqual(
      cssValue('linear-gradient(red, blue)'),
      'linear-gradient(red, blue)',
      'gradients are values the kit generates and must be able to emit',
    );
    assert.strictEqual(
      cssValue('linear-gradient(red, url(https://evil/x))'),
      undefined,
      'a gradient cannot smuggle url() past the guard',
    );
    assert.strictEqual(
      cssValue('conic-gradient(in oklch, var(--chart-1), var(--chart-2))'),
      'conic-gradient(in oklch, var(--chart-1), var(--chart-2))',
      'interpolation space and tokens survive',
    );
    assert.strictEqual(cssValue('element(#a)'), undefined, 'element()');
  });

  test('cssDeclaration builds only from a validated value', function (assert) {
    assert.strictEqual(
      cssDeclaration('--pretui-chip-hue', 'var(--chart-1)'),
      '--pretui-chip-hue: var(--chart-1)',
      'custom property',
    );
    assert.strictEqual(
      cssDeclaration('background', '#ff00aa'),
      'background: #ff00aa',
      'plain property',
    );
    assert.strictEqual(
      cssDeclaration('--pretui-chip-hue', 'red; background: url(x)'),
      undefined,
      'a rejected value yields no declaration at all',
    );
    assert.strictEqual(
      cssDeclaration('background; color', 'red'),
      undefined,
      'the property name is validated too',
    );
  });

  test('cssStyle and cssStyleFrom omit rather than emit empty', function (assert) {
    assert.strictEqual(
      String(cssStyle('--pretui-fit-hue', 'var(--chart-2)')),
      '--pretui-fit-hue: var(--chart-2)',
      'a SafeString of the declaration',
    );
    assert.strictEqual(
      cssStyle('--pretui-fit-hue', 'red; background: url(x)'),
      undefined,
      'rejected values produce no style attribute',
    );
    assert.strictEqual(
      String(cssStyleFrom(['a: 1', undefined, 'b: 2'])),
      'a: 1; b: 2',
      'drops the rejected parts',
    );
    assert.strictEqual(
      cssStyleFrom([undefined, undefined]),
      undefined,
      'nothing survived means no attribute',
    );
  });
});

module('Pretui | cssNumber guard', function () {
  test('rejects everything that is not wholly a number', function (assert) {
    let rejected: [unknown, string][] = [
      ['0; background: red', 'a declaration smuggled in behind a number'],
      [
        '12px',
        'a unit — the caller supplies the bare number, the site adds px',
      ],
      ['1e3', 'exponent notation'],
      ['+5', 'a leading plus'],
      ['0x10', 'hex'],
      ['', 'the empty string'],
      ['   ', 'whitespace only'],
      [NaN, 'NaN'],
      [Infinity, 'Infinity'],
      [-Infinity, '-Infinity'],
      [null, 'null'],
      [undefined, 'undefined'],
      [true, 'a boolean'],
      [{}, 'an object'],
      [[5], 'an array, which String() would happily render as 5'],
    ];
    for (let [raw, why] of rejected) {
      assert.strictEqual(cssNumber(raw, 0, 100), undefined, why);
    }
  });

  test('accepts a number, or a string that is nothing but a number', function (assert) {
    assert.strictEqual(cssNumber(7, 0, 100), 7, 'a number');
    assert.strictEqual(
      cssNumber(0, 0, 100),
      0,
      'zero is a value, not an absence',
    );
    assert.strictEqual(
      cssNumber(-3, -10, 10),
      -3,
      'negatives inside the range',
    );
    assert.strictEqual(cssNumber(1.5, 0, 100), 1.5, 'fractions');
    assert.strictEqual(cssNumber('.5', 0, 100), 0.5, 'a leading dot');
    assert.strictEqual(cssNumber('7', 0, 100), 7, 'a numeric string');
    assert.strictEqual(
      cssNumber(' 12 ', 0, 100),
      12,
      'surrounding whitespace is trimmed',
    );
  });

  test('clamps rather than rejecting an out-of-range number, and the bounds are inclusive', function (assert) {
    // The deliberate difference from `cssValue`, which only ever passes or
    // rejects: a clamp keeps the DIRECTION of the caller's intent, where a
    // reject would substitute the stylesheet default and lose it. `@rest={{2}}`
    // on Spotlight means "as opaque as it goes", and 1 delivers that; the
    // component's own 0.34 default does not.
    assert.strictEqual(cssNumber(500, 0, 100), 100, 'above the ceiling');
    assert.strictEqual(cssNumber(-500, 0, 100), 0, 'below the floor');
    assert.strictEqual(
      cssNumber('99999', 0, 512),
      512,
      'a numeric string clamps too',
    );
    assert.strictEqual(cssNumber(0, 0, 1), 0, 'the floor itself is accepted');
    assert.strictEqual(cssNumber(1, 0, 1), 1, 'and so is the ceiling');
  });

  test('a rejected value leaves no partial declaration behind', function (assert) {
    // The guard's whole job: the site writes `${cssNumber(...) ?? fallback}`,
    // so a refusal must be distinguishable from a zero.
    assert.strictEqual(
      cssNumber('0; background: red', 0, 512) ?? 40,
      40,
      'the component default paints, not the injected 0',
    );
    assert.strictEqual(
      cssNumber(0, 0, 512) ?? 40,
      0,
      'and a real zero is still a real zero',
    );
  });
});

module('Pretui | stacking scale', function () {
  test('the tiers are strictly ordered', function (assert) {
    let order = [
      'base',
      'raised',
      'sticky',
      'sticky-header',
      'scrim',
      'dropdown',
      'overlay',
      'tooltip',
      'dialog',
      'toast',
    ] as const;
    for (let i = 1; i < order.length; i++) {
      let lower = order[i - 1] as (typeof order)[number];
      let upper = order[i] as (typeof order)[number];
      assert.ok(
        PRETUI_Z[lower] < PRETUI_Z[upper],
        lower +
          ' (' +
          PRETUI_Z[lower] +
          ') paints under ' +
          upper +
          ' (' +
          PRETUI_Z[upper] +
          ')',
      );
    }
  });

  test('a scrim never outranks the surface it dismisses', function (assert) {
    assert.ok(
      PRETUI_Z.scrim < PRETUI_Z.dropdown,
      'a scrim above its own dropdown would eat every option click',
    );
    assert.ok(
      PRETUI_Z.scrim < PRETUI_Z.overlay,
      'and the same for a popover panel',
    );
  });

  test('token names and the CSS block agree with the table', function (assert) {
    assert.strictEqual(zVarName('dropdown'), '--pretui-z-dropdown');
    assert.ok(
      PRETUI_Z_SCALE_CSS.includes('--pretui-z-dropdown: 60;'),
      'the emitted CSS restates the canonical number',
    );
    assert.ok(
      PRETUI_Z_SCALE_CSS.includes('--pretui-z-toast: 100;'),
      'including the top tier',
    );
  });
});
