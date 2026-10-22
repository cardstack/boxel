// Pretui — proof for motion-text.gts (TextEffects, PathText, TextMorph).
//
// Motion is the hardest thing in a kit to review, because the reviewer looks
// at a still frame and the component's whole argument is about what happens
// between frames. So this file asserts the two things that CAN be settled:
//
//  1. **The choreography as arithmetic.** Which unit occupies which stagger
//     slot, and which glyphs survive a morph, are number and string
//     problems. The LCS diff in particular is the entire reason TextMorph
//     exists rather than being a cross-fade.
//  2. **The end state, and the accessible text.** Law 5 requires that
//     `prefers-reduced-motion` land on the END state; the mechanism is that
//     every base style IS the end state. What a render test can prove is the
//     other half of the contract: the full string is present and readable
//     with the animated copy hidden from assistive technology.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { PathText, arcPath, circlePath, safePathData, wavePath } from './components/path-text';
import { TextEffects, splitUnits, staggerOrder } from './components/text-effects';
import { TextMorph, morphPlan } from './components/text-morph';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function roles(from: string, to: string): string {
  return morphPlan(from, to)
    .map((step) => (step.role === 'keep' ? '=' : step.role === 'out' ? '-' : '+'))
    .join('');
}

module('Pretui | text effects | unit splitting', function () {
  test('characters', function (assert) {
    assert.deepEqual(splitUnits('ab c', 'char'), ['a', 'b', ' ', 'c']);
  });

  test('words KEEP their whitespace as units', function (assert) {
    assert.deepEqual(
      splitUnits('one two  three', 'word'),
      ['one', ' ', 'two', '  ', 'three'],
      'a word stagger that drops its spaces re-joins the text wrongly',
    );
  });

  test('lines', function (assert) {
    assert.deepEqual(splitUnits('a\nb', 'line'), ['a', 'b']);
  });

  test('an empty string produces no units rather than one empty one', function (assert) {
    assert.deepEqual(splitUnits('', 'char'), []);
    assert.deepEqual(splitUnits('', 'word'), []);
  });

  test('astral characters survive being split per character', function (assert) {
    assert.deepEqual(
      splitUnits('a\u{1F334}b', 'char'),
      ['a', '\u{1F334}', 'b'],
      'Array.from iterates code points, not UTF-16 units',
    );
  });
});

module('Pretui | text effects | stagger order', function () {
  test('forward is the identity', function (assert) {
    assert.deepEqual(staggerOrder(4, 'forward'), [0, 1, 2, 3]);
  });

  test('reverse runs the schedule backwards', function (assert) {
    assert.deepEqual(staggerOrder(4, 'reverse'), [3, 2, 1, 0]);
  });

  test('centre starts in the middle and works outward', function (assert) {
    assert.deepEqual(
      staggerOrder(5, 'centre'),
      [2, 1, 0, 1, 2],
      'the middle unit has slot zero and the ends go last',
    );
  });

  test('edges is centre inverted — the ends move first', function (assert) {
    assert.deepEqual(staggerOrder(5, 'edges'), [0, 1, 2, 1, 0]);
  });

  test('shuffle is a PERMUTATION, and it is deterministic', function (assert) {
    let once = staggerOrder(8, 'shuffle', 12345);
    let twice = staggerOrder(8, 'shuffle', 12345);
    assert.deepEqual(once, twice, 'the same seed always dances the same way — a screenshot is reproducible');
    assert.deepEqual(
      once.slice().sort((a, b) => a - b),
      [0, 1, 2, 3, 4, 5, 6, 7],
      'every slot is used exactly once, which a hash-per-index approach cannot guarantee',
    );
    assert.notDeepEqual(
      staggerOrder(8, 'shuffle', 999),
      once,
      'and a different seed gives a different dance',
    );
  });

  test('degenerate counts', function (assert) {
    assert.deepEqual(staggerOrder(0, 'forward'), []);
    assert.deepEqual(staggerOrder(-3, 'shuffle', 1), []);
    assert.deepEqual(staggerOrder(1, 'centre'), [0]);
  });
});

