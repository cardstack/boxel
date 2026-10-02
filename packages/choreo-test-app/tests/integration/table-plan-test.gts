/**
 * Table Plan's argument, asserted: the drop is the answer, and the snap-back
 * is the refusal.
 *
 * The whole stage rests on a join that nothing else in the suite covers — a
 * gesture started from a BUTTON via `dragControls`, released over an element
 * that is not the draggable one, hit-tested against that element's box. Every
 * piece of that is somewhere else's job (the controls object, the pan session,
 * the page-versus-viewport coordinate spaces) and the join between them is
 * ours. If it breaks, the stage looks completely normal and simply never seats
 * anybody.
 *
 * It is also the part that cannot be checked by eye in a hidden browser tab:
 * a pan session advances on Motion's frameloop, so a drag only happens where
 * `requestAnimationFrame` is actually running.
 */
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Grip } from 'test-app/components/examples/grip';

import {
  $,
  setupFixtureViewport,
  trigger,
  wait,
} from '../helpers/layout-fixture';

const CARD = '.tp-card';
const GRIP = '.tp-grip';
const TABLE = '.tp-table';

const seats = () => document.querySelectorAll('.tp-seat').length;
const cards = () => document.querySelectorAll(CARD).length;
const tally = () => $('.tp-tally').textContent!.trim();
const firstName = () => $(`${CARD} .tp-who b`).textContent!.trim();

/**
 * `onDragEnd` is dispatched through `frame.update`, so it runs on Motion's
 * frameloop rather than in the pointerup handler — and `settled()` knows
 * nothing about that loop. Every release has to be followed by real frames.
 */
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/**
 * Lift a guest by the corner tab and let go over `to`.
 *
 * The press goes on the GRIP, because the card's own listener is off — that is
 * the thing being tested. Everything after it is dispatched from a STATIONARY
 * element, and that is not a detail: `trigger` re-reads its target's rect on
 * every call, and the card is moving, so dispatching the moves from the card
 * adds its own displacement to each coordinate. The pointer runs away from the
 * hand — six moves aimed at x=500 arrived at x=2082 — and every drop lands off
 * the board. The tables do not move, so they are safe to measure from.
 */
async function carry(to: { x: number; y: number } | null) {
  const grip = $(`${CARD} ${GRIP}`);
  const card = $(CARD);
  const start = grip.getBoundingClientRect();
  const anchor = $('.tp-tables').getBoundingClientRect();

  trigger(grip, 'pointerdown', start.width / 2, start.height / 2);
  await wait(20);

  // The delta is measured from the CARD's centre, because that is what the
  // drop is hit-tested against — and the card follows the pointer one for one
  // once the threshold is behind it, so the pointer has to travel exactly as
  // far as the card needs to.
  const c = card.getBoundingClientRect();
  const dx = to ? to.x - (c.left + c.width / 2) : 6;
  const dy = to ? to.y - (c.top + c.height / 2) : 6;

  const x0 = start.left + start.width / 2 - anchor.left;
  const y0 = start.top + start.height / 2 - anchor.top;
  const STEPS = 10;
  for (let i = 1; i <= STEPS; i++) {
    trigger(
      rest(),
      'pointermove',
      x0 + (dx * i) / STEPS,
      y0 + (dy * i) / STEPS
    );
    // two frames per move: one for the session to read it, one for the drag to
    // write it. With one, the card tracks about a third of the travel.
    await frames(2);
  }
  trigger(rest(), 'pointerup', x0 + dx, y0 + dy);
  await frames(4);
}

/** a target that does not move while the card does — see the note above */
const rest = () => $('.tp-tables');

