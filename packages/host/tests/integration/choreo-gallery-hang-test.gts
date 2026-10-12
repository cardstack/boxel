/**
 * Hang's argument, asserted: a throw is READ, and the reading is what puts
 * the puck where it lands.
 *
 * The rules themselves are covered without a DOM in the second module below.
 * What can only be checked against the stage is the join — that the release velocity Motion reports
 * actually reaches the projection, and that the shooting-area WALL does its
 * job of making the drag useless on its own. If a change ever breaks the
 * join, these fail while every rule test still passes.
 */
import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  $,
  frames,
  setupChoreoGalleryTest,
  setupStageViewport,
  sleep,
  trigger,
} from '../helpers/choreo-gallery-stage';

import type * as HangModule from '../../../choreo-gallery/realm/stages/hang';
import type { ComponentLike } from '@glint/template';

type Puck = HangModule.Puck;

let gallery: ReturnType<typeof setupChoreoGalleryTest>;
let Hang: ComponentLike;
let RUNWAY: number;
let hang: typeof HangModule;

const SHOT = '[data-test-shot]';
const lane = () => $('.hang-lane').getBoundingClientRect();
const pucks = () =>
  document.querySelectorAll<HTMLElement>('.hang-lane > .hang-puck');
const seat = () => parseFloat(pucks()[0]!.style.left) / 100;
const note = () => $('.hang-note').textContent!.trim();

/**
 * `onDragEnd` is dispatched through `frame.update`, so it runs on Motion's
 * frameloop rather than in the pointerup handler — and `settled()` knows
 * nothing about that loop. Every release has to be followed by real frames
 * (`frames`) or the assertion reads the board from before the throw landed.
 */
/**
 * A throw, in the only terms the component understands: a pointer that is
 * moving when it is lifted. `ms` sets the speed and nothing else — every
 * throw here starts and ends at the same two points, so the only variable
 * between them is how fast the hand was going.
 *
 * `trigger` measures its x/y from the element's CURRENT top-left, and the
 * element moves under the drag, so the coordinates go through `init` as
 * absolute clientX instead.
 */
async function flick(ms: number, steps = 6) {
  const el = $(SHOT);
  const r = el.getBoundingClientRect();
  const y = r.top + r.height / 2;
  const from = r.left + r.width / 2;
  const to = lane().left + lane().width * (RUNWAY - 0.02);
  trigger(el, 'pointerdown', 0, 0, { clientX: from, clientY: y });
  await sleep(20);
  for (let i = 1; i <= steps; i++) {
    trigger(el, 'pointermove', 0, 0, {
      clientX: from + ((to - from) * i) / steps,
      clientY: y,
    });
    await sleep(ms / steps);
  }
  trigger(el, 'pointerup', 0, 0, { clientX: to, clientY: y });
  await frames(3);
  await settled();
}

/**
 * Where the throw ended up, on one scale, so two throws can be compared
 * whatever became of them: the seat if it is on the board, the wall if it
 * never left the pen, and past the far edge if it was thrown away. The two
 * ways to end up with an empty board are opposite ends of the same axis, and
 * a test that folded them together would call a gutter shot a dud.
 */
function outcome() {
  if (pucks().length) {
    return seat();
  }
  return note().startsWith('too soft') ? RUNWAY : 1.2;
}

async function takeShot(ms: number, steps: number) {
  await flick(ms, steps);
  return {
    rest: outcome(),
    speed: parseInt($('.hang-speed').textContent!.trim(), 10) || 0,
  };
}

