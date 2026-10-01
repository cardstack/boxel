// Pretui — design-tools: the interaction MATH, proven rather than asserted
// in prose. Every number a drag produces comes out of one of these pure
// functions, so "given a pointer delta and these modifier keys, this value
// results" is a unit test, not a claim.
//
// Local-only; run with `boxel test` from the realm mirror — never pushed.
import { module, test } from 'qunit';
import { render, blur, click, fillIn, focus, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { PanelSection } from './components/panel-section';
import { ScrubInput } from './components/scrub-input';
import { TokenInput } from './components/token-input';
import { COARSE, FINE, addToken, bezierEase, clampRange, formatMeasure, keyboardNudge, normalizeStops, parseMeasure, pointerDegrees, quantize, removeTokenAt, roundTo, scrubDelta, scrubMultiplier, shortestAngleDelta, snapToPoints, splitTokens, stopAt, stopIndexFor, stopStride, stopText, wrapDegrees } from './internal/design-tools';
import type { ScaleStops } from './internal/design-tools';

module('Pretui | design-tools math', function () {
  // ── modifier multipliers ───────────────────────────────────────────
  test('scrubMultiplier: plain / coarse / fine / both', function (assert) {
    assert.strictEqual(scrubMultiplier({}), 1, 'no modifier is ×1');
    assert.strictEqual(scrubMultiplier({ shift: true }), COARSE, 'Shift ×10');
    assert.strictEqual(scrubMultiplier({ alt: true }), FINE, 'Alt ×0.1');
    assert.strictEqual(scrubMultiplier({ meta: true }), FINE, '⌘ ×0.1');
    assert.strictEqual(
      scrubMultiplier({ shift: true, alt: true }),
      1,
      'Shift+Alt cancels to ×1 rather than compounding',
    );
    assert.strictEqual(
      scrubMultiplier({ ctrl: true }),
      1,
      'Ctrl is reserved (context menu on macOS) and changes nothing',
    );
  });

  // ── the scrub itself ───────────────────────────────────────────────
  test('scrubDelta: 1px = 1 step at the default rate', function (assert) {
    assert.strictEqual(scrubDelta(10, 1), 10, '+10px, step 1 → +10');
    assert.strictEqual(scrubDelta(-4, 1), -4, 'leftward travel is negative');
    assert.strictEqual(scrubDelta(10, 0.5), 5, 'step 0.5 halves the travel');
  });

  test('scrubDelta: modifiers scale the same travel', function (assert) {
    assert.strictEqual(
      scrubDelta(10, 1, { shift: true }),
      100,
      'Shift: 10px → 100',
    );
    assert.strictEqual(
      roundTo(scrubDelta(10, 1, { alt: true }), 6),
      1,
      'Alt: 10px → 1',
    );
  });

  test('scrubDelta: pixelsPerStep slows the hand', function (assert) {
    assert.strictEqual(scrubDelta(20, 1, {}, 4), 5, '4px per step');
    assert.strictEqual(
      scrubDelta(20, 1, {}, 0),
      20,
      'a zero/negative rate falls back to 1 instead of dividing by zero',
    );
  });

  test('scrubDelta is absolute from the gesture origin, so a round trip is lossless', function (assert) {
    // The component records the value at pointerdown and applies
    // scrubDelta(totalDx) each frame — never value += frameDelta. This is
    // what stops rounding drift over a long drag.
    let origin = 24;
    let frames = [3, 9, 17, 42, 17, 0];
    let results = frames.map((dx) => roundTo(origin + scrubDelta(dx, 1), 2));
    assert.deepEqual(results, [27, 33, 41, 66, 41, 24]);
    assert.strictEqual(
      results[results.length - 1],
      origin,
      'returning to the start returns the original value exactly',
    );
  });

  // ── the shared keyboard contract ───────────────────────────────────
  test('keyboardNudge: arrows carry both frames of reference', function (assert) {
    let right = keyboardNudge('ArrowRight');
    assert.true(right.handled);
    assert.strictEqual(right.dx, 1, 'screen: right is +x');
    assert.strictEqual(right.delta, 1, 'value: right increases');

    let up = keyboardNudge('ArrowUp');
    assert.strictEqual(up.dy, -1, 'screen: up is NEGATIVE y');
    assert.strictEqual(up.delta, 1, 'value: up still INCREASES');

    let down = keyboardNudge('ArrowDown');
    assert.strictEqual(down.dy, 1);
    assert.strictEqual(down.delta, -1);
  });

  test('keyboardNudge: modifiers and step compose', function (assert) {
    assert.strictEqual(keyboardNudge('ArrowRight', {}, 5).delta, 5, 'step 5');
    assert.strictEqual(
      keyboardNudge('ArrowRight', { shift: true }, 5).delta,
      50,
      'Shift ×10 on top of step',
    );
    assert.strictEqual(
      roundTo(keyboardNudge('ArrowRight', { alt: true }, 5).delta, 6),
      0.5,
      'Alt ×0.1',
    );
  });

  test('keyboardNudge: PageUp/Down are coarse regardless of modifiers', function (assert) {
    assert.strictEqual(keyboardNudge('PageUp', {}, 2).delta, 20);
    assert.strictEqual(
      keyboardNudge('PageDown', { alt: true }, 2).delta,
      -20,
      'Alt does not refine a page step',
    );
  });

  test('keyboardNudge: Home/End are range jumps, not deltas', function (assert) {
    let home = keyboardNudge('Home');
    assert.true(home.handled && home.toMin);
    assert.strictEqual(home.delta, 0, 'no delta — the caller uses the bound');
    let end = keyboardNudge('End');
    assert.true(end.handled && end.toMax);
  });

  test('keyboardNudge: an unclaimed key is not handled', function (assert) {
    for (let key of ['a', 'Tab', 'Enter', 'Escape', ' ']) {
      assert.false(keyboardNudge(key).handled, key + ' passes through');
    }
  });

  test('keyboardNudge and scrubDelta agree on what one step means', function (assert) {
    // The whole point of sharing the multiplier: a pointer travelling one
    // "step" of pixels and an arrow press must move the value identically.
    for (let keys of [{}, { shift: true }, { alt: true }]) {
      assert.strictEqual(
        roundTo(keyboardNudge('ArrowUp', keys, 3).delta, 6),
        roundTo(scrubDelta(1, 3, keys, 1), 6),
        JSON.stringify(keys),
      );
    }
  });

  // ── clamping / rounding / snapping ─────────────────────────────────
  test('clampRange: open bounds stay open', function (assert) {
    assert.strictEqual(clampRange(5, 0, 10), 5);
    assert.strictEqual(clampRange(-3, 0, 10), 0);
    assert.strictEqual(clampRange(99, 0, 10), 10);
    assert.strictEqual(clampRange(-999, undefined, 10), -999, 'no min');
    assert.strictEqual(clampRange(999, 0, undefined), 999, 'no max');
  });

  test('roundTo kills float noise', function (assert) {
    assert.strictEqual(roundTo(0.1 + 0.2, 2), 0.3);
    assert.strictEqual(roundTo(1.005, 2), 1.01);
    assert.strictEqual(roundTo(2.5, 0), 3);
    assert.strictEqual(roundTo(-2.5, 0), -2, 'Math.round rounds half up');
  });

  test('quantize snaps to a step grid', function (assert) {
    assert.strictEqual(quantize(7, 5), 5);
    assert.strictEqual(quantize(8, 5), 10);
    assert.strictEqual(quantize(8, 5, 1), 6, 'origin offsets the grid');
    assert.strictEqual(quantize(8, 0), 8, 'a zero step is a no-op');
  });

  test('snapToPoints pulls only inside the tolerance', function (assert) {
    let thirds = [0, 33.333, 50, 66.667, 100];
    assert.strictEqual(snapToPoints(48, thirds, 4), 50, 'close enough snaps');
    assert.strictEqual(snapToPoints(44, thirds, 4), 44, 'too far stays free');
    assert.strictEqual(
      snapToPoints(40, thirds, 100),
      33.333,
      'with a huge tolerance the NEAREST point wins, not the last',
    );
  });

  // ── angles ─────────────────────────────────────────────────────────
  test('wrapDegrees normalizes into [0, 360)', function (assert) {
    assert.strictEqual(wrapDegrees(0), 0);
    assert.strictEqual(wrapDegrees(360), 0);
    assert.strictEqual(wrapDegrees(-90), 270);
    assert.strictEqual(wrapDegrees(725), 5);
  });

  test('shortestAngleDelta is what makes a dial wind past 360', function (assert) {
    assert.strictEqual(
      shortestAngleDelta(359, 1),
      2,
      'clockwise through zero is +2, never −358',
    );
    assert.strictEqual(shortestAngleDelta(1, 359), -2, 'and back is −2');
    assert.strictEqual(shortestAngleDelta(0, 90), 90);
    assert.strictEqual(shortestAngleDelta(0, 180), 180, 'the +180 edge');
    assert.strictEqual(
      shortestAngleDelta(0, 181),
      -179,
      'past the antipode it flips sign',
    );
  });

  test('an accumulated dial passes 360 instead of resetting', function (assert) {
    // Three quarter-turns clockwise from 300° = 300 + 90 + 90 + 90 = 570°,
    // i.e. one full rotation plus 210 — the "rotations ×1" case.
    let value = 300;
    for (let to of [30, 120, 210]) {
      value += shortestAngleDelta(value, to);
    }
    assert.strictEqual(value, 570);
    assert.strictEqual(Math.floor(Math.abs(value) / 360), 1, 'one rotation');
  });

  test('pointerDegrees: 0 points right, angles increase clockwise', function (assert) {
    assert.strictEqual(pointerDegrees(0, 0, 10, 0), 0, 'right');
    assert.strictEqual(pointerDegrees(0, 0, 0, 10), 90, 'down (screen y)');
    assert.strictEqual(pointerDegrees(0, 0, -10, 0), 180, 'left');
    assert.strictEqual(pointerDegrees(0, 0, 0, -10), 270, 'up');
  });

  // ── easing ─────────────────────────────────────────────────────────
  test('bezierEase pins the endpoints and matches linear', function (assert) {
    assert.strictEqual(bezierEase(0, 0.42, 0, 0.58, 1), 0);
    assert.strictEqual(roundTo(bezierEase(1, 0.42, 0, 0.58, 1), 4), 1);
    // cubic-bezier(0, 0, 1, 1) is the identity.
    for (let x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      assert.strictEqual(
        roundTo(bezierEase(x, 0, 0, 1, 1), 3),
        x,
        'linear at ' + x,
      );
    }
  });

  test('bezierEase: ease-in-out is symmetric about the midpoint', function (assert) {
    assert.strictEqual(
      roundTo(bezierEase(0.5, 0.42, 0, 0.58, 1), 3),
      0.5,
      'the classic ease-in-out crosses 0.5 at 0.5',
    );
    let early = bezierEase(0.25, 0.42, 0, 0.58, 1);
    let late = bezierEase(0.75, 0.42, 0, 0.58, 1);
    assert.strictEqual(
      roundTo(early + late, 3),
      1,
      'and is point-symmetric around (0.5, 0.5)',
    );
    assert.true(early < 0.25, 'ease-in lags early');
  });

  test('bezierEase survives an overshoot curve without diverging', function (assert) {
    // A user can drag a handle anywhere; y outside 0–1 is legal and must
    // not NaN. (This is why the solver bisects rather than Newton-Raphson.)
    let peak = bezierEase(0.7, 0.34, 1.56, 0.64, 1);
    assert.true(Number.isFinite(peak), 'finite');
    assert.true(peak > 1, 'a back-out curve really does overshoot 1');
    assert.strictEqual(roundTo(bezierEase(1, 0.34, 1.56, 0.64, 1), 3), 1);
  });

  // ── text round-trip ────────────────────────────────────────────────
  test('formatMeasure places the unit and drops trailing zeros', function (assert) {
    assert.strictEqual(formatMeasure(24, 2, 'px'), '24px');
    assert.strictEqual(formatMeasure(24.5, 0, 'px'), '25px');
    assert.strictEqual(formatMeasure(0.5, 2, '$', 'prefix'), '$0.5');
    assert.strictEqual(formatMeasure(null, 2, 'px'), '', 'null is empty');
    assert.strictEqual(formatMeasure(12, 2), '12', 'no unit, no suffix');
  });

  test('parseMeasure tolerates what a user actually types', function (assert) {
    assert.strictEqual(parseMeasure('24px'), 24);
    assert.strictEqual(parseMeasure('  50 % '), 50);
    assert.strictEqual(parseMeasure('-12.5deg'), -12.5);
    assert.strictEqual(parseMeasure('+8'), 8);
    assert.strictEqual(parseMeasure('1.2.3'), 1.23, 'a stray second dot');
    assert.strictEqual(parseMeasure(''), null);
    assert.strictEqual(parseMeasure('-'), null, 'a lone sign is not a value');
    assert.strictEqual(parseMeasure('abc'), null);
  });

  test('format → parse round-trips at the stated precision', function (assert) {
    for (let value of [0, 1, -7.25, 100, 33.333]) {
      let text = formatMeasure(value, 3, 'px');
      assert.strictEqual(parseMeasure(text), roundTo(value, 3), text);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Stepped scales — the arithmetic
// ═══════════════════════════════════════════════════════════════════════

const APERTURES: ScaleStops = [
  { value: 1.4, label: 'f/1.4' },
  { value: 1.8, label: 'f/1.8' },
  { value: 2, label: 'f/2.0' },
  { value: 2.8, label: 'f/2.8' },
  { value: 4, label: 'f/4' },
  { value: 5.6, label: 'f/5.6' },
  { value: 8, label: 'f/8' },
];

module('Pretui | design-tools scales', function () {
  test('normalizeStops sorts, widens bare numbers, and collapses duplicates', function (assert) {
    let stops = normalizeStops([8, { value: 1.4, label: 'f/1.4' }, 2, 2, NaN]);
    assert.deepEqual(
      stops.map((stop) => stop.value),
      [1.4, 2, 8],
      'ascending, deduped, NaN dropped',
    );
    assert.strictEqual(stops[0].label, 'f/1.4', 'labels survive the sort');
    assert.strictEqual(stops[1].label, undefined, 'a bare number has no label');
    assert.deepEqual(normalizeStops(undefined), [], 'no scale is an empty one');
  });

  test('normalizeStops sorts a barrel-order list, so the scrub direction cannot invert', function (assert) {
    // A lens barrel is printed widest-first. A caller who transcribes it
    // that way must still get "drag right = stop down".
    let stops = normalizeStops([1.4, 2, 2.8, 4].reverse());
    assert.deepEqual(stops.map((stop) => stop.value), [1.4, 2, 2.8, 4]);
  });

  test('stopIndexFor finds the nearest stop, ties going to the lower one', function (assert) {
    let stops = normalizeStops(APERTURES);
    assert.strictEqual(stopIndexFor(2.8, stops), 3, 'an exact member');
    assert.strictEqual(stopIndexFor(2.9, stops), 3, 'just above');
    assert.strictEqual(stopIndexFor(3.5, stops), 4, 'just below the next');
    assert.strictEqual(stopIndexFor(3.4, stops), 3, 'a true tie opens up rather than stopping down');
    assert.strictEqual(stopIndexFor(0.1, stops), 0, 'below the scale clamps to the wide end');
    assert.strictEqual(stopIndexFor(999, stops), 6, 'above it clamps to the narrow end');
    assert.strictEqual(stopIndexFor(null, stops), -1, 'no value, no index');
    assert.strictEqual(stopIndexFor(2, []), -1, 'no scale, no index');
  });

  test('stopAt clamps rather than wraps', function (assert) {
    let stops = normalizeStops(APERTURES);
    assert.strictEqual(stopAt(0, stops)?.label, 'f/1.4');
    assert.strictEqual(stopAt(-40, stops)?.label, 'f/1.4', 'a long drag rests against the end');
    assert.strictEqual(stopAt(999, stops)?.label, 'f/8', 'and never teleports to the other end');
    assert.strictEqual(stopAt(0, []), undefined);
  });

  test('stopStride guarantees at least one stop, so no arrow is a dead key', function (assert) {
    assert.strictEqual(stopStride(1), 1, 'a plain arrow moves one stop');
    assert.strictEqual(stopStride(COARSE), COARSE, 'Shift still crosses ten');
    assert.strictEqual(
      stopStride(FINE),
      1,
      'a discrete scale has no half-stop to refine to, so fine still moves one',
    );
    assert.strictEqual(stopStride(-FINE), -1, 'and one in the other direction');
    assert.strictEqual(stopStride(0), 0, 'no travel, no movement');
  });

  test('stopText falls back to the formatted number for a bare scale', function (assert) {
    let stops = normalizeStops([1, 2, 4]);
    assert.strictEqual(stopText(stops[1], 0, '×'), '2×', 'no label, so unit + number');
    assert.strictEqual(stopText(normalizeStops(APERTURES)[0]), 'f/1.4', 'a label wins');
    assert.strictEqual(stopText(undefined), '', 'no stop, no text');
  });

  test('a scrub crossing the scale is absolute from its origin index', function (assert) {
    // Same lossless-round-trip property as the continuous path, one
    // dimension up: the component records the INDEX at pointerdown.
    let stops = normalizeStops(APERTURES);
    let originIndex = 3;
    let travel = [12, 36, 60, 36, 0];
    let seen = travel.map((dx) => {
      let stride = Math.round(scrubDelta(dx, 1, {}, 6));
      return stopAt(originIndex + stride, stops)?.label;
    });
    assert.deepEqual(seen, ['f/5.6', 'f/8', 'f/8', 'f/8', 'f/2.8']);
    assert.strictEqual(seen[seen.length - 1], 'f/2.8', 'back to zero is back to the start');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Token lists — the arithmetic
// ═══════════════════════════════════════════════════════════════════════

module('Pretui | design-tools token lists', function () {
  test('addToken trims, appends, and never mutates the input', function (assert) {
    let list = ['Velvet'];
    let edit = addToken(list, '  Brass  ');
    assert.deepEqual(edit.list, ['Velvet', 'Brass']);
    assert.deepEqual(list, ['Velvet'], 'the caller array is untouched');
    assert.true(edit.status.startsWith('Added Brass'), edit.status);
  });

  test('an empty add is a no-op with no announcement', function (assert) {
    let edit = addToken(['Velvet'], '   ');
    assert.deepEqual(edit.list, ['Velvet']);
    assert.strictEqual(edit.status, '', 'nothing happened, so nothing is said');
  });

  test('a duplicate is rejected case-insensitively AND says why', function (assert) {
    let edit = addToken(['Velvet'], 'velvet');
    assert.deepEqual(edit.list, ['Velvet'], 'the list is unchanged');
    assert.strictEqual(edit.status, 'velvet is already in the list');
    let allowed = addToken(['Velvet'], 'velvet', { allowDuplicates: true });
    assert.deepEqual(allowed.list, ['Velvet', 'velvet'], 'opt in and it lands');
  });

  test('the cap rejects with a reason rather than silently swallowing', function (assert) {
    let edit = addToken(['a', 'b'], 'c', { max: 2 });
    assert.deepEqual(edit.list, ['a', 'b']);
    assert.strictEqual(edit.status, 'List is full at 2 items');
    assert.deepEqual(addToken(['a'], 'b', { max: 0 }).list, ['a', 'b'], 'max 0 is no cap');
  });

  test('removeTokenAt names what it removed and ignores a bad index', function (assert) {
    let edit = removeTokenAt(['a', 'b', 'c'], 1);
    assert.deepEqual(edit.list, ['a', 'c']);
    assert.true(edit.status.startsWith('Removed b'), edit.status);
    assert.deepEqual(removeTokenAt(['a'], 4).list, ['a'], 'out of range is a no-op');
    assert.strictEqual(removeTokenAt(['a'], -1).status, '', 'and says nothing');
  });

  test('splitTokens turns a pasted run into members', function (assert) {
    assert.deepEqual(splitTokens('Velvet, Brass ,, Tile'), ['Velvet', 'Brass', 'Tile']);
    assert.deepEqual(splitTokens('a\nb\tc'), ['a', 'b', 'c'], 'newlines and tabs too');
    assert.deepEqual(splitTokens('  '), [], 'whitespace is not a member');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Render — the gestures, in a real browser
// ═══════════════════════════════════════════════════════════════════════
//
// The math above proves what a delta MEANS. These prove the delta reaches
// the value at all — which is the class of defect the math cannot catch:
// `scrubFrom` defaulted to 'grip' while the grip element only renders when
// there is a unit, so the most common configuration in a property panel (a
// plain numeric row) had no drag surface whatsoever and every assertion
// about scrubbing above was still true.

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function one(selector: string): HTMLElement {
  return root().querySelector(selector) as HTMLElement;
}
function all(selector: string): HTMLElement[] {
  return Array.from(root().querySelectorAll<HTMLElement>(selector));
}

/**
 * A synthetic pointer is not an ACTIVE pointer, so `setPointerCapture`
 * would throw `InvalidPointerId` and take the gesture's first frame with
 * it. Capture is a browser guarantee, not component logic; stubbing it is
 * what lets the component logic be the thing under test.
 */
function stubCapture(el: HTMLElement) {
  let element = el as unknown as Record<string, unknown>;
  element['setPointerCapture'] = () => undefined;
  element['releasePointerCapture'] = () => undefined;
  element['hasPointerCapture'] = () => false;
}

function pointer(el: HTMLElement, type: string, x: number, shift = false) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: 0,
      shiftKey: shift,
    }),
  );
}

/** press, travel, release — the whole gesture on one surface. */
function drag(el: HTMLElement, from: number, to: number, shift = false) {
  stubCapture(el);
  pointer(el, 'pointerdown', from, shift);
  pointer(el, 'pointermove', to, shift);
  pointer(el, 'pointerup', to, shift);
}

class NumberState {
  @tracked value: number | null = 24;
  @tracked committed: number | null = null;
  set = (v: number | null) => (this.value = v);
  commit = (v: number | null) => (this.committed = v);
}

module('Pretui | design-tools | scrub render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('a plain numeric row — no unit, no grip — IS a drag surface', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput
          @label='Blur'
          @value={{state.value}}
          @onInput={{state.set}}
          @onChange={{state.commit}}
        />
      </template>,
    );
    let field = one('[data-test-pretui-scrub-input]');
    assert.dom(field).hasAttribute('data-scrub-from', 'field');
    assert.strictEqual(
      all('[data-test-pretui-scrub-grip]').length,
      0,
      'there is no grip to drag, which is exactly the case that regressed',
    );
    drag(field, 100, 130);
    assert.strictEqual(state.value, 54, '+30px at step 1 is +30');
    assert.strictEqual(state.committed, 54, 'release commits');
  });

  test('Shift coarsens the same travel by ten', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput @label='Blur' @value={{state.value}} @onInput={{state.set}} />
      </template>,
    );
    drag(one('[data-test-pretui-scrub-input]'), 100, 105, true);
    assert.strictEqual(state.value, 74, '+5px × 10 = +50');
  });

  test('a unit puts the drag on the grip, and the field stops scrubbing', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput
          @label='Blur'
          @unit='px'
          @value={{state.value}}
          @onInput={{state.set}}
        />
      </template>,
    );
    let field = one('[data-test-pretui-scrub-input]');
    assert.dom(field).hasAttribute('data-scrub-from', 'grip');
    drag(field, 100, 140);
    assert.strictEqual(state.value, 24, 'the field itself is inert now');
    drag(one('[data-test-pretui-scrub-grip]'), 100, 140);
    assert.strictEqual(state.value, 64, 'the grip carries the gesture');
  });

  test('a focused field selects text instead of scrubbing out from under the caret', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput @label='Blur' @value={{state.value}} @onInput={{state.set}} />
      </template>,
    );
    let field = one('[data-test-pretui-scrub-input]');
    await focus('#' + one('.pretui-scrub-input').id);
    drag(field, 100, 160);
    assert.strictEqual(state.value, 24, 'editing beats dragging while focused');
    await blur('#' + one('.pretui-scrub-input').id);
    drag(field, 100, 160);
    assert.strictEqual(state.value, 84, 'and dragging resumes once focus leaves');
  });

  test('a press that never travelled hands focus to the input', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput @label='Blur' @value={{state.value}} @onInput={{state.set}} />
      </template>,
    );
    let field = one('[data-test-pretui-scrub-input]');
    drag(field, 100, 100);
    assert.strictEqual(state.value, 24, 'no travel, no change');
    assert.strictEqual(
      document.activeElement,
      one('.pretui-scrub-input'),
      'so the caret lands where a click would have put it',
    );
  });

  test('@scrubFrom=none leaves a plain spinbutton', async function (assert) {
    let state = new NumberState();
    await render(
      <template>
        <ScrubInput
          @label='Blur'
          @scrubFrom='none'
          @value={{state.value}}
          @onInput={{state.set}}
        />
      </template>,
    );
    drag(one('[data-test-pretui-scrub-input]'), 100, 160);
    assert.strictEqual(state.value, 24, 'no gesture at all');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'ArrowUp');
    assert.strictEqual(state.value, 25, 'but the keyboard path is untouched');
  });
});

