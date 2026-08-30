/**
 * Hang's rules, which are the part of a game that has to be right before any
 * of it is worth animating.
 *
 * The stage's whole claim is that a throw is READ and a resting place is
 * RESOLVED from it, with the flight authored afterwards. That makes the rules
 * pure functions over a board, and it makes them testable without a DOM —
 * which is the point of having pulled them out of the component.
 */
import { module, test } from 'qunit';
import {
  callIt,
  COAST,
  PUCK,
  type Puck,
  RUNWAY,
  scoreOf,
  settle,
  standing,
  ZONES,
} from 'test-app/components/examples/hang';

const red = (id: number, x: number): Puck => ({ id, side: 'red', x });
const blue = (id: number, x: number): Puck => ({ id, side: 'blue', x });
/** one puck across a 660px lane — the gap every collision is measured against */
const GAP = PUCK / 660;
const at = (r: { pucks: Puck[] }, id: number) =>
  r.pucks.find((p) => p.id === id)!.x;

module('Unit | hang', function () {
  test('the projection and the flight are the same physics', function (assert) {
    /**
     * An overdamped spring decays over damping/stiffness; a puck released at
     * v under exponential decay travels v·τ. If these two numbers ever come
     * apart, the puck lies about how hard it was thrown — it coasts past and
     * is hauled back, or it arrives early and creeps the last inch. This is
     * the assertion that stops someone retuning SLIDE and leaving COAST.
     */
    assert.strictEqual(COAST, 28 / 100, 'COAST is SLIDE.damping / stiffness');
  });

  test('a zone is the band a puck rests in, and short of the first is nothing', function (assert) {
    assert.strictEqual(scoreOf(0.1), 0, 'behind everything');
    assert.strictEqual(scoreOf(0.43), 0, 'a hair short of the 1');
    assert.strictEqual(scoreOf(0.44), 1, 'exactly on the line is in');
    assert.strictEqual(scoreOf(0.7), 2);
    assert.strictEqual(scoreOf(0.85), 3);
    assert.strictEqual(scoreOf(0.96), 4, 'the hang');
    assert.strictEqual(scoreOf(1), 4, 'still on the board at the very edge');
  });

  test('a throw that hits nothing moves nothing', function (assert) {
    const board = [red(0, 0.4), blue(1, 0.9)];
    const r = settle(board, red(2, 0.65), GAP);
    assert.deepEqual(
      r.pucks.map((p) => p.x),
      [0.4, 0.65, 0.9],
      'three pucks, none disturbed'
    );
    assert.strictEqual(r.off.length, 0);
  });

  test('an arrival shoves what it lands on exactly clear', function (assert) {
    const r = settle([blue(1, 0.7)], red(2, 0.68), GAP);
    assert.strictEqual(at(r, 2), 0.68, 'the arrival keeps its place');
    assert.ok(
      Math.abs(at(r, 1) - (0.68 + GAP)) < 1e-9,
      'the puck it hit is pushed to exactly one puck clear'
    );
  });

  test('a shove passes down the line', function (assert) {
    /** three touching pucks: the arrival should move all three, not one */
    const board = [blue(1, 0.7), red(2, 0.7 + GAP), blue(3, 0.7 + GAP * 2)];
    const r = settle(board, red(4, 0.69), GAP);
    assert.ok(at(r, 1) > 0.7, 'the first was hit');
    assert.ok(at(r, 2) > 0.7 + GAP, 'and passed it on');
    assert.ok(at(r, 3) > 0.7 + GAP * 2, 'and so did the second');
    assert.ok(
      Math.abs(at(r, 3) - at(r, 2) - GAP) < 1e-9,
      'the chain comes to rest exactly touching, not overlapping'
    );
  });

  test('a puck shoved past the far end leaves the board', function (assert) {
    const r = settle([blue(1, 0.99)], red(2, 0.98), GAP);
    assert.deepEqual(
      r.off.map((p) => p.id),
      [1],
      'the one that was already hanging goes over'
    );
    assert.deepEqual(
      r.pucks.map((p) => p.id),
      [2],
      'and the thrower takes its place'
    );
  });

  test('only one colour scores, and only ahead of the other', function (assert) {
    /**
     * Red is further along, so blue scores nothing at all — not even for the
     * puck it has sitting in the 3. This is the rule that makes a board worth
     * building: every throw re-reads the whole thing.
     */
    const board = [red(0, 0.96), red(1, 0.85), blue(2, 0.84), blue(3, 0.5)];
    const s = standing(board);
    assert.strictEqual(s.lead, 'red');
    assert.strictEqual(s.score, 7, 'the hang (4) and the 3, and nothing else');
  });

  test("a puck behind the opponent's best does not count", function (assert) {
    const s = standing([red(0, 0.85), red(1, 0.5), blue(2, 0.7)]);
    assert.strictEqual(s.lead, 'red');
    assert.strictEqual(s.score, 3, 'the 3 counts; the 1 is behind blue');
  });

  test('a knock can hand the round over', function (assert) {
    const before = standing([red(0, 0.9), blue(1, 0.86)]);
    assert.strictEqual(before.lead, 'red', 'red leads by four hundredths');

    /** blue throws short and shoves red's puck clean off the end */
    const r = settle([red(0, 0.99), blue(1, 0.86)], blue(2, 0.98), GAP);
    const after = standing(r.pucks);
    assert.deepEqual(
      r.off.map((p) => p.side),
      ['red']
    );
    assert.strictEqual(after.lead, 'blue', 'and takes the lead with it');
  });

  test('an empty board is tied and scores nothing', function (assert) {
    const s = standing([]);
    assert.strictEqual(s.lead, null);
    assert.strictEqual(s.score, 0);
  });

  test('the preview calls the same landing the score does', function (assert) {
    /**
     * The ghost is the throw asked early, so whatever it names has to be the
     * name the board would give the same fraction. The two ends are the ones
     * worth pinning: below the wall is a dud, past the far edge is the gutter.
     */
    assert.strictEqual(callIt(RUNWAY - 0.01), 'too soft');
    assert.strictEqual(callIt(1.02), 'off the end');
    assert.strictEqual(callIt(0.4), 'short', 'past the wall, short of the 1');
    assert.strictEqual(callIt(0.7), '2');
    assert.strictEqual(callIt(0.96), 'the hang');
  });

  test('the first scoring band is where the lede says it is', function (assert) {
    assert.strictEqual(ZONES[0].from, 0.44);
    assert.strictEqual(ZONES.at(-1)!.score, 4, 'the hang is worth four');
  });
});
