/**
 * The Build Order demo's transport, driven the way a hand drives it.
 *
 * The demo is the library's own reference for `c.run` as a transport: the
 * scrubber sets `run.time`, a scrubbed frame is a computed still, and a
 * still past a cue's end must show that cue's FINALS — not its pinned first
 * keyframes. This test plays the opening for a beat, then scrubs the real
 * range input around the timeline and asserts what the stage shows.
 */
import { render, settled, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import type { ChoreoRun } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { BuildOrder } from 'test-app/components/examples/build-order';

interface TransportHandle {
  c?: { run: ChoreoRun | null };
}

/** a parked run must not outlive its test: cancel it and let the world settle */
async function windDown() {
  handle().c?.run?.cancel();
  await settled();
}

function handle(): TransportHandle {
  const stage = document.querySelector('.bo-stage') as HTMLElement & {
    buildOrder?: TransportHandle;
  };
  return stage.buildOrder!;
}

function scrubTo(seconds: number) {
  const range = document.querySelector<HTMLInputElement>('.bo-range')!;
  range.value = String(seconds);
  range.dispatchEvent(new Event('input', { bubbles: true }));
}

function styleOf(selector: string): string {
  return document.querySelector(selector)?.getAttribute('style') ?? '';
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Integration | choreo | build-order transport', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('a scrubbed still past a cue shows finals, not pins', async function (assert) {
    await render(<template><BuildOrder /></template>);
    // the opening plays once the stage is seen; wait for the run to exist
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    // let it actually play a few frames
    await frames(20);

    // scrub PAST every mark build: they must all sit on their finals
    scrubTo(1.7);
    await frames(4);
    assert.true(
      styleOf('.bo-plate').includes('opacity: 1'),
      `plate landed after scrub past its window — got '${styleOf('.bo-plate')}'`
    );
    assert.false(
      styleOf('.bo-plate').includes('-38px'),
      'plate is not sitting on its pinned origin'
    );
    assert.true(
      styleOf('.bo-tail').includes('opacity: 1'),
      `tail landed — got '${styleOf('.bo-tail')}'`
    );
    assert.true(
      styleOf('.bo-orbit').includes('opacity: 1'),
      `orbit landed — got '${styleOf('.bo-orbit')}'`
    );

    // scrub to the very end: the text builds land too
    scrubTo(3.95);
    await frames(4);
    assert.true(
      styleOf('.bo-word').includes('opacity: 1'),
      `word landed — got '${styleOf('.bo-word')}'`
    );
    assert.true(
      styleOf('.bo-tag').includes('opacity: 1'),
      `tag landed — got '${styleOf('.bo-tag')}'`
    );

    // scrub back before the plate's start: it stands on its origin again
    scrubTo(0.0);
    await frames(4);
    assert.true(
      styleOf('.bo-plate').includes('opacity: 0'),
      `plate back on its origin at 0 — got '${styleOf('.bo-plate')}'`
    );

    // and forward again: finals once more, in either direction
    scrubTo(2.0);
    await frames(4);
    assert.true(
      styleOf('.bo-plate').includes('opacity: 1'),
      `plate lands again scrubbing forward — got '${styleOf('.bo-plate')}'`
    );
    await windDown();
  });

  test('the transport survives an edit while parked', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    await frames(10);

    scrubTo(1.7);
    await frames(4);
    const before = handle().c!.run!;

    // nudge build 1's delay: the pass replays; the new run must come back
    // parked at the same t, with finals still landed
    document
      .querySelector<HTMLButtonElement>('[aria-label="More delay"]')!
      .click();
    await waitUntil(() => handle().c?.run !== before, { timeout: 4000 });
    await frames(6);

    const run = handle().c!.run!;
    assert.ok(
      Math.abs(run.time - 1.7) < 0.25,
      `the new run stands where the hand parked it — at ${run.time}`
    );
    assert.true(
      styleOf('.bo-plate').includes('opacity: 1'),
      `plate still on finals after the edit — got '${styleOf('.bo-plate')}'`
    );
    await windDown();
  });

  /**
   * A real drag is not one synthetic input: it is pointerdown, THEN moves.
   * Two contracts, both learned in Safari: the moment the hand lands the
   * clock must stop (or the playing run crawls the thumb out from under the
   * finger before the first `input` fires), and for the whole drag nothing
   * may write the range's value programmatically — WebKit detaches its
   * pointer tracking when that happens, and the scrubber reads as dead.
   */
  test('a drag owns the thumb: nothing repaints the range under a hand', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    await frames(15); // playing, mid-take

    const range = document.querySelector<HTMLInputElement>('.bo-range')!;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await frames(2);
    const landed = range.value;
    await frames(6);
    assert.strictEqual(
      range.value,
      landed,
      'the thumb does not crawl under the finger while the hand holds it'
    );

    for (const v of ['1.3', '2.4', '3.4']) {
      range.value = v;
      range.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(3);
      assert.strictEqual(
        range.value,
        v,
        `the dragged value ${v} is not clobbered between input events`
      );
    }
    assert.true(
      styleOf('.bo-plate').includes('opacity: 1'),
      `the stage tracked the drag — plate landed at 3.4, got '${styleOf('.bo-plate')}'`
    );

    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await frames(4);
    assert.strictEqual(
      range.value,
      '3.4',
      'the released thumb is corrected only, never float-nudged'
    );

    document.querySelector<HTMLButtonElement>('.bo-play')!.click();
    await frames(10);
    assert.true(
      Number(range.value) > 3.4,
      `play resumes from where the hand left it — range at ${range.value}`
    );
    await windDown();
  });
});