const centreOf = (index: number) => {
  const r = document.querySelectorAll(TABLE)[index]!.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

module('Integration | table plan', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('a guest dropped on a table takes a chair', async function (assert) {
    await render(<template><Grip /></template>);

    assert.strictEqual(cards(), 12, 'twelve on the list');
    assert.strictEqual(seats(), 0, 'and nobody seated');
    const moving = firstName();

    await carry(centreOf(0));

    assert.strictEqual(seats(), 1, `${moving} took a chair`);
    assert.strictEqual(cards(), 11, 'and left the list');
    assert.strictEqual(tally(), '11 to seat');
  });

  /**
   * The refusal. Released over nothing at all — above the board, clear of both
   * the list and the tables — the guest is unchanged, which is what
   * `dragSnapToOrigin` is there to make legible and the one case where
   * "nothing happened" is the right outcome rather than a bug.
   */
  test('a guest dropped on nothing comes back', async function (assert) {
    await render(<template><Grip /></template>);

    await carry({ x: 500, y: 2 });

    assert.strictEqual(seats(), 0, 'nobody was seated');
    assert.strictEqual(cards(), 12, 'and nobody left the list');
    assert.true(
      $('.tp-note').textContent!.includes('that was not a table'),
      'and the stage says why'
    );
  });

  /**
   * The list is a drop target too, so a seated guest can be carried back to it.
   * Everything done by dragging is undone by dragging — there is no × on a
   * chair, because a second gesture for the same idea is a second thing to
   * learn.
   */
  test('a seated guest can be carried back to the list', async function (assert) {
    await render(<template><Grip /></template>);

    await carry(centreOf(0));
    assert.strictEqual(seats(), 1, 'seated');
    assert.strictEqual(cards(), 11, 'and off the list');

    const chair = $('.tp-seat');
    const c = chair.getBoundingClientRect();
    const rail = $('.tp-rail');
    const r = rail.getBoundingClientRect();
    const anchor = $('.tp-tables').getBoundingClientRect();

    trigger(chair, 'pointerdown', c.width / 2, c.height / 2);
    await wait(20);
    const x0 = c.left + c.width / 2 - anchor.left;
    const y0 = c.top + c.height / 2 - anchor.top;
    const dx = r.left + r.width / 2 - (c.left + c.width / 2);
    const dy = r.top + 20 - (c.top + c.height / 2);
    for (let i = 1; i <= 10; i++) {
      trigger(rest(), 'pointermove', x0 + (dx * i) / 10, y0 + (dy * i) / 10);
      await frames(2);
    }
    trigger(rest(), 'pointerup', x0 + dx, y0 + dy);
    await frames(4);

    assert.strictEqual(seats(), 0, 'the chair is empty again');
    assert.strictEqual(cards(), 12, 'and they are back on the list');
  });

  test('a full table refuses the fifth guest', async function (assert) {
    await render(<template><Grip /></template>);

    for (let i = 0; i < 4; i++) {
      await carry(centreOf(0));
    }
    assert.strictEqual(seats(), 4, 'four chairs, four guests');

    await carry(centreOf(0));

    assert.strictEqual(seats(), 4, 'the fifth was handed back');
    assert.strictEqual(cards(), 8, 'and is still on the list');
    assert.true(
      $('.tp-note').textContent!.includes('full'),
      'and the stage says why'
    );
  });

  /**
   * `onPanSessionStart` fires at POINTERDOWN, before the threshold that decides
   * this is a drag. Arming the tables from it is the only reason the stage can
   * show you where a guest may go while you are still deciding to move them —
   * every other drag callback is too late to be useful for that.
   */
  test('taking hold of a guest lights the tables that have room', async function (assert) {
    await render(<template><Grip /></template>);

    assert.strictEqual(
      document.querySelectorAll(`${TABLE}.is-live`).length,
      0,
      'nothing is lit before a hand is on anybody'
    );

    const grip = $(`${CARD} ${GRIP}`);
    const r = grip.getBoundingClientRect();
    trigger(grip, 'pointerdown', r.width / 2, r.height / 2);
    await wait(30);

    assert.strictEqual(
      document.querySelectorAll(`${TABLE}.is-live`).length,
      3,
      'all three light at pointerdown, before any movement at all'
    );

    trigger(grip, 'pointerup', r.width / 2, r.height / 2);
    await frames(2);
  });
});
