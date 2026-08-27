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
  setupMotion,
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

const titleBox = () =>
  (find('[data-test-title]') as HTMLElement).getBoundingClientRect();

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Acceptance | crossing stress', function (hooks) {
  setupApplicationTest(hooks);
  setupMotion(hooks);

  test('three slides Magic-Move the looping hero from its live pose', async function (assert) {
    await visit('/crossing-stress');
    await animationsSettled();

    const root = find('[data-test-crossing-stress]') as HTMLElement;
    assert.ok(stress(), 'the stress test published its handle');
    assert.strictEqual(root.dataset.slide, '0', 'opens on Tide');
    assert.strictEqual(root.dataset.phase, 'looping', 'idle loops run');
    assert.dom('[data-test-title]').hasText('Tide');
    assert.dom('[data-test-chip]').hasText('drift');
    assert.dom('[data-test-kicker]').hasText('flood line');
    assert.dom('[data-test-inset]').hasText('flood');
    assert.ok(find('[data-test-shot]'), 'the plate holds a live shot');
    assert.strictEqual(
      (find('[data-test-clip]') as HTMLElement).tagName,
      'VIDEO',
      'the shot is a real <video> clip'
    );
    assert.ok(
      find('[data-test-particles]'),
      'a three.js field drifts over the slide ground'
    );
    assert.strictEqual(
      find('[data-test-hero]')?.querySelector('[data-test-particles]'),
      null,
      'the particle field is not in the plate'
    );
    const scroller = find('[data-test-scroll]') as HTMLElement;
    assert.ok(scroller, 'the plate holds an internal scroll pane');
    assert.true(
      scroller.scrollHeight > scroller.clientHeight + 8,
      `the scroll pane overflows (${scroller.scrollHeight} > ${scroller.clientHeight})`
    );
    assert.ok(find('[data-test-mark]'), 'the plate holds a spinning mark');
    assert.ok(find('[data-test-rule]'), 'a kept hairline sits on the stage');
    const tideCast = find('[data-test-cast="0"]') as HTMLElement;
    assert.true(
      parseFloat(getComputedStyle(tideCast).opacity) > 0.9 &&
        getComputedStyle(tideCast).boxShadow !== 'none',
      "Tide's shadow is a lit caster (opacity blend, not a tweened string)"
    );
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="1"]') as HTMLElement).opacity
      ) < 0.1,
      "Ember's caster is dark while Tide is showing"
    );
    assert.true(
      titleBox().width < window.innerWidth * 0.55,
      `Tide's title is the word, not a stage-wide strip (${titleBox().width.toFixed(0)} in ${window.innerWidth})`
    );

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
    const leavingTitle = document.querySelector(
      '[data-choreo-orphans] [data-test-title]'
    ) as HTMLElement | null;
    assert.ok(
      leavingTitle,
      'the leaving title rides the flight as a skin (homepage swap=during)'
    );
    const leavingTitleWidth = leavingTitle?.getBoundingClientRect().width ?? 0;
    assert.true(
      leavingTitleWidth < window.innerWidth * 0.55,
      `the flying Tide title stays a word (${leavingTitleWidth.toFixed(0)} in ${window.innerWidth})`
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-chip]'),
      'the leaving chip rides the flight as a skin'
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-kicker]'),
      'the leaving kicker rides the flight as a skin'
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-inset]'),
      'the inset caption is a counterpart inside the plate — it orphans, the plate does not'
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-hero]')
        .length,
      0,
      'the beige plate is the same node — it moves, it is not a counterpart skin'
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-rule]')
        .length,
      0,
      'the hairline is kept — it Moves, it is not a skin'
    );
    assert.ok(
      find('[data-test-hero] [data-test-shot]'),
      'the shot stays inside the flying plate (not a participant)'
    );
    assert.ok(
      find('[data-test-hero] [data-test-clip]'),
      'the <video> stays inside the flying plate'
    );
    assert.strictEqual(
      find('[data-test-hero]')?.querySelector('[data-test-particles]'),
      null,
      'the three.js field stays on the ground — it is not in the flying plate'
    );
    assert.ok(
      find('[data-test-particles]'),
      'the background three.js field is still on the stage'
    );
    assert.ok(
      find('[data-test-hero] [data-test-scroll]'),
      'the scroll pane stays inside the flying plate'
    );
    assert.ok(
      find('[data-test-hero] [data-test-mark]'),
      'the spinning mark stays inside the flying plate'
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-cast]')
        .length,
      0,
      'shadow casters ride inside the kept plate — they dissolve, they do not orphan'
    );

    await animationsSettled();
    assert.strictEqual(
      root.dataset.phase,
      'looping',
      'loops resume on landing'
    );
    assert.dom('[data-test-title]').hasText('Ember');
    assert.dom('[data-test-chip]').hasText('heat');
    assert.dom('[data-test-kicker]').hasText('night kiln');
    assert.dom('[data-test-inset]').hasText('1280°');
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
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="1"]') as HTMLElement).opacity
      ) > 0.9,
      "Ember's caster is the lit light after landing"
    );
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="0"]') as HTMLElement).opacity
      ) < 0.1,
      "Tide's caster has dissolved"
    );

    stress().go(2);
    await settled();
    await animationsSettled();
    assert.strictEqual(root.dataset.slide, '2', 'Violet');
    assert.dom('[data-test-title]').hasText('Violet');
    assert.dom('[data-test-chip]').hasText('arc');
    assert.dom('[data-test-kicker]').hasText('no horizon');
    assert.dom('[data-test-inset]').hasText('pass');
    const violet = heroBox();
    assert.true(
      Math.abs(violet.top - ember.top) > 20 ||
        Math.abs(violet.left - ember.left) > 20,
      `hero travelled into Violet's rest (${ember.left.toFixed(0)},${ember.top.toFixed(0)} → ${violet.left.toFixed(0)},${violet.top.toFixed(0)})`
    );

    // wrap-around: crop-scale of Violet's width onto Tide's square is
    // the flight that used to explode; a real-box tween must not
    stress().go(0);
    await settled();
    await animationsSettled();
    assert.strictEqual(root.dataset.slide, '0', 'back to Tide');
    assert.dom('[data-test-title]').hasText('Tide');
    assert.dom('[data-test-inset]').hasText('flood');
    assert.true(
      titleBox().width < window.innerWidth * 0.55,
      `Violet→Tide title is still the word (${titleBox().width.toFixed(0)} in ${window.innerWidth})`
    );
    const tideAgain = heroBox();
    assert.true(
      Math.abs(tideAgain.width - violet.width) > 30 ||
        Math.abs(tideAgain.height - violet.height) > 20,
      `hero tweened out of Violet's slab (${violet.width.toFixed(0)}×${violet.height.toFixed(0)} → ${tideAgain.width.toFixed(0)}×${tideAgain.height.toFixed(0)})`
    );
    assert.true(
      tideAgain.width < window.innerWidth * 0.45 &&
        tideAgain.height < window.innerHeight * 0.55,
      `Violet→Tide stays a tile (${tideAgain.width.toFixed(0)}×${tideAgain.height.toFixed(0)})`
    );
    assert.true(
      parseFloat(getComputedStyle(hero).borderRadius) > 16,
      `radius tweened back from 0 (${getComputedStyle(hero).borderRadius})`
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
