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

  /**
   * A violent drag: dozens of input events, several per frame, sawing back
   * and forth across every build's window — the event rate of a real hand,
   * not a polite scripted scrub. Wherever the thumb finally rests, every
   * cue behind it must sit on its FINALS; a part stuck half-ghosted at a
   * mid-flight sample means a late animation commit clobbered the still.
   */
  test('a violent drag still lands every final', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    await frames(10);

    const range = document.querySelector<HTMLInputElement>('.bo-range')!;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const saw = [
      3.0, 0.5, 3.5, 0.8, 2.5, 1.2, 3.9, 0.3, 2.9, 1.6, 3.3, 0.7, 2.1, 1.0, 3.7,
      0.4, 2.7, 1.4, 3.1, 0.9,
    ];
    for (const [i, v] of saw.entries()) {
      range.value = String(v);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      if (i % 3 === 2) {
        await frames(1); // ~three events per frame, like a real drag
      }
    }
    // rest past every mark build's end
    range.value = '3.2';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await frames(8);

    for (const sel of [
      '.bo-plate',
      '.bo-tail',
      '.bo-head',
      '.bo-orbit',
      '.bo-tip',
      '.bo-word',
      '.bo-rule',
    ]) {
      assert.true(
        styleOf(sel).includes('opacity: 1'),
        `${sel} on its finals after the storm — got '${styleOf(sel)}'`
      );
    }
    const dash = (sel: string) =>
      document.querySelector(sel)?.getAttribute('stroke-dasharray') ?? '(none)';
    for (const sel of ['.bo-tail', '.bo-head', '.bo-orbit', '.bo-tip']) {
      assert.false(
        dash(sel).startsWith('0'),
        `${sel} fully drawn — stroke-dasharray '${dash(sel)}'`
      );
    }
    await windDown();
  });

  /**
   * The word builds in — and STAYS. After its delivery lands, the sprite
   * must sit at its end values for the rest of the take: the restore puts
   * Glimmer's own text nodes back, and the container must be wearing
   * opacity 1, not the pin it stood on before its window.
   */
  test('a delivered build stays landed for the rest of the take', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });

    // watch the word straight through its window while the run PLAYS —
    // reading the CURRENT run each poll: early passes replace the first one
    const word = document.querySelector<HTMLElement>('.bo-word')!;
    const seen: { spans: number; style: string; t: number }[] = [];
    await waitUntil(
      () => {
        const run = handle().c?.run;
        if (!run) {
          return false;
        }
        seen.push({
          spans: word.querySelectorAll('span').length,
          style: word.getAttribute('style') ?? '',
          t: Math.round(run.time * 100) / 100,
        });
        return run.time > 3.3;
      },
      { timeout: 9000 }
    );

    // past the word's end (~2.55s) and before the take ends: landed, whole
    const after = seen.filter((s) => s.t > 2.7 && s.t < 3.35);
    assert.true(
      after.length > 3,
      `sampled the post-delivery stretch (${after.length} samples)`
    );
    for (const s of after) {
      assert.true(
        s.style.includes('opacity: 1') && s.spans === 0,
        `word landed and whole at t=${s.t} — style '${s.style}', ${s.spans} spans`
      );
    }
    await windDown();
  });

  /**
   * Scrubbing PAST a delivery's end must finish the delivery: end values on
   * the sprite, stand-in spans gone, Glimmer's own text nodes back. Leaving
   * the split behind is how "the text exits": the paused spans survive the
   * scrub, the next take pins the container to opacity 0 over them, and the
   * take after that splits the wreckage of the first split.
   */
  test('a scrub through a delivery gives the text back', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    await frames(10);

    const word = document.querySelector<HTMLElement>('.bo-word')!;
    const range = document.querySelector<HTMLInputElement>('.bo-range')!;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // into the word's window: the still is delivered — split spans present
    scrubTo(2.1);
    await frames(4);
    assert.true(
      word.querySelectorAll('span').length > 0,
      'mid-window still is a split delivery'
    );

    // past its end: the delivery must be COMPLETE — restored, landed, whole
    scrubTo(2.9);
    await frames(4);
    assert.strictEqual(
      word.querySelectorAll('span').length,
      0,
      'past the end, the stand-in spans are gone'
    );
    assert.true(
      (word.getAttribute('style') ?? '').includes('opacity: 1'),
      `the container wears its end values — got '${word.getAttribute('style')}'`
    );
    assert.strictEqual(
      word.textContent?.trim(),
      'Choreo',
      "Glimmer's own text is back in the element"
    );

    // back in, and past again: the cycle is repeatable
    scrubTo(2.0);
    await frames(4);
    assert.true(
      word.querySelectorAll('span').length > 0,
      're-entering the window splits afresh'
    );
    scrubTo(3.9);
    await frames(4);
    assert.strictEqual(
      word.querySelectorAll('span').length,
      0,
      'and leaving it restores again'
    );
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await windDown();
  });

  /**
   * Scrubbing the loop's SECOND take. Every earlier test scrubs the first
   * run; the field failures (Safari and Chrome alike) all happened after
   * the demo had looped — the early builds stuck on their pinned origins
   * while the late builds landed. A take boundary is a full pass: the old
   * run releases for measure, a fresh run re-pins every first keyframe,
   * and THAT is the run a hand then drags through.
   */
  test('after the loop wraps, a scrub still lands every final', async function (assert) {
    await render(<template><BuildOrder /></template>);
    await waitUntil(() => handle().c?.run != null, { timeout: 4000 });
    const first = handle().c!.run!;

    // let the whole take play out and the loop bring the next one
    await waitUntil(() => handle().c?.run !== first, { timeout: 10000 });
    await frames(10);

    const range = document.querySelector<HTMLInputElement>('.bo-range')!;
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const v of [0.6, 2.8, 1.1, 3.6, 0.9, 3.2]) {
      range.value = String(v);
      range.dispatchEvent(new Event('input', { bubbles: true }));
      await frames(2);
    }
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await frames(8);

    for (const sel of [
      '.bo-plate',
      '.bo-tail',
      '.bo-head',
      '.bo-orbit',
      '.bo-bead',
      '.bo-tip',
      '.bo-word',
      '.bo-rule',
    ]) {
      assert.true(
        styleOf(sel).includes('opacity: 1'),
        `${sel} on its finals in take 2 — got '${styleOf(sel)}'`
      );
    }
    await windDown();
  });
});
