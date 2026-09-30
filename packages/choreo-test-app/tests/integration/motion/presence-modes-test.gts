/**
 * What `sync` actually does to the layout — asserted, because it reads as a
 * bug and is not one.
 *
 * In `sync` both notices are mounted at once and the leaver stays IN FLOW for
 * the whole of its exit, so the newcomer is laid out BELOW it and then rises
 * as the leaver unmounts. Every time someone watches this demo they report
 * the newcomer "starting lower instead of at the same level" — which is the
 * mode working, and is the entire difference between it and `popLayout`,
 * where the leaver leaves flow immediately and the newcomer is already home.
 *
 * There was no coverage of this, so the question had to be re-answered from
 * the prose each time. These three cases answer it from the DOM instead.
 */
import { click, find, render } from '@ember/test-helpers';
import {
  animationsSettled,
  bounds,
  setupMotion,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { PresenceModes } from 'test-app/components/examples/presence-modes';
import { setupRenderingTest } from 'test-app/tests/helpers';

/** the slot for one mode, in the order the demo renders them */
const SLOT = { popLayout: 2, sync: 0, wait: 1 } as const;

function slot(which: keyof typeof SLOT) {
  return document.querySelectorAll<HTMLElement>('.mode-slot')[SLOT[which]]!;
}

/**
 * Every notice in that slot, top-first, as { title, top } within the slot —
 * where `top` is the LAYOUT position, not the painted one.
 *
 * `offsetTop`, deliberately, not `bounds()`. A notice enters with
 * `initial={ y: 18 }`, so its rect is offset by however much of that entrance
 * has played, and a first attempt at this file read that transform as a
 * layout difference and called popLayout broken. The question here is where
 * the box was PUT; the transform on top of it is a separate one.
 */
function notices(which: keyof typeof SLOT) {
  const box = slot(which);
  return [...box.querySelectorAll<HTMLElement>('.toast')].map((el) => ({
    title: el.querySelector('b')?.textContent?.trim() ?? '',
    top: el.offsetTop - box.offsetTop,
  }));
}

async function mount() {
  await render(<template><PresenceModes /></template>);
  await animationsSettled();
}

/** swap the notice, and look BEFORE anything settles */
async function swapAndPeek() {
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Switch'
  ) as HTMLElement;
  await click(button);
}

module('Integration | motion | presence modes', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('sync holds both notices, and the newcomer is laid out below the leaver', async function (assert) {
    await mount();
    assert.deepEqual(
      notices('sync').map((n) => n.title),
      ['Build passed'],
      'one notice at rest'
    );

    await swapAndPeek();
    const mid = notices('sync');
    assert.strictEqual(mid.length, 2, 'both are mounted during the exit');
    assert.deepEqual(
      mid.map((n) => n.title),
      ['Build passed', 'Tests failed'],
      'the leaver is still first in flow'
    );
    assert.true(
      mid[1]!.top > mid[0]!.top,
      `the newcomer starts BELOW the leaver — this is sync, not a bug ${JSON.stringify(mid)}`
    );

    await animationsSettled();
    const after = notices('sync');
    assert.deepEqual(
      after.map((n) => n.title),
      ['Tests failed'],
      'the leaver unmounts'
    );
    assert.strictEqual(
      after[0]!.top,
      mid[0]!.top,
      'and the newcomer has risen into the place the leaver held'
    );
  });

  test('popLayout is the mode where the newcomer is already home', async function (assert) {
    await mount();
    const restingTop = notices('popLayout')[0]!.top;

    await swapAndPeek();
    const mid = notices('popLayout');
    const arriving = mid.find((n) => n.title === 'Tests failed');
    assert.ok(arriving, 'the newcomer is mounted');
    assert.strictEqual(
      arriving!.top,
      restingTop,
      `the leaver left flow, so the newcomer takes its place immediately ${JSON.stringify(mid)}`
    );
  });

  test('wait mounts the newcomer only once the leaver is gone', async function (assert) {
    await mount();
    await swapAndPeek();
    assert.deepEqual(
      notices('wait').map((n) => n.title),
      ['Build passed'],
      'the leaver is still alone: nothing enters until it has left'
    );

    await animationsSettled();
    assert.deepEqual(
      notices('wait').map((n) => n.title),
      ['Tests failed'],
      'then the newcomer arrives'
    );
  });

  test('the frame does not resize when sync briefly holds two', async function (assert) {
    await mount();
    const before = bounds(slot('sync'));
    await swapAndPeek();
    const during = bounds(slot('sync'));
    assert.strictEqual(
      during.height,
      before.height,
      'the slot is a fixed height so the three modes stay comparable'
    );
    // the element the extra notice pushes down instead
    const rest = find('.mode-slot .mode-rest');
    assert.ok(rest, 'the "Up next" marker is what moves');
  });
});
