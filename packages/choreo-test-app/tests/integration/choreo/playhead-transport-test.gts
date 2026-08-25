/**
 * The Playhead demo on `c.run` — the score is a <c.Sequence>, the presses
 * are named dips of the hand, and the transport folds the app's state from
 * the presses behind the playhead. The old private sampler is gone; these
 * pin what replaced it.
 */
import { render, settled, waitUntil } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import type { ChoreoRun } from 'glimmer-motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { Playhead } from 'test-app/components/examples/playhead';

function run(): ChoreoRun | null {
  const stage = document.querySelector('.ph-stage') as
    | (HTMLElement & { playhead?: { c?: { run: ChoreoRun | null } } })
    | null;
  return stage?.playhead?.c?.run ?? null;
}

function styleOf(selector: string): string {
  return document.querySelector(selector)?.getAttribute('style') ?? '';
}

function scrubTo(seconds: number) {
  const range = document.querySelector<HTMLInputElement>('.ph-range')!;
  range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  range.value = String(seconds);
  range.dispatchEvent(new Event('input', { bubbles: true }));
  range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

module('Integration | choreo | playhead transport', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the parked opening, a scrub, and the fold', async function (assert) {
    await render(<template><Playhead /></template>);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await frames(6);

    const r = run()!;
    assert.ok(
      Math.abs(r.duration - 6.16) < 0.05,
      `the score compiles to its full length — ${r.duration.toFixed(2)}s`
    );
    assert.ok(r.time < 0.2, `parked near zero, waiting for Play — at ${r.time.toFixed(2)}`);
    assert.strictEqual(
      document.querySelectorAll('.ph-mark').length,
      4,
      'four press marks, read back from the compiled cues'
    );

    // scrub past express, wrap and place: the fold has all three pressed
    scrubTo(3.9);
    await frames(6);
    assert.true(
      styleOf('.ph-pill').includes('127'),
      `the pill sits at Express — got '${styleOf('.ph-pill')}'`
    );
    assert.true(
      styleOf('.ph-receipt').includes('opacity: 1'),
      `the receipt is up — got '${styleOf('.ph-receipt')}'`
    );
    assert.dom('[data-cue="express"]').hasClass('is-on');
    assert.dom('[data-cue="wrap"]').hasAttribute('aria-pressed', 'true');

    // back before anything happened: the same question, a smaller number
    scrubTo(0.2);
    await frames(6);
    assert.false(
      styleOf('.ph-pill').includes('127'),
      `the pill is home again — got '${styleOf('.ph-pill')}'`
    );
    assert.true(
      styleOf('.ph-receipt').includes('opacity: 0'),
      `the receipt is down — got '${styleOf('.ph-receipt')}'`
    );
    assert.dom('[data-cue="standard"]').hasClass('is-on');

    run()?.cancel();
    await settled();
  });

  test('playing dispatches real clicks; a live hand takes the scene', async function (assert) {
    await render(<template><Playhead /></template>);
    await waitUntil(() => run() != null, { timeout: 4000 });
    await frames(6);

    // play through the first press (~1.08s): the score clicks Express
    document.querySelector<HTMLButtonElement>('.ph-play')!.click();
    await waitUntil(
      () =>
        document
          .querySelector('[data-cue="express"]')
          ?.classList.contains('is-on') ?? false,
      { timeout: 4000 }
    );
    assert.dom('[data-cue="express"]').hasClass('is-on');

    // a human click takes the timeline out of the loop
    document.querySelector<HTMLButtonElement>('[data-cue="standard"]')!.click();
    await frames(4);
    assert
      .dom('.ph-transport')
      .hasClass('is-off', 'the transport steps aside for a live hand');
    assert.dom('[data-cue="standard"]').hasClass('is-on');

    // and the scrubber takes it back: the fold wins over the live click
    scrubTo(2.0);
    await waitUntil(
      () =>
        !(
          document
            .querySelector('.ph-transport')
            ?.classList.contains('is-off') ?? true
        ),
      { timeout: 4000 }
    );
    await frames(8);
    assert.dom('[data-cue="express"]').hasClass('is-on');
    assert.true(
      styleOf('.ph-pill').includes('127'),
      `the score's answer at 2.0s stands — got '${styleOf('.ph-pill')}'`
    );

    run()?.cancel();
    await settled();
  });
});
