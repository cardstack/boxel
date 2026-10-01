import { click, render } from '@ember/test-helpers';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Sheet } from 'test-app/components/examples/sheet';
import { setupRenderingTest } from 'test-app/tests/helpers';

/** the sheet's own y, read off the element rather than off the props */
function offset(el: Element) {
  return Math.round(new DOMMatrix(getComputedStyle(el).transform).m42);
}

module('Integration | motion | sheet', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a step moves the sheet to the next detent', async function (assert) {
    await render(<template><Sheet /></template>);
    await animationsSettled();

    const sheet = document.querySelector('.sheet')!;
    const docked = offset(sheet);
    assert.strictEqual(docked, 242, 'it opens docked at the sliver');

    await click('.sheet-grab');
    await animationsSettled();
    assert.strictEqual(offset(sheet), 170, 'a step lands on the icons detent');

    await click('.sheet-grab');
    await animationsSettled();
    assert.strictEqual(offset(sheet), 80, 'and then on the rows detent');

    await click('.sheet-grab');
    await animationsSettled();
    assert.strictEqual(offset(sheet), 0, 'and then the sheet is the app');
  });

  test('the four targets are re-laid-out, never re-created', async function (assert) {
    await render(<template><Sheet /></template>);
    await animationsSettled();

    const first = [...document.querySelectorAll('.share-tile')];
    assert.strictEqual(first.length, 4, 'four targets');
    // stacked: the deck overlaps, so the row is narrower than four tiles
    const stacked =
      first.at(-1)!.getBoundingClientRect().right -
      first[0]!.getBoundingClientRect().left;

    await click('.sheet-grab');
    await animationsSettled();

    const then = [...document.querySelectorAll('.share-tile')];
    assert.deepEqual(then, first, 'the same four elements, not new ones');
    const fanned =
      then.at(-1)!.getBoundingClientRect().right -
      then[0]!.getBoundingClientRect().left;
    assert.ok(fanned > stacked, `the deck fans out (${stacked} → ${fanned})`);
  });
});
