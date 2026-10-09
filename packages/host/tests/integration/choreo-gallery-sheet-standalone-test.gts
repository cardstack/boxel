import { click } from '@ember/test-helpers';

import { LayoutGroup } from 'glimmer-motion';
import { module, test } from 'qunit';

import {
  frames,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';

import type { ComponentLike } from '@glint/template';

/**
 * Every distinct reading over a wall-clock window.
 *
 * Counting frames is not safe: under the whole suite a frame can be many times
 * longer than it is alone, so "three frames in" can be most of the way through
 * the spring. A tween passes through intermediate values; a snap does not.
 */
async function watch(read: () => number, ms = 260) {
  const seen = new Set<number>();
  const until = performance.now() + ms;
  while (performance.now() < until) {
    seen.add(read());
    await frames(0);
  }
  return [...seen];
}

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/** the first share target's left edge, which the mode change moves */
function tileX() {
  const tile = document.querySelector('.share-tile');
  return tile ? Math.round(tile.getBoundingClientRect().x) : NaN;
}

/**
 * Does the tile TWEEN to its new seat, or snap there?
 *
 * A layout animation that never runs still ends in the right place, so a rest
 * assertion cannot tell the two apart. Sample a few frames after the mode
 * changes: mid-flight the tile is somewhere between its two seats.
 */
async function stepAndWatch() {
  const before = tileX();
  await click('.sheet-grab');
  const readings = await watch(tileX);
  await rest();
  return { before, readings, after: tileX() };
}

let gallery: ReturnType<typeof setupChoreoGalleryTest>;
let Sheet: ComponentLike;

module('Integration | Choreo gallery | sheet standalone', function (hooks) {
  gallery = setupChoreoGalleryTest(hooks);

  hooks.beforeEach(async function () {
    Sheet = await gallery.stage('sheet', 'Sheet');
  });

  test('the tiles tween to their new seats with no LayoutGroup above', async function (assert) {
    await gallery.renderStage(Sheet);
    await rest();

    const seen = await stepAndWatch();
    const dump = JSON.stringify(seen);
    assert.notStrictEqual(
      seen.before,
      seen.after,
      `the tile does move: ${dump}`,
    );
    const between = seen.readings.filter(
      (v) =>
        v !== seen.before &&
        v !== seen.after &&
        v > Math.min(seen.before, seen.after) &&
        v < Math.max(seen.before, seen.after),
    );
    assert.ok(between.length > 0, `it travels rather than snapping: ${dump}`);
  });

  test('and the same inside a LayoutGroup, as the gallery renders it', async function (assert) {
    const Grouped = <template>
      <LayoutGroup><Sheet /></LayoutGroup>
    </template>;
    await gallery.renderStage(Grouped);
    await rest();

    const seen = await stepAndWatch();
    const dump = JSON.stringify(seen);
    assert.notStrictEqual(
      seen.before,
      seen.after,
      `the tile does move: ${dump}`,
    );
    const between = seen.readings.filter(
      (v) =>
        v !== seen.before &&
        v !== seen.after &&
        v > Math.min(seen.before, seen.after) &&
        v < Math.max(seen.before, seen.after),
    );
    assert.ok(between.length > 0, `it travels rather than snapping: ${dump}`);
  });
});
