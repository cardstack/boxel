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
 *
 * A third cause outlived both, and it was not this file's fault: fixture
 * tests used to hide the app stylesheet by setting `link.disabled`, which
 * detaches the sheet and reattaches it a few frames later rather than on the
 * clearing statement. This is the only test that reads its geometry out of
 * that stylesheet, so it was the only one that noticed, and what it measured
 * was an untouched `button` — 95x21. `setupFixtureViewport` mutes with
 * `media` now, which is synchronous both ways. `appCss` is reported below so
 * that a fourth cause has to name itself.
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
  // Wait for a real TILE, not a real grid.
  //
  // `.subdivide` is `height: min(72cqh, 300px)`, and `cqh` reads 0 until the
  // container query has resolved — so the demo can mount at full width with
  // no height at all. The old guard watched `[data-test-grid]`, which is
  // full-bleed and therefore already wider than 100px while every tile inside
  // it was 47x10; it never once caught the case it was written for. The tile
  // is the element whose box actually comes from the container units.
  await waitUntil(
    () => {
      const t = stage.querySelector(
        '[data-test-tile="atlas"]'
      ) as HTMLElement | null;
      if (!t) {
        return false;
      }
      const box = t.getBoundingClientRect();
      return box.width > 20 && box.height > 20;
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
  return { grid, root, seam, stage, tile };
}

/**
 * whether the app stylesheet is in the cascade at all: `.ex` is `absolute`
 * there and `static` everywhere else, so one computed value separates "the
 * demo laid out wrong" from "the demo had no CSS".
 */
function appCss(root: HTMLElement | null) {
  return root ? getComputedStyle(root).position : '(no root)';
}

function report(parts: Record<string, unknown>) {
  return JSON.stringify(parts);
}

module('Integration | motion | subdivision', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('evening a seam commits a new column split', async function (assert) {
    const { grid, root, seam, stage, tile } = await mount();
    assert.ok(grid && tile && seam, 'the fixture mounted its grid, tile, seam');
    if (!grid || !tile || !seam) {
      return;
    }

    const tileBox = bounds(tile);
    assert.true(
      tileBox.width > 20 && tileBox.height > 20,
      `the demo came up with real tiles ${report({
        appCss: appCss(root),
        grid: bounds(grid),
        stage: bounds(stage),
        tile: tileBox,
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
        appCss: appCss(root),
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
        // A projection animation starts on the frame AFTER the layout change,
        // and `triggerEvent` resolves on a runloop flush that can land before
        // it. Sampling once said "nothing reported busy" for an animation that
        // had simply not begun. Wait for it to start, then say it started.
        let started = false;
        await waitUntil(
          () => {
            started ||= !isMotionIdle();
            return started;
          },
          { timeout: 2000 }
        ).catch(() => undefined);
        assert.true(
          started,
          `the seam animated rather than snapping: ${
            whatIsBusy().join('; ') || '(nothing ever reported busy)'
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