module('Integration | Choreo gallery | hang', function (hooks) {
  gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks);

  hooks.beforeEach(async function () {
    hang = await gallery.import<typeof HangModule>('stages/hang');
    Hang = hang.Hang as unknown as ComponentLike;
    RUNWAY = hang.RUNWAY;
  });

  test('a flick carries the puck out of the pen under its own speed', async function (assert) {
    await gallery.renderStage(Hang);
    assert.strictEqual(pucks().length, 0, 'the board starts empty');

    await flick(60, 4);

    /**
     * How FAR it went is a function of the machine's timer resolution and is
     * not this test's business — the claim is only that a flick gets the puck
     * out of a pen the drag itself cannot leave. Whether it stopped in a band
     * or carried into the gutter, the coast is what took it there.
     */
    assert.ok(
      outcome() > RUNWAY,
      `it left the pen under its own speed: ${note()} (${$('.hang-speed').textContent!.trim()})`,
    );
    assert.strictEqual(
      $('.hang-tally').textContent!.trim(),
      '1/8',
      'and the throw was spent',
    );
  });

  test('the speed is what carries it, not the distance dragged', async function (assert) {
    await gallery.renderStage(Hang);

    /**
     * Two identical drags — same start, same release point — at two speeds.
     * The only variable between them is how fast the hand was moving when it
     * let go, which is the whole claim the stage makes.
     *
     * The assertion is made against the velocity the component actually
     * REPORTS rather than against the sleep budget that produced it: a
     * `setTimeout(5)` in a busy CI browser is not five milliseconds, and a
     * test that assumed it was would be measuring the machine, not the code.
     */
    const quick = await takeShot(30, 3);
    $('.chip').click();
    await settled();
    const gentle = await takeShot(1200, 6);

    assert.ok(
      quick.speed > gentle.speed,
      `the first throw was the faster one (${quick.speed} vs ${gentle.speed} px/s)`,
    );
    assert.ok(
      quick.rest > gentle.rest + 0.05,
      `and it rested further along (${quick.rest.toFixed(3)} vs ${gentle.rest.toFixed(3)})`,
    );
  });

  test('a throw too soft to leave the pen comes back, and costs nothing', async function (assert) {
    await gallery.renderStage(Hang);

    /** slow enough that the projection never clears the wall */
    await flick(2400);

    assert.strictEqual(pucks().length, 0, 'nothing reached the board');
    assert.ok(note().startsWith('too soft'), `the note says so: "${note()}"`);
    assert.strictEqual(
      $('.hang-tally').textContent!.trim(),
      '0/8',
      'and the throw is still to come — a dud is not a penalty',
    );
    assert.ok($(SHOT), 'the puck is back in the pen, ready to throw again');
  });

  test('the aim preview names the same landing the throw produces', async function (assert) {
    await gallery.renderStage(Hang);
    const el = $(SHOT);
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const from = r.left + r.width / 2;
    const to = lane().left + lane().width * (RUNWAY - 0.02);

    /**
     * DRIVEN ON FRAMES, NOT ON A TIMER — and the reason is a burst, not a lag.
     *
     * Both halves of the claim read Motion's WINDOWED velocity: `aim` previews
     * it from the frameloop, `onDragEnd` takes it at release. So the assertion
     * is only ever as good as the samples those two share, and a drag paced by
     * `setTimeout` does not control that.
     *
     * A drag paced by timers lets the last moves bunch up under load and
     * fire almost together: a large displacement over a tiny real interval,
     * which is a velocity spike at the exact moment of release, after the
     * ghost's last frame previewed an ordinary throw.
     *
     * One frame per move makes bunching impossible: every sample is separated
     * by a real frame, so the windowed velocity is built from the same six
     * moves at the same spacing on every machine, however busy it is. The
     * release then goes out in the SAME TASK as the reading below, which
     * removes the last interval that load could stretch.
     */
    trigger(el, 'pointerdown', 0, 0, { clientX: from, clientY: y });
    await frames(1);
    const STEPS = 6;
    for (let i = 1; i <= STEPS; i++) {
      trigger(el, 'pointermove', 0, 0, {
        clientX: from + ((to - from) * i) / STEPS,
        clientY: y,
      });
      await frames(1);
    }
    const ghost = $('.hang-ghost');
    const called = ghost.dataset['call'];
    /** the raw projection, not the clamped paint position */
    const previewed = parseFloat(ghost.dataset['at'] || '0');
    // no await between the reading and the lift: see above
    trigger(el, 'pointerup', 0, 0, { clientX: to, clientY: y });

    assert.ok(called, `the ghost was showing a landing: "${called}"`);
    await frames(3);
    await settled();

    assert.strictEqual(
      ghost.dataset['call'],
      undefined,
      'and it is gone the moment the finger lifts',
    );
    /**
     * Compared as POSITIONS rather than as band names. `onDrag` is dispatched
     * a frame behind the pointer, so a hand that is still accelerating gets
     * previewed slightly slow — near a band edge the name can flip while the
     * number barely moves. The honest claim is that the ghost is the throw
     * asked early, accurate to about a band, and that is what is asserted.
     */
    const OVER = 1.05;
    const landed = pucks().length
      ? seat()
      : note().startsWith('too soft')
        ? RUNWAY
        : OVER;
    assert.ok(
      Math.abs(Math.min(previewed, OVER) - landed) < 0.15,
      `the puck landed near where the ghost said (${landed.toFixed(3)} vs ${previewed.toFixed(3)}, "${called}")`,
    );
  });
});

