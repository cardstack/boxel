import { module, test } from 'qunit';

import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/**
 * A <Presence initial={false}> blocks the entrance of its children — and the
 * presence context is inherited, so it blocks every motion node BELOW them
 * too. In a gallery whose cards are whole demos that means the demos mount
 * already finished: rows that should wait for the scroll arrive in place, and
 * a looping keyframe animation is seeded at its last frame instead of running.
 *
 * The whileInView rows are what catch that: they animate from mount. A looping
 * stage starts its loop when its stage first comes on, after mount, so the
 * keyframes test asks only that the loop runs where it can be seen.
 */
module(
  'Integration | Choreo gallery | gallery demos stay alive',
  function (hooks) {
    let gallery = setupChoreoGalleryTest(hooks);

    test('a whileInView row still waits to be scrolled into view', async function (assert) {
      await gallery.renderGallery();
      await rest();

      const rows = [...document.querySelectorAll<HTMLElement>('.pour')];
      assert.ok(rows.length > 6, `the pour log rendered: ${rows.length} rows`);

      // the column scrolls inside the card, so the rows below the fold have not
      // crossed the band yet and must still be at rest
      const waiting = rows.filter(
        (row) => Number(getComputedStyle(row).opacity) < 0.5,
      );
      assert.ok(
        waiting.length > 0,
        `rows below the fold are still waiting: ${rows
          .map((r) => getComputedStyle(r).opacity)
          .join(',')}`,
      );
    });

    test('a looping keyframe animation runs once its tile is on stage', async function (assert) {
      await gallery.renderGallery();
      await rest();

      const morph = document.querySelector('.morph');
      assert.ok(morph, 'the keyframes demo rendered');
      morph!.scrollIntoView({ block: 'center' });
      await rest();
      const running = morph!
        .getAnimations()
        .concat([...(morph!.parentElement?.getAnimations() ?? [])]);
      const animating =
        running.length > 0 || Number(getComputedStyle(morph!).opacity) < 1;
      assert.ok(animating, `something is animating on it: ${running.length}`);
    });
  },
);
