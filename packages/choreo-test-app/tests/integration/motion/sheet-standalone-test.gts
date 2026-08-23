import { click, render } from '@ember/test-helpers';
import { LayoutGroup } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Sheet } from 'test-app/components/examples/sheet';
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
  const early = tileX();
  await frames(3);
  const mid = tileX();
  await rest();
  return { before, early, mid, after: tileX() };
}

module('Integration | motion | sheet standalone', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the tiles tween to their new seats with no LayoutGroup above', async function (assert) {
    await render(<template><Sheet /></template>);
    await rest();

    const seen = await stepAndWatch();
    assert.notStrictEqual(
      seen.before,
      seen.after,
      `the tile does move: ${JSON.stringify(seen)}`
    );
    assert.notStrictEqual(
      seen.mid,
      seen.after,
      `and it is still travelling three frames in: ${JSON.stringify(seen)}`
    );
  });

  test('and the same inside a LayoutGroup, as the gallery renders it', async function (assert) {
    await render(
      <template>
        <LayoutGroup><Sheet /></LayoutGroup>
      </template>
    );
    await rest();

    const seen = await stepAndWatch();
    assert.notStrictEqual(
      seen.before,
      seen.after,
      `the tile does move: ${JSON.stringify(seen)}`
    );
    assert.notStrictEqual(
      seen.mid,
      seen.after,
      `and it is still travelling three frames in: ${JSON.stringify(seen)}`
    );
  });
});
