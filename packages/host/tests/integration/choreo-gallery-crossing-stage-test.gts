/**
 * Crossing: three looping slides, a cut at any phase, and the matching tile
 * flies from its live box onto the next slide's start. Tests step through
 * the stage's own handle so the conductor cannot race the assertions.
 */
import { find, settled } from '@ember/test-helpers';

import {
  orphanCount,
  strandedTransforms,
} from '@cardstack/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  $,
  frames,
  setupChoreoGalleryTest,
  setupStageViewport,
} from '../helpers/choreo-gallery-stage';

import type { ComponentLike } from '@glint/template';

interface CrossingHandle {
  go(slide: 0 | 1 | 2): void;
}

/** the handle the stage element carries */
const stress = () =>
  (
    $('[data-test-crossing-stress]') as HTMLElement & {
      choreoCrossing?: CrossingHandle;
    }
  ).choreoCrossing!;

/** the stage's own box, which every size claim is measured against */
const stage = () => $('[data-test-crossing-stress]').getBoundingClientRect();

const heroBox = () =>
  (find('[data-test-hero]') as HTMLElement).getBoundingClientRect();

const titleBox = () =>
  (find('[data-test-title]') as HTMLElement).getBoundingClientRect();

let gallery: ReturnType<typeof setupChoreoGalleryTest>;
let Crossing: ComponentLike;

