import { find, render, triggerEvent, waitUntil } from '@ember/test-helpers';
import { setMotionSpeed } from 'glimmer-motion';
import {
  animationsSettled,
  bounds,
  isMotionIdle,
  setupMotion,
  whatIsBusy,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Subdivision } from 'test-app/components/examples/subdivision';
import { setupRenderingTest } from 'test-app/tests/helpers';

/**
 * The demo sizes itself in CONTAINER units — `.ex` is the query container
 * and `.subdivide` is `min(92cqw, 340px)` wide — so rendered bare it
 * inherits whatever box the ambient test container happens to have. Wrap
 * it in a stage of its own, big enough that both the width and the height
 * clamp to the demo's own maxima.
 *
 * Every query is scoped to that fixture. A document-wide `.sub-tile` is
 * how this test used to report `{ before: 48, after: 48 }` — a collapsed
 * leftover, not the grid the seam actually moved.
 *
 * WHY THIS FILE IS PARANOID ABOUT TIME
 * It used to fail only in a loaded full suite and pass alone, which is the
 * signature of a test racing the clock rather than testing behaviour. Two
 * things caused it, and both are fixed here rather than papered over with a
 * longer sleep:
 *
 *   The fixture was measured as soon as `animationsSettled()` returned, but
 *   settled means "nothing is animating", not "the container query has
 *   resolved and the grid has a width". On a busy machine the first
 *   measurement could land on a collapsed grid, and a width that never
 *   changed reads exactly like a seam that did not move.
 *
 *   The "springs rather than snaps" case asserted that an animation was in
 *   flight one frame after the double-click. At 1x that is a coin toss under
 *   load: the spring can finish inside the gap. `setMotionSpeed` stretches
 *   the transition so being mid-flight is a fact rather than a hope — the
 *   speed is reset for us by `setupMotion`'s beforeEach.
 */
async function mount() {
  await render(
    <template>
      <div data-test-stage style="position:relative;width:600px;height:500px">
        <Subdivision />
      </div>
    </template>
  );
  await animationsSettled();
  const stage = find('[data-test-stage]') as HTMLElement;
  // the grid sizes itself from container units; wait for a real box rather
  // than measuring whatever the first frame happened to have
  await waitUntil(
    () => {
      const g = stage.querySelector('[data-test-grid]') as HTMLElement | null;
      return g ? g.getBoundingClientRect().width > 100 : false;
    },
    { timeout: 4000 }
  ).catch(() => {
    // fall through: the assertions below report the box they actually got,
    // which is the diagnostic this test exists to give
  });
  const root = stage.querySelector(
    '[data-test-subdivision]'
  ) as HTMLElement | null;
  const grid = root?.querySelector('[data-test-grid]') as HTMLElement | null;
  const tile = root?.querySelector(
    '[data-test-tile="atlas"]'
  ) as HTMLElement | null;
  const seam = root?.querySelector(
    '[data-test-seam="col"]'
  ) as HTMLElement | null;
  return { grid, seam, stage, tile };
}

function report(parts: Record<string, unknown>) {
  return JSON.stringify(parts);
}

module('Integration | motion | subdivision', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('evening a seam commits a new column split', async function (assert) {
    const { grid, seam, stage, tile } = await mount();
    assert.ok(grid && tile && seam, 'the fixture mounted its grid, tile, seam');
    if (!grid || !tile || !seam) {
      return;
    }

    const gridBox = bounds(grid);
    assert.true(
      gridBox.width > 100,
      `the demo came up on a real stage ${report({
        grid: gridBox,
        stage: bounds(stage),
      })}`
    );
    assert.true(
      grid.contains(tile),
      'the measured tile belongs to this fixture’s grid'
    );

    const before = bounds(tile);
    await triggerEvent(seam, 'dblclick');
    await animationsSettled();
    const after = bounds(tile);

    assert.true(
      Math.abs(after.width - before.width) > 8,
      `the tile resizes ${report({
        after,
        before,
        grid: bounds(grid),
        stage: bounds(stage),
        tileConnected: tile.isConnected,
      })}`
    );
  });

  test('evening a seam springs the tiles rather than snapping them', async function (assert) {
    const { seam, tile } = await mount();
    assert.ok(tile && seam, 'the fixture mounted its tile and seam');
    if (!tile || !seam) {
      return;
    }

    // Stretch the transition so "still moving one frame later" is a fact
    // rather than a race with the machine's load.
    //
    // The speed is GLOBAL, and `setupMotion`'s beforeEach only resets it for
    // suites that use it — so it is put back here, in a finally, rather than
    // left for a neighbour to inherit. A test that fixes its own flake by
    // slowing every test after it has not fixed anything.
    setMotionSpeed(8);
    try {
      await triggerEvent(seam, 'dblclick');
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      if (!reduced) {
        assert.false(
          isMotionIdle(),
          `layout animation is in flight: ${
            whatIsBusy().join('; ') || '(nothing reported busy)'
          }`
        );
      }
      await animationsSettled({ timeout: 12000 });
      assert.true(isMotionIdle(), 'the spring finishes');
    } finally {
      setMotionSpeed(1);
    }
  });
});
