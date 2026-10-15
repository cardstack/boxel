/**
 * Reduced motion in the gallery: for a viewer whose system asks for it, a
 * stage waits to be asked. Tiles and demo pages hold their stages, touching a
 * stage wakes it, and a demo page offers the demo's full motion.
 */
import { click, render, settled, waitFor } from '@ember/test-helpers';

import { live, liveAll } from '@cardstack/choreo/test-support';
import { closestMotionConfig } from 'glimmer-motion';
import { module, test } from 'qunit';

import {
  setupChoreoGalleryTest,
  trigger,
} from '../helpers/choreo-gallery-stage';

import type * as HoldModule from '../../../choreo-gallery/realm/lib/motion-hold';
import type * as OnStageModule from '../../../choreo-gallery/realm/lib/onstage';

module('Integration | Choreo gallery | reduced motion', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);
  let preference: HoldModule['motionPreference'];
  let asked = false;

  hooks.beforeEach(async function () {
    ({ motionPreference: preference } =
      await gallery.import<typeof HoldModule>('lib/motion-hold'));
    asked = preference.reduce;
    preference.reduce = true;
  });

  hooks.afterEach(function () {
    preference.reduce = asked;
  });

  test('a held container keeps its stages off until it lets go', async function (assert) {
    let { observeStage } =
      await gallery.import<typeof OnStageModule>('lib/onstage');
    await render(
      <template>
        <div data-motion-hold='held' data-test-holder>
          <div data-test-held-stage style='width: 100px; height: 100px'></div>
        </div>
      </template>,
    );
    let told: boolean[] = [];
    let holder = live('[data-test-holder]')!;
    let watcher = observeStage(live('[data-test-held-stage]')!, (visible) =>
      told.push(visible),
    );
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(told, [false], 'in view, but held: off');

    holder.dataset['motionHold'] = 'free';
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(told, [false, true], 'let go: on');

    holder.dataset['motionHold'] = 'held';
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(told, [false, true, false], 'held again: off');
    watcher.disconnect();
  });

  test('every tile in the grid holds its stage', async function (assert) {
    await gallery.renderGallery();
    await waitFor('[data-gallery-tile] [data-test-tile-stage]');
    let holds = liveAll<HTMLElement>(
      '[data-gallery-tile] [data-test-tile-stage]',
    );
    assert.true(holds.length > 0, 'the roomy tiles have stages');
    assert.deepEqual(
      [...new Set(holds.map((el) => el.dataset['motionHold']))],
      ['held'],
      'and every one of them is held',
    );
    assert
      .dom('[data-gallery-tile] [data-test-motion-toggle]')
      .doesNotExist('a tile offers no full-motion switch; its page does');
  });

  test('touching a held tile wakes that tile alone', async function (assert) {
    gallery.provideViewCard();
    await gallery.renderGallery();
    let drift = "[data-gallery-tile='drift'] [data-test-tile-stage]";
    await waitFor(drift);
    trigger(live(drift)!, 'pointerdown');
    trigger(live(drift)!, 'pointerup');
    await settled();
    assert
      .dom(drift)
      .hasAttribute('data-motion-hold', 'free', 'the touched tile wakes');
    assert
      .dom("[data-gallery-tile='slides'] [data-test-tile-stage]")
      .hasAttribute('data-motion-hold', 'held', 'its neighbours stay held');
  });

  test('a demo page holds its stage and offers the full motion', async function (assert) {
    await gallery.renderDemo('keyframes');
    await waitFor('[data-test-stage]');
    assert
      .dom('[data-test-stage]')
      .hasAttribute('data-motion-hold', 'held', 'the stage waits to be asked');
    assert
      .dom('[data-test-motion-toggle]')
      .hasText('Play full motion', 'and the page says how to ask');

    let inside = () => live('[data-test-stage] [data-test-demo-stage]')!;
    assert.strictEqual(
      closestMotionConfig(inside()).reducedMotion,
      'user',
      'held, the stage follows the system setting',
    );

    await click('[data-test-motion-toggle]');
    assert
      .dom('[data-test-stage]')
      .hasAttribute('data-motion-hold', 'free', 'asked, the stage plays');
    assert.strictEqual(
      closestMotionConfig(inside()).reducedMotion,
      'never',
      'with its motion as designed',
    );
    assert.dom('[data-test-motion-toggle]').hasText('Back to reduced motion');

    await click('[data-test-motion-toggle]');
    assert
      .dom('[data-test-stage]')
      .hasAttribute('data-motion-hold', 'held', 'and back to waiting');
  });

  test('touching a demo page’s stage wakes it under the reduced policy', async function (assert) {
    await gallery.renderDemo('keyframes');
    await waitFor('[data-test-stage]');
    trigger('[data-test-stage]', 'pointerdown');
    trigger('[data-test-stage]', 'pointerup');
    await settled();
    assert
      .dom('[data-test-stage]')
      .hasAttribute('data-motion-hold', 'free', 'the stage wakes');
    assert.strictEqual(
      closestMotionConfig(live('[data-test-stage] [data-test-demo-stage]')!)
        .reducedMotion,
      'user',
      'and still follows the system setting',
    );
  });

  test('a bare click wakes a held stage, as a screen reader sends one', async function (assert) {
    await gallery.renderDemo('keyframes');
    await waitFor('[data-test-stage]');
    await click('[data-test-stage]');
    assert
      .dom('[data-test-stage]')
      .hasAttribute('data-motion-hold', 'free', 'the stage wakes');
  });

  test('nothing is held for a viewer who has not asked for less motion', async function (assert) {
    preference.reduce = false;
    await gallery.renderDemo('keyframes');
    await waitFor('[data-test-stage]');
    assert.dom('[data-test-stage]').hasAttribute('data-motion-hold', 'free');
    assert
      .dom('[data-test-motion-toggle]')
      .doesNotExist('and there is nothing to switch');
  });
});