module('Pretui | path text | geometry and guards', function () {
  test('the built-in paths are well-formed path data', function (assert) {
    assert.true(circlePath(240, 90).indexOf('M 120 30') === 0, 'the circle starts at 12 oclock, where a reader looks first');
    assert.ok(safePathData(circlePath(240, 90)), 'and it passes the allowlist it will be measured by');
    assert.ok(safePathData(arcPath(240, 90)));
    assert.ok(safePathData(wavePath(240, 30)));
  });

  test('caller path data is an ALLOWLIST, dropped whole rather than cleaned', function (assert) {
    assert.strictEqual(safePathData('M 0 0 L 10 10 Z'), 'M 0 0 L 10 10 Z', 'plain data passes');
    assert.strictEqual(safePathData('  M 0 0 L 1 1  '), 'M 0 0 L 1 1', 'and is trimmed');
    assert.strictEqual(safePathData('M0 0" onload="x'), undefined, 'an attribute break-out');
    assert.strictEqual(safePathData('url(https://evil/x)'), undefined, 'a function call');
    assert.strictEqual(safePathData('<path/>'), undefined, 'markup');
    assert.strictEqual(safePathData(''), undefined);
    assert.strictEqual(safePathData(undefined), undefined, 'an @arg declared string can still arrive undefined');
    assert.strictEqual(safePathData(42), undefined, 'or as a number');
  });
});

module('Pretui | text morph | shared-letter diff', function () {
  test('an unchanged string keeps every glyph', function (assert) {
    assert.strictEqual(roles('abc', 'abc'), '===');
  });

  test('the shared prefix survives — this is the whole component', function (assert) {
    let plan = morphPlan('Da Hong Pao', 'Da Yu Ling');
    let kept = plan
      .filter((s) => s.role === 'keep')
      .map((s) => s.ch)
      .join('');
    assert.true(
      kept.indexOf('Da ') === 0,
      'the shared prefix is retained rather than cross-faded away: kept "' + kept + '"',
    );
    assert.true(kept.length > 3, 'and more than the prefix survives');
  });

  test('every glyph of the target string is present, in order', function (assert) {
    let plan = morphPlan('Silver Needle', 'Silver Peony');
    let result = plan
      .filter((s) => s.role !== 'out')
      .map((s) => s.ch)
      .join('');
    assert.strictEqual(result, 'Silver Peony', 'the end state IS the target string');
  });

  test('and every glyph of the source is accounted for', function (assert) {
    let plan = morphPlan('Silver Needle', 'Silver Peony');
    let before = plan
      .filter((s) => s.role !== 'in')
      .map((s) => s.ch)
      .join('');
    assert.strictEqual(before, 'Silver Needle', 'the start state IS the source string');
  });

  test('growing from nothing, and shrinking to nothing', function (assert) {
    assert.strictEqual(roles('', 'abc'), '+++');
    assert.strictEqual(roles('abc', ''), '---');
    assert.strictEqual(roles('', ''), '');
  });

  test('a pure insertion inserts rather than replacing', function (assert) {
    assert.strictEqual(roles('ac', 'abc'), '=+=');
  });

  test('a pure deletion deletes', function (assert) {
    assert.strictEqual(roles('abc', 'ac'), '=-=');
  });

  test('two strings with nothing in common share nothing', function (assert) {
    let plan = morphPlan('xyz', 'QRS');
    assert.strictEqual(plan.filter((s) => s.role === 'keep').length, 0);
    assert.strictEqual(plan.length, 6, 'three out and three in');
  });

  test('very long strings degrade to a plain swap rather than becoming slow', function (assert) {
    let long = 'a'.repeat(400);
    let plan = morphPlan(long, long);
    assert.strictEqual(plan.length, 800, 'the quadratic diff is skipped past the limit');
    assert.strictEqual(plan.filter((s) => s.role === 'keep').length, 0);
  });
});

class MorphState {
  @tracked text = 'Da Hong Pao';
  next = () => (this.text = 'Da Yu Ling');
}