class ScaleState {
  @tracked value: number | null = 2.8;
  set = (v: number | null) => (this.value = v);
}

const RENDER_APERTURES: ScaleStops = [
  { value: 1.4, label: 'f/1.4' },
  { value: 1.8, label: 'f/1.8' },
  { value: 2, label: 'f/2.0' },
  { value: 2.8, label: 'f/2.8' },
  { value: 4, label: 'f/4' },
  { value: 5.6, label: 'f/5.6' },
  { value: 8, label: 'f/8' },
];

module('Pretui | design-tools | stepped scale render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('the field shows the label while ARIA keeps the number', async function (assert) {
    let state = new ScaleState();
    await render(
      <template>
        <ScrubInput
          @label='Aperture'
          @steps={{RENDER_APERTURES}}
          @value={{state.value}}
          @onChange={{state.set}}
        />
      </template>,
    );
    let input = one('.pretui-scrub-input') as HTMLInputElement;
    assert.dom('[data-test-pretui-scrub-input]').hasAttribute('data-scale', 'true');
    assert.strictEqual(input.value, 'f/2.8', 'the label is the value name');
    assert.dom(input).hasAttribute('aria-valuenow', '2.8');
    assert.dom(input).hasAttribute('aria-valuetext', 'f/2.8');
    assert.dom(input).hasAttribute('aria-valuemin', '1.4', 'the ends of the list ARE the range');
    assert.dom(input).hasAttribute('aria-valuemax', '8');
  });

  test('arrows travel whole stops, Shift ten, Home/End the ends', async function (assert) {
    let state = new ScaleState();
    await render(
      <template>
        <ScrubInput
          @label='Aperture'
          @steps={{RENDER_APERTURES}}
          @value={{state.value}}
          @onChange={{state.set}}
        />
      </template>,
    );
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'ArrowUp');
    assert.strictEqual(state.value, 4, 'one stop up — not +1');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'ArrowDown');
    assert.strictEqual(state.value, 2.8, 'and back');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'ArrowUp', { altKey: true });
    assert.strictEqual(state.value, 4, 'fine cannot subdivide a stop, so it still moves one');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'ArrowUp', { shiftKey: true });
    assert.strictEqual(state.value, 8, 'coarse runs off the end and rests there');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'Home');
    assert.strictEqual(state.value, 1.4, 'Home is the wide end');
    await triggerKeyEvent('.pretui-scrub-input', 'keydown', 'End');
    assert.strictEqual(state.value, 8, 'End is the narrow end');
  });

  test('a typed number snaps to the nearest legal stop on commit', async function (assert) {
    let state = new ScaleState();
    await render(
      <template>
        <ScrubInput
          @label='Aperture'
          @steps={{RENDER_APERTURES}}
          @value={{state.value}}
          @onChange={{state.set}}
        />
      </template>,
    );
    let id = '#' + one('.pretui-scrub-input').id;
    await fillIn(id, '5');
    await triggerKeyEvent(id, 'keydown', 'Enter');
    assert.strictEqual(state.value, 5.6, 'a scale never holds an illegal value');
    assert.strictEqual((one('.pretui-scrub-input') as HTMLInputElement).value, 'f/5.6');
  });

  test('a scrub travels the scale by index', async function (assert) {
    let state = new ScaleState();
    await render(
      <template>
        <ScrubInput
          @label='Aperture'
          @steps={{RENDER_APERTURES}}
          @value={{state.value}}
          @onInput={{state.set}}
          @onChange={{state.set}}
        />
      </template>,
    );
    // No unit and no grip, so the whole field is the surface — the same
    // shape the regression above silenced.
    drag(one('[data-test-pretui-scrub-input]'), 100, 118);
    assert.strictEqual(state.value, 8, '18px at 6px/stop is three stops up');
  });
});

