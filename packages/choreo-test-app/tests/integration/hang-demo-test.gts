/**
 * Hang's argument, asserted: a throw is READ, and the reading is what puts
 * the puck where it lands.
 *
 * The rules themselves are covered without a DOM in unit/hang-test. What can
 * only be checked here is the join — that the release velocity Motion reports
 * actually reaches the projection, and that the shooting-area WALL does its
 * job of making the drag useless on its own. If a change ever breaks the
 * join, these fail while every rule test still passes.
 */
import { render, settled } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { module, test } from 'qunit';
import { Hang, RUNWAY } from 'test-app/components/examples/hang';

import {
  $,
  setupFixtureViewport,
  trigger,
  wait,
} from '../helpers/layout-fixture';

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
 * or the assertion reads the board from before the throw landed.
 */
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

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
  await wait(20);
  for (let i = 1; i <= steps; i++) {
    trigger(el, 'pointermove', 0, 0, {
      clientX: from + ((to - from) * i) / steps,
      clientY: y,
    });
    await wait(ms / steps);
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

module('Integration | hang', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a flick carries the puck out of the pen under its own speed', async function (assert) {
    await render(<template><Hang /></template>);
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
      `it left the pen under its own speed: ${note()} (${$('.hang-speed').textContent!.trim()})`
    );
    assert.strictEqual(
      $('.hang-tally').textContent!.trim(),
      '1/8',
      'and the throw was spent'
    );
  });

  test('the speed is what carries it, not the distance dragged', async function (assert) {
    await render(<template><Hang /></template>);

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
      `the first throw was the faster one (${quick.speed} vs ${gentle.speed} px/s)`
    );
    assert.ok(
      quick.rest > gentle.rest + 0.05,
      `and it rested further along (${quick.rest.toFixed(3)} vs ${gentle.rest.toFixed(3)})`
    );
  });

  test('a throw too soft to leave the pen comes back, and costs nothing', async function (assert) {
    await render(<template><Hang /></template>);

    /** slow enough that the projection never clears the wall */
    await flick(2400);

    assert.strictEqual(pucks().length, 0, 'nothing reached the board');
    assert.ok(note().startsWith('too soft'), `the note says so: "${note()}"`);
    assert.strictEqual(
      $('.hang-tally').textContent!.trim(),
      '0/8',
      'and the throw is still to come — a dud is not a penalty'
    );
    assert.ok($(SHOT), 'the puck is back in the pen, ready to throw again');
  });

  test('the aim preview names the same landing the throw produces', async function (assert) {
    await render(<template><Hang /></template>);
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
     * What CI caught, in its own words: `landed 0.988 vs previewed 0.763`. The
     * puck went FURTHER than the ghost promised, not shorter — which rules out
     * the obvious story about a stationary pointer decaying the window, and
     * points at the opposite. Under load the timers back up and then fire
     * together, so the last moves arrive almost simultaneously: a large
     * displacement over a tiny real interval, which is a velocity spike at the
     * exact moment of release. The ghost's last frame ran before the burst and
     * previewed an ordinary throw.
     *
     * That is not a flake in the ordinary sense — it failed about half the
     * time, on commits that also passed, which is the worst kind because it
     * teaches everyone to re-run a red build.
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
      'and it is gone the moment the finger lifts'
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
      `the puck landed near where the ghost said (${landed.toFixed(3)} vs ${previewed.toFixed(3)}, "${called}")`
    );
  });
});
