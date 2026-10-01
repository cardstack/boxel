import { render } from '@ember/test-helpers';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Gallery } from 'test-app/components/gallery';
import { setupRenderingTest } from 'test-app/tests/helpers';

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/**
 * A <Presence initial={false}> blocks the entrance of its children — and the
 * presence context is inherited, so it blocks every motion node BELOW them
 * too. In a gallery whose cards are whole demos that means the demos mount
 * already finished: rows that should wait for the scroll arrive in place, and
 * a looping keyframe animation is seeded at its last frame instead of running.
 */
module('Integration | motion | gallery demos stay alive', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a whileInView row still waits to be scrolled into view', async function (assert) {
    await render(<template><Gallery /></template>);
    await rest();

    const rows = [...document.querySelectorAll<HTMLElement>('.pour')];
    assert.ok(rows.length > 6, `the pour log rendered: ${rows.length} rows`);

    // the column scrolls inside the card, so the rows below the fold have not
    // crossed the band yet and must still be at rest
    const waiting = rows.filter(
      (row) => Number(getComputedStyle(row).opacity) < 0.5
    );
    assert.ok(
      waiting.length > 0,
      `rows below the fold are still waiting: ${rows
        .map((r) => getComputedStyle(r).opacity)
        .join(',')}`
    );
  });

  test('a looping keyframe animation is running', async function (assert) {
    await render(<template><Gallery /></template>);
    await rest();

    const morph = document.querySelector('.morph');
    assert.ok(morph, 'the keyframes demo rendered');
    const running = morph!
      .getAnimations()
      .concat([...(morph!.parentElement?.getAnimations() ?? [])]);
    assert.ok(
      running.length > 0 || Number(getComputedStyle(morph!).opacity) < 1,
      `something is animating on it: ${running.length}`
    );
  });
});
