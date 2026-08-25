import { render } from '@ember/test-helpers';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Subdivision } from 'test-app/components/examples/subdivision';
import { setupRenderingTest } from 'test-app/tests/helpers';

/**
 * Watch a value for a while and report every distinct reading.
 *
 * Counting frames is not safe here: under the whole suite a frame can be many
 * times longer than it is on its own, so "three frames in" can be most of the
 * way through a 420ms spring. Sampling over a fixed WALL-CLOCK window asks the
 * question that is actually being asked — did this value pass through
 * anything on its way? — and a snap passes through nothing.
 */
async function watch(read: () => number, ms = 260) {
  const seen = new Set<number>();
  const until = performance.now() + ms;
  while (performance.now() < until) {
    seen.add(read());
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return [...seen];
}

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

function tileWidth() {
  const tile = document.querySelector('.sub-tile');
  return tile ? Math.round(tile.getBoundingClientRect().width) : NaN;
}

function gridWidth() {
  const grid = document.querySelector('.subdivide');
  return grid ? Math.round(grid.getBoundingClientRect().width) : 0;
}

module('Integration | motion | subdivision', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('evening a seam springs the tiles rather than snapping them', async function (assert) {
    // the demo sizes itself in CONTAINER units — `.ex` is the query container
    // and `.subdivide` is `min(92cqw, 340px)` wide — so rendered bare it
    // inherits whatever box the ambient test container happens to have. That
    // is not the same on a headless runner as it is here: give it a stage of
    // its own, big enough that both the width and the height clamp to the
    // demo's own maxima, and the geometry is the same everywhere.
    await render(
      <template>
        <div style="position:relative;width:600px;height:500px">
          <Subdivision />
        </div>
      </template>
    );
    await rest();

    const before = tileWidth();
    // a collapsed stage floors every percentage track at the tile's
    // min-content, so the seam moves and nothing resizes — the failure this
    // guard turns back into a sentence
    assert.true(
      gridWidth() > 100,
      `the demo came up on a real stage (${gridWidth()}px)`
    );
    // double-click is what the hint offers: 40% → 50%
    document
      .querySelector('.sub-seam.is-col')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const readings = await watch(tileWidth);
    await rest();
    const after = tileWidth();

    const seen = JSON.stringify({ before, readings, after });
    assert.notStrictEqual(before, after, `the tile does resize: ${seen}`);
    const between = readings.filter(
      (v) =>
        v !== before &&
        v !== after &&
        v > Math.min(before, after) &&
        v < Math.max(before, after)
    );
    assert.ok(
      between.length > 0,
      `it passes through widths between the two: ${seen}`
    );
  });
});
