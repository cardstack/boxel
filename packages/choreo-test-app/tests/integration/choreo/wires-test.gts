/**
 * Wires — c.Tether (docs/choreo-constructs.md §6.1, §8.1).
 * A morning note in three drafts: marks in the prose, comments in the
 * margin, cubics derived every frame. Versions reflow the copy; the
 * selected pair shows its thread (first comment on by default).
 */
import {
  click,
  find,
  render,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Wires } from 'test-app/components/examples/wires';

import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | wires', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  /**
   * The resting threads are DERIVED geometry: the modifier waits a frame
   * for layout, then draws, and redraws again while the region's own
   * tethers are aloft. `animationsSettled()` says the run is done — it
   * cannot know a post-render painter still owes a frame — so the count
   * is waited for rather than sampled.
   */
  const resting = () => document.querySelectorAll('.wires-rest path').length;
  const restingCount = (n: number) =>
    waitUntil(() => resting() === n, { timeout: 2000 });

  test('a version pass keeps a live tether inside a moving comment', async function (assert) {
    await render(<template><Wires /></template>);
    await animationsSettled();
    await restingCount(2);
    assert.strictEqual(resting(), 2, 'V1 draws two resting threads');

    await click('[data-test-wires-v="V2"]');
    await nextFrame();
    await nextFrame();
    const path = find('[data-choreo-tether]') as SVGPathElement | null;
    assert.ok(path, 'the run draws tethers for the window');
    const d = path!.getAttribute('d') ?? '';
    const nums = [...d.matchAll(/-?\d+\.?\d*/g)].map(Number);
    const endX = nums[nums.length - 2]!;
    const note = find('[data-test-wires-note="gauge"]') as HTMLElement;
    const layer = find('[data-choreo-tethers]') as unknown as SVGSVGElement;
    const tBox = note.getBoundingClientRect();
    const inverse = layer.getScreenCTM()?.inverse();
    const localX = inverse
      ? new DOMPoint(tBox.left, tBox.top).matrixTransform(inverse).x
      : tBox.left - layer.getBoundingClientRect().left;
    assert.true(
      Math.abs(endX - localX) < 10,
      `the wire ends in the moving comment (${endX} vs ${localX})`
    );
    await animationsSettled();
    assert.dom('[data-test-wires-note="hed"]').exists();
    await restingCount(3);
    assert.strictEqual(resting(), 3, 'V2 draws the inserted thread');
  });

  test('stepping back removes the inserted comment; the first pair stays selected', async function (assert) {
    await render(<template><Wires /></template>);
    await animationsSettled();
    await restingCount(2);
    const host = find('[data-test-wires]') as HTMLElement;
    assert.strictEqual(
      host.getAttribute('data-hot'),
      'gauge',
      'the first comment is selected on load'
    );
    const first = find('.wires-thread[data-thread="gauge"]') as Element;
    assert.true(
      parseFloat(getComputedStyle(first).opacity) > 0.5,
      'its thread is drawn at rest'
    );

    await click('[data-test-wires-v="V2"]');
    await animationsSettled();
    await click('[data-test-wires-v="V1"]');
    await animationsSettled();
    assert.dom('[data-test-wires-note="hed"]').doesNotExist();
    await restingCount(2);
    assert.strictEqual(resting(), 2, 'the inserted thread is gone');

    const note = find('[data-test-wires-note="edition"]') as HTMLElement;
    await triggerEvent(note, 'pointerenter');
    assert.strictEqual(
      host.getAttribute('data-hot'),
      'edition',
      'hover moves the selection without a rerender'
    );
    const thread = find('.wires-thread[data-thread="edition"]') as Element;
    // Selecting is an attribute write; SHOWING the thread is a 180ms CSS
    // transition on top of it. Reading opacity on the frame the attribute
    // changed reads the start of that transition, which is zero — so wait
    // for the paint the attribute asked for, then assert it.
    const lit = () => parseFloat(getComputedStyle(thread).opacity);
    await waitUntil(() => lit() > 0.5, { timeout: 1000 });
    assert.true(lit() > 0.5, 'the resting cubic follows the selected pair');
  });
});
