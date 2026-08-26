/**
 * Magic Move stress: three looping slides, a cut at any phase, the
 * matching tile flies from its live box onto the next slide's start.
 * Tests step through the public handle so live autoplay cannot race
 * the assertions.
 */
import { find, settled, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import {
  animationsSettled,
  orphanCount,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

interface CrossingStressHandle {
  go(slide: 0 | 1 | 2): void;
}

const stress = () =>
  (window as Window & { __choreoCrossingStress?: CrossingStressHandle })
    .__choreoCrossingStress!;

const heroBox = () =>
  (find('[data-test-hero]') as HTMLElement).getBoundingClientRect();

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Acceptance | crossing stress', function (hooks) {
  setupApplicationTest(hooks);

  test('three slides Magic-Move the looping hero from its live pose', async function (assert) {
    await visit('/crossing-stress');
    await animationsSettled();

    const root = find('[data-test-crossing-stress]') as HTMLElement;
    assert.ok(stress(), 'the stress test published its handle');
    assert.strictEqual(root.dataset.slide, '0', 'opens on Tide');
    assert.strictEqual(root.dataset.phase, 'looping', 'idle loops run');
    assert.dom('[data-test-title]').hasText('Tide');
    assert.dom('[data-test-chip]').hasText('drift');

    const atRest = heroBox();
    await frames(36);
    const hero = find('[data-test-hero]') as HTMLElement;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const liveTransform = getComputedStyle(hero).transform;
    if (reduced) {
      assert.strictEqual(
        liveTransform,
        'none',
        'prefers-reduced-motion stills the intra-slide loops'
      );
    } else {
      const live = heroBox();
      assert.true(
        liveTransform !== 'none' ||
          Math.hypot(live.left - atRest.left, live.top - atRest.top) > 2,
        `Tide's loop displaced the hero (${atRest.left.toFixed(0)},${atRest.top.toFixed(0)} → ${live.left.toFixed(0)},${live.top.toFixed(0)}; transform=${liveTransform})`
      );
    }

    stress().go(1);
    await settled();
    assert.strictEqual(root.dataset.phase, 'crossing', 'a cut arms the flight');
    assert.strictEqual(root.dataset.slide, '1', 'Ember is the destination');

    await animationsSettled();
    assert.strictEqual(
      root.dataset.phase,
      'looping',
      'loops resume on landing'
    );
    assert.dom('[data-test-title]').hasText('Ember');
    assert.dom('[data-test-chip]').hasText('heat');
    const ember = heroBox();
    assert.true(
      Math.abs(ember.left - atRest.left) > 30 ||
        Math.abs(ember.width - atRest.width) > 30,
      `hero travelled into Ember's rest (${atRest.left.toFixed(0)}×${atRest.width.toFixed(0)} → ${ember.left.toFixed(0)}×${ember.width.toFixed(0)})`
    );
    assert.true(
      ember.width < window.innerWidth * 0.55 &&
        ember.height < window.innerHeight * 0.7,
      `Ember's hero stays a tile (${ember.width.toFixed(0)}×${ember.height.toFixed(0)} in ${window.innerWidth}×${window.innerHeight})`
    );

    stress().go(2);
    await settled();
    await animationsSettled();
    assert.strictEqual(root.dataset.slide, '2', 'Violet');
    assert.dom('[data-test-title]').hasText('Violet');
    assert.dom('[data-test-chip]').hasText('arc');
    const violet = heroBox();
    assert.true(
      Math.abs(violet.top - ember.top) > 20 ||
        Math.abs(violet.left - ember.left) > 20,
      `hero travelled into Violet's rest (${ember.left.toFixed(0)},${ember.top.toFixed(0)} → ${violet.left.toFixed(0)},${violet.top.toFixed(0)})`
    );
    assert.strictEqual(orphanCount(), 0, 'no orphans after the last landing');
    assert.deepEqual(
      strandedTransforms(),
      [],
      'nothing wearing a leftover transform'
    );
  });

  test('a mid-flight cut retargets rather than queueing', async function (assert) {
    await visit('/crossing-stress');
    await animationsSettled();
    await frames(20);

    stress().go(1);
    await settled();
    stress().go(2);
    await settled();
    await animationsSettled();

    assert.strictEqual(
      (find('[data-test-crossing-stress]') as HTMLElement).dataset.slide,
      '2',
      'the second cut won'
    );
    assert.dom('[data-test-title]').hasText('Violet');
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });
});
