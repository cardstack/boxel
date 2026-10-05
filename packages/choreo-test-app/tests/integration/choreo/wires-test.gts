/**
 * Wires — c.Tether (docs/choreo-constructs.md §6.1, §8.1).
 * A morning note in three drafts: marks in the prose, comments in the
 * margin, cubics derived every frame. Versions reflow the copy; the
 * selected pair shows its thread (first comment on by default).
 */
import { setupChoreo } from '@cardstack/choreo/test-support';
import {
  click,
  find,
  render,
  triggerEvent,
  waitUntil,
} from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Wires } from 'test-app/components/examples/wires';

import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | wires', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

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

  /**
   * The narrow layout is a different geometry, not a smaller one.
   *
   * Below 460px the board stops being two columns and puts the comments UNDER
   * the note, because a 148px floor on the margin column was leaving 110px for
   * the prose and wrapping a three-sentence note to nine lines. A tether is
   * derived from where its two ends actually are, so the only thing that has
   * to hold is that it still finds them — the wire runs downward instead of
   * sideways and is otherwise the same construct.
   */
  test('the threads still draw when the comments stack under the note', async function (assert) {
    await render(
      <template>
        <div style="position:relative;width:360px;height:620px">
          <Wires />
        </div>
      </template>
    );
    await animationsSettled();
    await restingCount(2);
    assert.strictEqual(resting(), 2, 'two resting threads at phone width');

    const copy = find('.wires-copy') as HTMLElement;
    const margin = find('.wires-margin') as HTMLElement;
    assert.true(
      margin.offsetTop >= copy.offsetTop + copy.offsetHeight - 2,
      'the comments are laid out below the note, not beside it'
    );
    const board = find('.wires-board') as HTMLElement;
    // offsetWidth, not a rect: QUnit scales #ember-testing, so every
    // getBoundingClientRect here comes back at half size and comparing one
    // against a CSS-pixel threshold measures the harness, not the layout
    assert.strictEqual(
      getComputedStyle(board).gridTemplateColumns.split(' ').length,
      1,
      'the board is one column'
    );
    assert.true(
      copy.offsetWidth > 200,
      `the prose gets the full width back ${JSON.stringify({
        board: board.offsetWidth,
        cols: getComputedStyle(board).gridTemplateColumns,
        copy: copy.offsetWidth,
      })}`
    );

    const paths = [
      ...document.querySelectorAll<SVGPathElement>('.wires-rest path'),
    ];
    assert.true(
      paths.every((p) => p.getTotalLength() > 0),
      'every thread has real length — the ends were found'
    );
  });

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

  test('resting ink holds its marks inside a transformed ancestor', async function (assert) {
    // A crossing carries the whole demo page mid-flight, scaled, while
    // the follow loop repaints — subtracting raw client rects baked that
    // scale into the ink and every thread stood off its mark for the
    // whole flight. The fixture is the flight reduced to one wrapper.
    const Carried = <template>
      <div
        style="transform: scale(0.82) translate(40px, 24px); transform-origin: 0 0"
      >
        <Wires />
      </div>
    </template>;
    await render(<template><Carried /></template>);
    await animationsSettled();
    await restingCount(2);

    const t = find('.wires-thread[data-thread="gauge"]') as SVGPathElement;
    const mark = find('[data-node="m-gauge"]') as HTMLElement;
    const d = t.getAttribute('d') ?? '';
    const m = /M (-?[\d.]+) (-?[\d.]+)/.exec(d)!;
    const inverse = t.ownerSVGElement!.getScreenCTM()!.inverse();
    const r = mark.getBoundingClientRect();
    const p = new DOMPoint(r.right, r.top + r.height / 2).matrixTransform(
      inverse
    );
    const err = Math.hypot(p.x - Number(m[1]), p.y - Number(m[2]));
    assert.true(
      err < 2,
      `the thread starts ON its mark under the transform (${err.toFixed(1)}px off)`
    );
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