/**
 * Hang's rules, which are the part of a game that has to be right before any
 * of it is worth animating.
 *
 * The stage's whole claim is that a throw is READ and a resting place is
 * RESOLVED from it, with the flight authored afterwards. That makes the rules
 * pure functions over a board, and it makes them testable without a DOM.
 */
const red = (id: number, x: number): Puck => ({ id, side: 'red', x });
const blue = (id: number, x: number): Puck => ({ id, side: 'blue', x });
/** one puck across a 660px lane — the gap every collision is measured against */
let GAP: number;
const at = (r: { pucks: Puck[] }, id: number) =>
  r.pucks.find((p) => p.id === id)!.x;

module('Integration | Choreo gallery | hang rules', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  hooks.beforeEach(async function () {
    hang = await gallery.import<typeof HangModule>('stages/hang');
    RUNWAY = hang.RUNWAY;
    GAP = hang.PUCK / 660;
  });

  test('the projection and the flight are the same physics', function (assert) {
    /**
     * An overdamped spring decays over damping/stiffness; a puck released at
     * v under exponential decay travels v·τ. If these two numbers ever come
     * apart, the puck lies about how hard it was thrown — it coasts past and
     * is hauled back, or it arrives early and creeps the last inch. This is
     * the assertion that stops someone retuning SLIDE and leaving COAST.
     */
    assert.strictEqual(hang.COAST, 28 / 100, 'the shipped default');
    /**
     * The stage's spring is now live off a dial, so the constant is only the
     * starting point — what has to hold for EVERY value the slider can reach
     * is the relationship, which is what `coastOf` is.
     */
    assert.strictEqual(hang.coastOf({ damping: 40, stiffness: 100 }), 0.4);
    assert.strictEqual(hang.coastOf({ damping: 10, stiffness: 200 }), 0.05);
  });

  test('a zone is the band a puck rests in, and short of the first is nothing', function (assert) {
    assert.strictEqual(hang.scoreOf(0.1), 0, 'behind everything');
    assert.strictEqual(hang.scoreOf(0.43), 0, 'a hair short of the 1');
    assert.strictEqual(hang.scoreOf(0.44), 1, 'exactly on the line is in');
    assert.strictEqual(hang.scoreOf(0.7), 2);
    assert.strictEqual(hang.scoreOf(0.85), 3);
    assert.strictEqual(hang.scoreOf(0.96), 4, 'the hang');
    assert.strictEqual(
      hang.scoreOf(1),
      4,
      'still on the board at the very edge',
    );
  });

  test('a throw that hits nothing moves nothing', function (assert) {
    const board = [red(0, 0.4), blue(1, 0.9)];
    const r = hang.settle(board, red(2, 0.65), GAP);
    assert.deepEqual(
      r.pucks.map((p) => p.x),
      [0.4, 0.65, 0.9],
      'three pucks, none disturbed',
    );
    assert.strictEqual(r.off.length, 0);
  });

  test('an arrival shoves what it lands on exactly clear', function (assert) {
    const r = hang.settle([blue(1, 0.7)], red(2, 0.68), GAP);
    assert.strictEqual(at(r, 2), 0.68, 'the arrival keeps its place');
    assert.ok(
      Math.abs(at(r, 1) - (0.68 + GAP)) < 1e-9,
      'the puck it hit is pushed to exactly one puck clear',
    );
  });

  test('a shove passes down the line', function (assert) {
    /** three touching pucks: the arrival should move all three, not one */
    const board = [blue(1, 0.7), red(2, 0.7 + GAP), blue(3, 0.7 + GAP * 2)];
    const r = hang.settle(board, red(4, 0.69), GAP);
    assert.ok(at(r, 1) > 0.7, 'the first was hit');
    assert.ok(at(r, 2) > 0.7 + GAP, 'and passed it on');
    assert.ok(at(r, 3) > 0.7 + GAP * 2, 'and so did the second');
    assert.ok(
      Math.abs(at(r, 3) - at(r, 2) - GAP) < 1e-9,
      'the chain comes to rest exactly touching, not overlapping',
    );
  });

  test('a puck shoved past the far end leaves the board', function (assert) {
    const r = hang.settle([blue(1, 0.99)], red(2, 0.98), GAP);
    assert.deepEqual(
      r.off.map((p) => p.id),
      [1],
      'the one that was already hanging goes over',
    );
    assert.deepEqual(
      r.pucks.map((p) => p.id),
      [2],
      'and the thrower takes its place',
    );
  });

  test('only one colour scores, and only ahead of the other', function (assert) {
    /**
     * Red is further along, so blue scores nothing at all — not even for the
     * puck it has sitting in the 3. This is the rule that makes a board worth
     * building: every throw re-reads the whole thing.
     */
    const board = [red(0, 0.96), red(1, 0.85), blue(2, 0.84), blue(3, 0.5)];
    const s = hang.standing(board);
    assert.strictEqual(s.lead, 'red');
    assert.strictEqual(s.score, 7, 'the hang (4) and the 3, and nothing else');
  });

  test("a puck behind the opponent's best does not count", function (assert) {
    const s = hang.standing([red(0, 0.85), red(1, 0.5), blue(2, 0.7)]);
    assert.strictEqual(s.lead, 'red');
    assert.strictEqual(s.score, 3, 'the 3 counts; the 1 is behind blue');
  });

  test('a knock can hand the round over', function (assert) {
    const before = hang.standing([red(0, 0.9), blue(1, 0.86)]);
    assert.strictEqual(before.lead, 'red', 'red leads by four hundredths');

    /** blue throws short and shoves red's puck clean off the end */
    const r = hang.settle([red(0, 0.99), blue(1, 0.86)], blue(2, 0.98), GAP);
    const after = hang.standing(r.pucks);
    assert.deepEqual(
      r.off.map((p) => p.side),
      ['red'],
    );
    assert.strictEqual(after.lead, 'blue', 'and takes the lead with it');
  });

  test('an empty board is tied and scores nothing', function (assert) {
    const s = hang.standing([]);
    assert.strictEqual(s.lead, null);
    assert.strictEqual(s.score, 0);
  });

  test('the preview calls the same landing the score does', function (assert) {
    /**
     * The ghost is the throw asked early, so whatever it names has to be the
     * name the board would give the same fraction. The two ends are the ones
     * worth pinning: below the wall is a dud, past the far edge is the gutter.
     */
    assert.strictEqual(hang.callIt(RUNWAY - 0.01), 'too soft');
    assert.strictEqual(hang.callIt(1.02), 'off the end');
    assert.strictEqual(
      hang.callIt(0.4),
      'short',
      'past the wall, short of the 1',
    );
    assert.strictEqual(hang.callIt(0.7), '2');
    assert.strictEqual(hang.callIt(0.96), 'the hang');
  });

  test('the first scoring band is where the lede says it is', function (assert) {
    assert.strictEqual(hang.ZONES[0].from, 0.44);
    assert.strictEqual(hang.ZONES.at(-1)!.score, 4, 'the hang is worth four');
  });
});