class TokenState {
  @tracked values: string[] = ['Velvet', 'Brass'];
  set = (v: string[]) => (this.values = v);
}

module('Pretui | design-tools | token input render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('every chip carries a NAMED remove button', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput
          @label='Textures'
          @value={{state.values}}
          @onChange={{state.set}}
        />
      </template>,
    );
    assert.strictEqual(all('[data-test-pretui-token-item]').length, 2);
    let removes = all('[data-test-pretui-token-remove]');
    assert.deepEqual(
      removes.map((el) => el.getAttribute('aria-label')),
      ['Remove Velvet', 'Remove Brass'],
      'not a row of identical unnamed buttons',
    );
    removes[0].click();
    assert.deepEqual(state.values, ['Brass'], 'and it removes the right one');
  });

  test('removing a chip returns focus to the entry field', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput @label='Textures' @value={{state.values}} @onChange={{state.set}} />
      </template>,
    );
    all('[data-test-pretui-token-remove]')[0].click();
    assert.strictEqual(
      document.activeElement,
      one('[data-test-pretui-token-entry]'),
      'a run of removals stays on the keyboard',
    );
  });

  test('Enter adds, a duplicate is announced rather than swallowed', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput @label='Textures' @value={{state.values}} @onChange={{state.set}} />
      </template>,
    );
    let id = '#' + one('[data-test-pretui-token-entry]').id;
    await fillIn(id, 'Tile');
    await triggerKeyEvent(id, 'keydown', 'Enter');
    assert.deepEqual(state.values, ['Velvet', 'Brass', 'Tile']);
    await fillIn(id, 'velvet');
    await triggerKeyEvent(id, 'keydown', 'Enter');
    assert.deepEqual(state.values, ['Velvet', 'Brass', 'Tile'], 'rejected');
    assert.dom('[data-test-pretui-token-status]').hasText('velvet is already in the list');
  });

  test('blur commits, so a typed word is never silently discarded', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput @label='Textures' @value={{state.values}} @onChange={{state.set}} />
      </template>,
    );
    let id = '#' + one('[data-test-pretui-token-entry]').id;
    await fillIn(id, 'Tile');
    await blur(id);
    assert.deepEqual(state.values, ['Velvet', 'Brass', 'Tile']);
  });

  test('a comma commits, so a pasted run arrives as members', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput @label='Textures' @value={{state.values}} @onChange={{state.set}} />
      </template>,
    );
    await fillIn('#' + one('[data-test-pretui-token-entry]').id, 'Tile, Glass, Greenery,');
    assert.deepEqual(state.values, ['Velvet', 'Brass', 'Tile', 'Glass', 'Greenery']);
  });

  test('Backspace in an empty field removes the last member', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput @label='Textures' @value={{state.values}} @onChange={{state.set}} />
      </template>,
    );
    let id = '#' + one('[data-test-pretui-token-entry]').id;
    await fillIn(id, 'x');
    await triggerKeyEvent(id, 'keydown', 'Backspace');
    assert.deepEqual(state.values, ['Velvet', 'Brass'], 'not while there is a draft');
    await fillIn(id, '');
    await triggerKeyEvent(id, 'keydown', 'Backspace');
    assert.deepEqual(state.values, ['Velvet']);
  });

  test('at the cap the field stays reachable instead of vanishing', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput
          @label='Textures'
          @max={{2}}
          @value={{state.values}}
          @onChange={{state.set}}
        />
      </template>,
    );
    let entry = one('[data-test-pretui-token-entry]') as HTMLInputElement;
    assert.dom(entry).hasAttribute('aria-disabled', 'true');
    assert.true(entry.readOnly, 'readonly, not disabled — it keeps its tab stop');
    assert.strictEqual(entry.placeholder, 'List is full', 'and says why');
  });

  test('mixed withholds the chips rather than showing one selection’s list', async function (assert) {
    let state = new TokenState();
    await render(
      <template>
        <TokenInput
          @label='Textures'
          @mixed={{true}}
          @value={{state.values}}
          @onChange={{state.set}}
        />
      </template>,
    );
    assert.strictEqual(all('[data-test-pretui-token-item]').length, 0);
    assert.strictEqual(
      (one('[data-test-pretui-token-entry]') as HTMLInputElement).placeholder,
      'Mixed',
    );
  });
});

