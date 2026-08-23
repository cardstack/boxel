import { render } from '@ember/test-helpers';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Subdivision } from 'test-app/components/examples/subdivision';
import { setupRenderingTest } from 'test-app/tests/helpers';

function frames(n: number) {
  return new Promise<void>((resolve) => {
    let left = n;
    const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : resolve());
    requestAnimationFrame(tick);
  });
}

function rest() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

function tileWidth() {
  const tile = document.querySelector('.sub-tile');
  return tile ? Math.round(tile.getBoundingClientRect().width) : NaN;
}

module('Integration | motion | subdivision', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('evening a seam springs the tiles rather than snapping them', async function (assert) {
    await render(<template><Subdivision /></template>);
    await rest();

    const before = tileWidth();
    // double-click is what the hint offers: 40% → 50%
    document
      .querySelector('.sub-seam.is-col')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await frames(3);
    const mid = tileWidth();
    await rest();
    const after = tileWidth();

    const seen = JSON.stringify({ before, mid, after });
    assert.notStrictEqual(before, after, `the tile does resize: ${seen}`);
    assert.notStrictEqual(
      mid,
      after,
      `and it is still moving early on: ${seen}`
    );
  });
});
