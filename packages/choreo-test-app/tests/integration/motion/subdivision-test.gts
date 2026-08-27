import { find, render, triggerEvent } from '@ember/test-helpers';
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
    await animationsSettled();
    assert.true(isMotionIdle(), 'the spring finishes');
  });
});