module('Pretui | design-tools | nested section render', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(8000);
  });

  test('a nested group is marked, headed and disclosed independently', async function (assert) {
    await render(
      <template>
        <PanelSection @title='Subject'>
          <PanelSection @title='Person' @depth={{1}} @level={{4}}>
            <p class='nested-body'>body</p>
          </PanelSection>
        </PanelSection>
      </template>,
    );
    let sections = all('[data-test-pretui-panel-section]');
    assert.strictEqual(sections.length, 2);
    assert.dom(sections[0]).hasAttribute('data-depth', '0');
    assert.dom(sections[1]).hasAttribute('data-depth', '1');
    assert.strictEqual(
      all('[role="heading"]')[1].getAttribute('aria-level'),
      '4',
      'a nested group takes the next heading level, not a repeat of its parent’s',
    );

    await click(all('[data-test-pretui-section-toggle]')[1]);
    assert.dom(sections[1]).hasAttribute('data-open', 'false');
    assert.dom(sections[0]).hasAttribute('data-open', 'true', 'the parent is unaffected');
  });

  test('depth is clamped, so a runaway nesting counter cannot invent a treatment', async function (assert) {
    await render(
      <template>
        <PanelSection @title='Deep' @depth={{99}}>x</PanelSection>
      </template>,
    );
    assert.dom('[data-test-pretui-panel-section]').hasAttribute('data-depth', '3');
  });
});
