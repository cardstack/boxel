/**
 * A SEAM IS TWO NUMBERS. `mix` is how much of the held frame is over the
 * live one; `veil` is how much of a colour is over both. The picture
 * composites them in light and the film reveals the incoming furniture by
 * what is left over, `1 - max(mix, veil)` — so these two numbers ARE the
 * seam, and both halves of it agree by construction.
 */
import { inGlass, seamShape } from '@cardstack/choreo/film';
import { module, test } from 'qunit';

/** what the furniture wears at this progress */
const reveal = (kind: string, p: number) => {
  const { mix, veil } = seamShape(kind, p);
  return 1 - Math.max(mix, veil);
};

module('Unit | film | a seam as two numbers', function () {
  test('the glass holds the mixes, not the shapes', function (assert) {
    assert.true(inGlass('blend'), 'a blend is a mix');
    assert.true(inGlass('melt'), 'so is a melt');
    assert.true(inGlass('dip'), 'and a dip, through its colour');
    assert.false(
      inGlass('wipe'),
      'a wipe is a shape: it needs pixels to sweep',
    );
    assert.false(inGlass('iris'), 'so is an iris');
    assert.false(inGlass('cut'), 'and a cut is not a seam at all');
  });

  test('a blend hands the frame over, and never hands it back', function (assert) {
    const at = (p: number) => seamShape('blend', p).mix;
    assert.strictEqual(at(0), 1, 'it opens holding the outgoing frame whole');
    assert.strictEqual(at(1), 0, 'and ends on the live one');
    let last = 1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const m = at(p);
      assert.ok(
        m <= last + 1e-9,
        `the hold only ever thins (at ${p.toFixed(2)})`,
      );
      last = m;
    }
    assert.strictEqual(
      seamShape('blend', 0).veil,
      0,
      'a blend passes through no colour',
    );
  });

  test('a dip closes, holds and opens, and swaps the frame in the dark', function (assert) {
    assert.strictEqual(seamShape('dip', 0).veil, 0, 'it opens clear');
    assert.strictEqual(seamShape('dip', 0.38).veil, 1, 'shut by a third');
    assert.strictEqual(
      seamShape('dip', 0.44).veil,
      1,
      'still shut at the end of the hold',
    );
    assert.strictEqual(
      seamShape('dip', 1).veil,
      0,
      'and clear again at the end',
    );
    assert.ok(
      seamShape('dip', 0.2).veil < 1,
      'closing, not shut, on the way in',
    );
    assert.ok(
      seamShape('dip', 0.8).veil > 0,
      'opening, not open, on the way out',
    );
    /* the swap is inside the hold, where none of it is on screen */
    assert.strictEqual(
      seamShape('dip', 0.39).mix,
      1,
      'the held frame is up before the swap',
    );
    assert.strictEqual(seamShape('dip', 0.41).mix, 0, 'and gone after it');
    assert.strictEqual(
      seamShape('dip', 0.41).veil,
      1,
      'with the veil shut over it',
    );
  });

  test('the furniture is revealed by exactly what the seam leaves over', function (assert) {
    assert.strictEqual(reveal('blend', 0), 0, 'nothing shows at the cut');
    assert.strictEqual(reveal('blend', 1), 1, 'and everything at the end');
    assert.ok(reveal('blend', 0.5) > 0, 'a caption is under way in the middle');
    assert.strictEqual(
      reveal('dip', 0.4),
      0,
      'a dip shows nothing through its hold',
    );
    assert.strictEqual(reveal('dip', 1), 1, 'and hands the frame back whole');
    /* the two halves cannot disagree: they are one number */
    for (const kind of ['blend', 'melt', 'dip']) {
      for (let p = 0; p <= 1.0001; p += 0.1) {
        const r = reveal(kind, p);
        assert.ok(
          r >= -1e-9 && r <= 1 + 1e-9,
          `${kind} at ${p.toFixed(1)} is in range`,
        );
      }
    }
  });

  test('progress outside the seam is clamped, not extrapolated', function (assert) {
    assert.deepEqual(
      seamShape('blend', -1),
      seamShape('blend', 0),
      'before it, it has not started',
    );
    assert.deepEqual(
      seamShape('blend', 2),
      seamShape('blend', 1),
      'after it, it is over',
    );
    assert.deepEqual(
      seamShape('dip', -0.5),
      seamShape('dip', 0),
      'the same for a dip',
    );
    assert.deepEqual(seamShape('dip', 9), seamShape('dip', 1), 'at either end');
  });
});
