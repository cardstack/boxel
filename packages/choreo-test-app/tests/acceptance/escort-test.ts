/**
 * Escort — the acceptance page for the opened step vocabulary
 * (docs/step-vocabulary.md): a composite step the APP said for itself,
 * named and anchored against, with two values read from the flight it
 * names.
 *
 * Acceptance and not integration on purpose: the claim is geometric, and
 * the geometry is the stylesheet's — a rendering test has no app CSS, so
 * there every box is content-sized and the demo does not exist.
 *
 * The assertions look MID-FLIGHT. At the ends any implementation agrees;
 * the frames in between are the ones a tween would have had to predict.
 */
import { click, find, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { module, test } from 'qunit';
import { resetCrossing } from 'test-app/lib/crossing';
import { setTempo } from 'test-app/lib/tempo';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const rect = (sel: string) =>
  (find(sel) as HTMLElement).getBoundingClientRect();
const card = () => rect('[data-test-escort-card]');
const badge = () => rect('[data-test-escort-badge]');
const shadow = () => rect('[data-test-escort-shadow]');

/** the badge's whole job: its right edge sits on the card's right edge */
const pinError = () => Math.abs(card().right - badge().right);

const blurOf = () => {
  const filter = getComputedStyle(find('[data-test-escort-shadow]')!).filter;
  return Number(/blur\(([\d.]+)px\)/.exec(filter)?.[1] ?? NaN);
};

module('Acceptance | escort', function (hooks) {
  setupApplicationTest(hooks);

  hooks.beforeEach(function () {
    setTempo('smooth');
    resetCrossing();
  });
  hooks.afterEach(function () {
    resetCrossing();
  });

  test('the badge is pinned mid-flight, not only at the ends', async function (assert) {
    await visit('/escort');
    await frames(6);
    const seatEl = find('.esc-seat') as HTMLElement;
    const b = find('[data-test-escort-badge]') as HTMLElement;
    assert.true(
      pinError() < 2,
      `AT REST off ${pinError().toFixed(1)} | seat ${JSON.stringify({ x: +seatEl.getBoundingClientRect().x.toFixed(1), w: +seatEl.getBoundingClientRect().width.toFixed(1) })} card ${JSON.stringify({ x: +card().x.toFixed(1), w: +card().width.toFixed(1) })} badge ${JSON.stringify({ x: +badge().x.toFixed(1), w: +badge().width.toFixed(1) })} badgeParent ${b.offsetParent?.className} badgeStyle '${b.getAttribute('style')}'`
    );

    await click('[data-test-bay="2"]');
    await frames(3);
    // exact, not close: a follower corrects the measured box by the
    // source's live motion values, so it reads the frame being drawn.
    // Without that it would be a frame behind — and a frame behind a FLIP
    // is a whole bay, which is a visible flash on the first frame.
    const step = card().left;
    await frames(1);
    const perFrame = Math.abs(card().left - step);
    assert.true(
      perFrame > 1,
      `the card is genuinely in flight (${perFrame.toFixed(1)}px this frame)`
    );
    assert.true(
      pinError() < 2,
      `the badge is ON the corner mid-flight (${pinError().toFixed(1)}px off, a frame of travel is ${perFrame.toFixed(1)}px)`
    );

    await frames(60);
    assert.true(
      pinError() < 2,
      `and lands on it (${pinError().toFixed(1)}px off)`
    );
  });

  test('the shadow reads lift: it spreads in transit and tightens on arrival', async function (assert) {
    await visit('/escort');
    await frames(6);
    const restBlur = blurOf();
    const restWidth = shadow().width;
    assert.true(restBlur > 0, `the shadow has a resting blur (${restBlur})`);

    await click('[data-test-bay="2"]');
    await frames(4);
    assert.true(
      blurOf() > restBlur + 0.5,
      `softer between bays (${blurOf().toFixed(2)} vs ${restBlur.toFixed(2)})`
    );
    assert.true(
      shadow().width > restWidth + 2,
      `and wider (${shadow().width.toFixed(1)} vs ${restWidth.toFixed(1)})`
    );

    await frames(60);
    assert.true(
      Math.abs(blurOf() - restBlur) < 0.6,
      `back to its resting blur on arrival (${blurOf().toFixed(2)})`
    );
    assert.true(
      Math.abs(shadow().width - restWidth) < 2,
      `and its resting width (${shadow().width.toFixed(1)})`
    );
  });

  test('a retarget mid-flight is followed too — nothing is re-aimed', async function (assert) {
    await visit('/escort');
    await frames(6);

    // Sample EVERY frame across the interruption, not the state after it.
    // The bug this guards was invisible to an after-the-fact check: the
    // replacement run's first frame had no previous frame to compare
    // against, so the followers leapt a flight's width away and walked
    // back — long over by the time anything settled, and the whole of
    // what a person actually sees.
    const errors: number[] = [];
    let stop = false;
    const watch = () => {
      if (stop) {
        return;
      }
      if (find('[data-test-escort-card]') && find('[data-test-escort-badge]')) {
        errors.push(pinError());
      }
      requestAnimationFrame(watch);
    };

    await click('[data-test-bay="2"]');
    await frames(4);
    requestAnimationFrame(watch);
    // change the destination while the spring is still travelling: a tween
    // accompanying the move would now be aimed at a place the card is no
    // longer going, and a derived value has nothing to re-aim
    await click('[data-test-bay="1"]');
    await frames(4);
    const midway = pinError();
    await frames(70);
    stop = true;

    assert.true(
      midway < 2,
      `on the corner through the retarget (${midway.toFixed(1)}px off)`
    );
    assert.true(
      errors.length > 20,
      `the whole interruption was watched (${errors.length} frames)`
    );
    const worst = Math.max(...errors);
    assert.true(
      worst < 4,
      `no single frame of the interruption broke the pin (worst ${worst.toFixed(1)}px over ${errors.length} frames)`
    );
    assert.true(
      pinError() < 2,
      `lands on the new bay's corner (${pinError().toFixed(1)}px off)`
    );
  });
});
