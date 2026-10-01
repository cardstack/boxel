// Pretui — the design-tools math: pure functions, no DOM.
import { module, test } from 'qunit';
import { keyboardNudge, parseMeasure, roundTo, scrubDelta, scrubMultiplier } from './design-tools';

module('Pretui | internal/design-tools', function () {
  test('scrubMultiplier: Shift coarsens, Alt or ⌘ refines, both cancel out', function (assert) {
    assert.strictEqual(scrubMultiplier({}), 1);
    assert.strictEqual(scrubMultiplier({ shift: true }), 10);
    assert.strictEqual(scrubMultiplier({ alt: true }), 0.1);
    assert.strictEqual(scrubMultiplier({ meta: true }), 0.1);
    assert.strictEqual(scrubMultiplier({ shift: true, alt: true }), 1);
  });

  test('scrubDelta: travel over pixels-per-step, times step and modifier', function (assert) {
    assert.strictEqual(scrubDelta(12, 1), 12);
    assert.strictEqual(scrubDelta(12, 2, {}, 6), 4);
    assert.strictEqual(scrubDelta(-3, 1, { shift: true }), -30);
    assert.strictEqual(scrubDelta(5, 1, {}, 0), 5, 'a non-positive rate falls back to 1 px per step');
  });

  test('keyboardNudge: arrows step, Page keys go coarse, Home and End jump, other keys are not handled', function (assert) {
    assert.deepEqual(keyboardNudge('ArrowUp', {}, 2), { handled: true, dx: 0, dy: -2, delta: 2, toMin: false, toMax: false });
    assert.deepEqual(keyboardNudge('ArrowLeft', { shift: true }, 1), { handled: true, dx: -10, dy: 0, delta: -10, toMin: false, toMax: false });
    assert.strictEqual(keyboardNudge('PageDown', {}, 1).delta, -10);
    assert.true(keyboardNudge('Home').toMin);
    assert.true(keyboardNudge('End').toMax);
    assert.false(keyboardNudge('a').handled);
  });

  test('roundTo keeps the requested places without float noise', function (assert) {
    assert.strictEqual(roundTo(0.1 + 0.2), 0.3);
    assert.strictEqual(roundTo(1.005, 2), 1.01);
    assert.strictEqual(roundTo(12.3456, 0), 12);
    assert.true(Number.isNaN(roundTo(NaN)));
  });

  test('parseMeasure reads the number out of a typed measure', function (assert) {
    assert.strictEqual(parseMeasure('12.5deg'), 12.5, 'a unit with an e is not an exponent');
    assert.strictEqual(parseMeasure('-4px'), -4);
    assert.strictEqual(parseMeasure('1.2.3'), 1.23);
    assert.strictEqual(parseMeasure('.5'), 0.5);
    assert.strictEqual(parseMeasure('px'), null);
    assert.strictEqual(parseMeasure(''), null);
  });
});