module('Pretui | motion text | render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('TextEffects renders the full string, with the glyph stack hidden from assistive tech', async function (assert) {
    await render(
      <template><TextEffects @text='Spring lots cleared customs' @per='word' /></template>,
    );
    let host = root().querySelector(
      '[data-test-pretui-text-effects]',
    ) as HTMLElement;
    assert.strictEqual(
      host.querySelector('.pretui-fx-sr')?.textContent,
      'Spring lots cleared customs',
      'the real string is mirrored intact — a per-glyph pile is not text to a screen reader',
    );
    assert.ok(
      host.querySelector('[aria-hidden="true"]'),
      'and the animated copy is hidden from the accessibility tree',
    );
    let units = host.querySelectorAll('.pretui-fx-unit');
    assert.strictEqual(units.length, 7, 'four words and three spaces');
  });

  test('TextEffects blanks are not animated', async function (assert) {
    await render(<template><TextEffects @text='a b' @per='word' /></template>);
    let blanks = root().querySelectorAll('.pretui-fx-unit[data-blank="true"]');
    assert.strictEqual(blanks.length, 1, 'the space is marked, so it does not reflow the line while the words arrive');
  });

  test('TextEffects carries its preset and grain as attributes, so the CSS can branch without a class soup', async function (assert) {
    await render(
      <template><TextEffects @text='hi' @effect='unmask' @per='char' /></template>,
    );
    let host = root().querySelector(
      '[data-test-pretui-text-effects]',
    ) as HTMLElement;
    assert.strictEqual(host.getAttribute('data-effect'), 'unmask');
    assert.strictEqual(host.getAttribute('data-per'), 'char');
  });

  test('PathText draws a textPath and names itself for assistive tech', async function (assert) {
    await render(
      <template><PathText @text='Wuyishan lot B-1181' @shape='circle' /></template>,
    );
    let svg = root().querySelector('svg') as SVGElement;
    assert.strictEqual(svg.getAttribute('role'), 'img', 'the SVG is one image');
    assert.strictEqual(
      svg.getAttribute('aria-label'),
      'Wuyishan lot B-1181',
      'with the string as its name, so a repeated ring is not read out three times',
    );
    let textPath = svg.querySelector('textPath');
    assert.ok(textPath, 'a real textPath, so the glyphs keep proper shaping');
    let href = textPath?.getAttribute('href') ?? '';
    assert.true(href.indexOf('#') === 0, 'pointing at a path in defs');
    assert.ok(
      svg.querySelector('defs path')?.getAttribute('d'),
      'and that path has data',
    );
  });

  test('PathText repeats the string with a separator', async function (assert) {
    await render(<template><PathText @text='LOT' @repeat={{3}} /></template>);
    let drawn = root().querySelector('textPath')?.textContent ?? '';
    assert.strictEqual(
      (drawn.match(/LOT/g) ?? []).length,
      3,
      'three times round the ring',
    );
  });

  test('PathText travel is OFF by default and refused on shapes where rotation would lie', async function (assert) {
    await render(<template><PathText @text='x' @shape='circle' /></template>);
    assert.strictEqual(
      (root().querySelector('svg') as SVGElement).getAttribute('data-travel'),
      null,
      'nothing turns unless asked — Law 5 is opt-in, not opt-out',
    );

    await render(
      <template><PathText @text='x' @shape='wave' @travel={{true}} /></template>,
    );
    assert.strictEqual(
      (root().querySelector('svg') as SVGElement).getAttribute('data-travel'),
      null,
      'rotating a wave would rotate the SHAPE, which is a different and wrong picture',
    );

    await render(
      <template><PathText @text='x' @shape='circle' @travel={{true}} /></template>,
    );
    assert.strictEqual(
      (root().querySelector('svg') as SVGElement).getAttribute('data-travel'),
      'true',
      'and a closed ring does turn',
    );
  });

  test('PathText drops a hostile path instead of writing it, and still renders', async function (assert) {
    await render(
      <template>
        <PathText @text='x' @shape='custom' @path='M0 0" onload="alert(1)' />
      </template>,
    );
    let d = root().querySelector('defs path')?.getAttribute('d') ?? '';
    assert.strictEqual(d.indexOf('onload'), -1, 'the injection never reaches the attribute');
    assert.true(d.indexOf('M ') === 0, 'and the preset circle is drawn instead — the caller loses their override, never the rendering');
  });

  test('TextMorph keeps the shared letters across a real text change', async function (assert) {
    let state = new MorphState();
    await render(
      <template>
        <TextMorph @text={{state.text}} />
        <button type='button' {{on 'click' state.next}}>next</button>
      </template>,
    );
    let host = root().querySelector(
      '[data-test-pretui-text-morph]',
    ) as HTMLElement;
    assert.strictEqual(
      host.querySelector('.pretui-morph-sr')?.textContent,
      'Da Hong Pao',
      'the sr mirror carries the real string',
    );
    assert.strictEqual(
      host.querySelectorAll('[data-role="out"]').length,
      0,
      'nothing is leaving on first render',
    );

    await click('button');
    assert.strictEqual(
      host.querySelector('.pretui-morph-sr')?.textContent,
      'Da Yu Ling',
      'the mirror follows the target',
    );
    let kept = Array.from(host.querySelectorAll('[data-role="keep"]'))
      .map((el) => el.textContent)
      .join('');
    assert.true(
      kept.indexOf('Da ') === 0,
      'and the shared prefix stayed put rather than being cross-faded: "' + kept + '"',
    );
    assert.true(
      host.querySelectorAll('[data-role="out"]').length > 0,
      'while the letters that did not survive are marked as leaving',
    );

    // The END STATE, which is what reduced motion lands on: everything that
    // is not leaving spells the target string exactly.
    let ending = Array.from(
      host.querySelectorAll('.pretui-morph-cell'),
    )
      .filter((el) => el.getAttribute('data-role') !== 'out')
      .map((el) => el.textContent)
      .join('');
    assert.strictEqual(
      ending,
      'Da Yu Ling',
      'with animation entirely disabled the component reads as the target string and nothing else',
    );
  });
});