module('Integration | Choreo gallery | crossing stage', function (hooks) {
  gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks);

  hooks.beforeEach(async function () {
    Crossing = await gallery.stage('crossing', 'Crossing');
  });

  test('three slides Magic-Move the looping hero from its live pose', async function (assert) {
    await gallery.renderStage(Crossing);
    await animationsSettled();

    const root = find('[data-test-crossing-stress]') as HTMLElement;
    assert.ok(stress(), 'the stage published its handle');
    assert.strictEqual(root.dataset.slide, '0', 'opens on Tide');
    assert.strictEqual(root.dataset.phase, 'looping', 'idle loops run');
    assert.dom('[data-test-title]').hasText('Tide');
    assert.dom('[data-test-chip]').hasText('drift');
    assert.dom('[data-test-kicker]').hasText('flood line');
    assert.dom('[data-test-inset]').hasText('flood');
    assert.dom('[data-test-shot]').exists('the plate holds a live shot');
    assert.strictEqual(
      (find('[data-test-clip]') as HTMLElement).tagName,
      'VIDEO',
      'the shot is a real <video> clip',
    );
    const scroller = find('[data-test-scroll]') as HTMLElement;
    assert.ok(scroller, 'the plate holds an internal scroll pane');
    assert.true(
      scroller.scrollHeight > scroller.clientHeight + 8,
      `the scroll pane overflows (${scroller.scrollHeight} > ${scroller.clientHeight})`,
    );
    assert.dom('[data-test-mark]').exists('the plate holds a spinning mark');
    assert.dom('[data-test-rule]').exists('a kept hairline sits on the stage');
    const tideCast = find('[data-test-cast="0"]') as HTMLElement;
    const tideIsLit =
      parseFloat(getComputedStyle(tideCast).opacity) > 0.9 &&
      getComputedStyle(tideCast).boxShadow !== 'none';
    assert.true(
      tideIsLit,
      "Tide's shadow is a lit caster (opacity blend, not a tweened string)",
    );
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="1"]') as HTMLElement).opacity,
      ) < 0.1,
      "Ember's caster is dark while Tide is showing",
    );
    assert.true(
      titleBox().width < stage().width * 0.55,
      `Tide's title is the word, not a stage-wide strip (${titleBox().width.toFixed(0)} in ${stage().width.toFixed(0)})`,
    );

    const atRest = heroBox();
    await frames(36);
    const hero = find('[data-test-hero]') as HTMLElement;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const liveTransform = getComputedStyle(hero).transform;
    if (reduced) {
      assert.strictEqual(
        liveTransform,
        'none',
        'prefers-reduced-motion stills the intra-slide loops',
      );
    } else {
      const live = heroBox();
      const displaced =
        liveTransform !== 'none' ||
        Math.hypot(live.left - atRest.left, live.top - atRest.top) > 2;
      assert.true(
        displaced,
        `Tide's loop displaced the hero (${atRest.left.toFixed(0)},${atRest.top.toFixed(0)} → ${live.left.toFixed(0)},${live.top.toFixed(0)}; transform=${liveTransform})`,
      );
    }

    stress().go(1);
    await settled();
    assert.strictEqual(root.dataset.phase, 'crossing', 'a cut arms the flight');
    assert.strictEqual(root.dataset.slide, '1', 'Ember is the destination');
    const leavingTitle = document.querySelector(
      '[data-choreo-orphans] [data-test-title-memory]',
    ) as HTMLElement | null;
    assert.ok(
      leavingTitle,
      'the leaving title rides the flight as a skin (homepage swap=during)',
    );
    const leavingTitleWidth = leavingTitle?.getBoundingClientRect().width ?? 0;
    assert.true(
      leavingTitleWidth < stage().width * 0.55,
      `the flying Tide title stays a word (${leavingTitleWidth.toFixed(0)} in ${stage().width.toFixed(0)})`,
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-chip-memory]'),
      'the leaving chip rides the flight as a skin',
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-kicker-memory]'),
      'the leaving kicker rides the flight as a skin',
    );
    assert.ok(
      document.querySelector('[data-choreo-orphans] [data-test-inset-memory]'),
      'the inset caption is a counterpart inside the plate — it orphans, the plate does not',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-hero-memory]')
        .length,
      0,
      'the beige plate is the same node — it moves, it is not a counterpart skin',
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-rule-memory]')
        .length,
      0,
      'the hairline is kept — it Moves, it is not a skin',
    );
    assert
      .dom('[data-test-hero] [data-test-shot]')
      .exists('the shot stays inside the flying plate (not a participant)');
    assert
      .dom('[data-test-hero] [data-test-clip]')
      .exists('the <video> stays inside the flying plate');
    assert
      .dom('[data-test-hero] [data-test-scroll]')
      .exists('the scroll pane stays inside the flying plate');
    assert
      .dom('[data-test-hero] [data-test-mark]')
      .exists('the spinning mark stays inside the flying plate');
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] [data-test-cast-memory]')
        .length,
      0,
      'shadow casters ride inside the kept plate — they dissolve, they do not orphan',
    );

    await animationsSettled();
    assert.strictEqual(
      root.dataset.phase,
      'looping',
      'loops resume on landing',
    );
    assert.dom('[data-test-title]').hasText('Ember');
    assert.dom('[data-test-chip]').hasText('heat');
    assert.dom('[data-test-kicker]').hasText('night kiln');
    assert.dom('[data-test-inset]').hasText('1280°');
    const ember = heroBox();
    const travelledToEmber =
      Math.abs(ember.left - atRest.left) > 30 ||
      Math.abs(ember.width - atRest.width) > 30;
    assert.true(
      travelledToEmber,
      `hero travelled into Ember's rest (${atRest.left.toFixed(0)}×${atRest.width.toFixed(0)} → ${ember.left.toFixed(0)}×${ember.width.toFixed(0)})`,
    );
    const emberIsATile =
      ember.width < stage().width * 0.55 && ember.height < stage().height * 0.7;
    assert.true(
      emberIsATile,
      `Ember's hero stays a tile (${ember.width.toFixed(0)}×${ember.height.toFixed(0)} in ${stage().width.toFixed(0)}×${stage().height.toFixed(0)})`,
    );
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="1"]') as HTMLElement).opacity,
      ) > 0.9,
      "Ember's caster is the lit light after landing",
    );
    assert.true(
      parseFloat(
        getComputedStyle(find('[data-test-cast="0"]') as HTMLElement).opacity,
      ) < 0.1,
      "Tide's caster has dissolved",
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
    const travelledToViolet =
      Math.abs(violet.top - ember.top) > 20 ||
      Math.abs(violet.left - ember.left) > 20;
    assert.true(
      travelledToViolet,
      `hero travelled into Violet's rest (${ember.left.toFixed(0)},${ember.top.toFixed(0)} → ${violet.left.toFixed(0)},${violet.top.toFixed(0)})`,
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
      titleBox().width < stage().width * 0.55,
      `Violet→Tide title is still the word (${titleBox().width.toFixed(0)} in ${stage().width.toFixed(0)})`,
    );
    const tideAgain = heroBox();
    const tweenedOutOfViolet =
      Math.abs(tideAgain.width - violet.width) > 30 ||
      Math.abs(tideAgain.height - violet.height) > 20;
    assert.true(
      tweenedOutOfViolet,
      `hero tweened out of Violet's slab (${violet.width.toFixed(0)}×${violet.height.toFixed(0)} → ${tideAgain.width.toFixed(0)}×${tideAgain.height.toFixed(0)})`,
    );
    const tideIsATile =
      tideAgain.width < stage().width * 0.45 &&
      tideAgain.height < stage().height * 0.55;
    assert.true(
      tideIsATile,
      `Violet→Tide stays a tile (${tideAgain.width.toFixed(0)}×${tideAgain.height.toFixed(0)})`,
    );
    assert.true(
      parseFloat(getComputedStyle(hero).borderRadius) > 16,
      `radius tweened back from 0 (${getComputedStyle(hero).borderRadius})`,
    );
    assert.strictEqual(orphanCount(), 0, 'no orphans after the last landing');
    assert.deepEqual(
      strandedTransforms(),
      [],
      'nothing wearing a leftover transform',
    );
  });

  test('a mid-flight cut retargets rather than queueing', async function (assert) {
    await gallery.renderStage(Crossing);
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
      'the second cut won',
    );
    assert.dom('[data-test-title]').hasText('Violet');
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });
});
