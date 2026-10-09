/**
 * The Fold demo's argument, asserted.
 *
 * The tile exists to show one thing: on a backward seek, Choreo calls the
 * host's reset and then replays the remaining prefix, so a scrub is a
 * RE-DERIVATION rather than an undo. The A/B toggle turns the host's half of
 * that contract off, and the two latching commands — `soak.start` and
 * `cone.drop` — are where the difference shows. Everything else in the
 * schedule is an absolute setting that re-derives correctly by accident, so a
 * test that only checked `gas` would pass against a broken host.
 */
import { settled } from '@ember/test-helpers';

import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  frames,
  setupChoreoGalleryTest,
  setupStageViewport,
} from '../helpers/choreo-gallery-stage';

import type { ComponentLike } from '@glint/template';

/** the score's own length: five 0.9s holds and a 0.5s tail */
const DURATION = 5;

/** the moment the demo argues with: after `damper.open`, before both latches */
const PROBE = 1.2;

/**
 * A replay swaps the run, and the new one does not exist until Ember has
 * re-rendered the region AND the transport has adopted it on a later frame.
 * Waiting only on frames seeks the run that is being thrown away — which
 * silently produces the RIGHT answer for the wrong reason, because a fresh
 * run sitting at zero looks exactly like a host that reset correctly.
 */
async function restart(app: Host) {
  app.replay();
  await settled();
  await frames(4);
}

interface Host {
  /** the demo's Choreo region, whose run the demo drives */
  c?: { run: { cancel(): void } | null };
  play: () => void;
  replay: () => void;
  resets: number;
  seek: (t: number) => void;
  setFold: (honours: boolean) => void;
  state: { cone: boolean; damper: boolean; gas: number; soak: boolean };
}

/**
 * Mount, take the demo's own handle, choose which host is wired, and run the
 * score to its end.
 *
 * The mode is chosen BEFORE the first firing on purpose. `honoursReset` is
 * tracked and read by the template, so flipping it mid-run re-renders the
 * region and swaps the run underneath whatever seek comes next — and a fresh
 * run sitting at zero looks exactly like a host that reset correctly, so the
 * broken case would pass for the wrong reason.
 */
async function fired(honours = true) {
  await gallery.renderStage(Fold);
  const el = document.querySelector('.kf-stage') as HTMLElement & {
    fold?: Host;
  };
  const app = el.fold!;
  if (!honours) {
    app.setFold(false);
    await settled();
  }
  await restart(app);
  app.seek(DURATION);
  await frames(6);
  return app;
}

let gallery: ReturnType<typeof setupChoreoGalleryTest>;
let Fold: ComponentLike;

module('Integration | Choreo gallery | fold', function (hooks) {
  gallery = setupChoreoGalleryTest(hooks);
  setupStageViewport(hooks);

  hooks.beforeEach(async function () {
    Fold = await gallery.stage('fold', 'Fold');
  });

  test('a seek to the end leaves the whole schedule applied', async function (assert) {
    const app = await fired();
    assert.deepEqual(
      app.state,
      { cone: true, damper: true, gas: 0, soak: true },
      'every command landed: the latches are set and gas.off took gas back to 0',
    );
  });

  test('rewinding resets the host and replays only the prefix', async function (assert) {
    const app = await fired();
    app.seek(PROBE);
    await frames(6);
    assert.deepEqual(
      app.state,
      { cone: false, damper: true, gas: 2, soak: false },
      'at 1.2s: gas re-derived to 2, damper still open, both latches cleared',
    );
    assert.strictEqual(app.resets, 1, 'the host was reset exactly once');
  });

  test('a host that ignores the reset keeps latches from a future that no longer happened', async function (assert) {
    const app = await fired(false);
    // guard the setup: if the score never reached its end, the assertion
    // below would pass on a cold host rather than on a broken one
    assert.deepEqual(
      app.state,
      { cone: true, damper: true, gas: 0, soak: true },
      'the broken host still ran the whole schedule forward',
    );
    app.seek(PROBE);
    await frames(6);
    assert.deepEqual(
      app.state,
      { cone: true, damper: true, gas: 2, soak: true },
      `gas re-derives by accident — soak and cone are the ones left wrong (got ${JSON.stringify(app.state)}, resets ${app.resets})`,
    );
    assert.strictEqual(app.resets, 0, 'and it never counted a reset');
  });

  test('play at the end starts over from cold rather than seeking back', async function (assert) {
    const app = await fired();
    assert.true(app.state.cone, 'the run is parked at its end');
    app.play();
    await settled();
    await frames(4);
    assert.deepEqual(
      app.state,
      { cone: false, damper: false, gas: 0, soak: false },
      'the kiln is cold again: a fresh run, not a rewind through the old one',
    );
    assert.strictEqual(app.resets, 0, 'and the reset count starts over too');
  });

  test('play at the end comes clean even for the host that ignores resets', async function (assert) {
    // the case the branch exists for: seeking to zero would be a BACKWARD
    // seek, and a host that ignores the reset would carry its latches into
    // the new pass and never come clean — which reads as the demo being
    // stuck rather than as the point it is making
    const app = await fired(false);
    app.play();
    await settled();
    await frames(4);
    assert.deepEqual(
      app.state,
      { cone: false, damper: false, gas: 0, soak: false },
      'the broken host is cold again, because nothing was rewound',
    );
  });

  /**
   * The scene has to FIT, in every box a card comes in.
   *
   * Two traps are baked into this test because both of them let an earlier
   * version pass while the temperature was visibly cut off the top of the
   * card. The stage CENTRES its column, so content that does not fit
   * overflows at both ends and `scrollHeight` — which only reports the
   * downward half — says everything is fine. And the layout has to be
   * measured after it settles, not on the frame `render()` returns.
   */
  const fits = (label: string, w: number, h: number) =>
    test(`the whole scene fits ${label} without clipping`, async function (assert) {
      await gallery.renderStage(Fold, { width: w, height: h });
      // The score starts when the stage comes into view, and the demo holds
      // its run paused at the end rather than letting it finish. Run to the
      // end and stopped, the scene is measured at rest with every command
      // applied.
      const handle = (
        document.querySelector('.kf-stage') as HTMLElement & { fold?: Host }
      ).fold!;
      await restart(handle);
      handle.seek(DURATION);
      await frames(6);
      handle.c?.run?.cancel();
      await animationsSettled();

      const stage = document.querySelector('.kf-stage') as HTMLElement;
      const kids = [...stage.children].filter(
        (el) => (el as HTMLElement).offsetHeight > 0,
      ) as HTMLElement[];
      // the scene's own rows, not the region's full-height internals
      const own = kids.filter((el) => el.className.startsWith('kf-'));
      const top = Math.min(...own.map((el) => el.offsetTop));
      const bottom = Math.max(
        ...own.map((el) => el.offsetTop + el.offsetHeight),
      );
      const report = JSON.stringify({
        bottom,
        frame: stage.clientHeight,
        parts: own.map((el) => [
          el.className.split(' ')[0],
          el.offsetTop,
          el.offsetHeight,
        ]),
        top,
      });
      assert.true(top >= -1, `nothing overflows the top ${report}`);
      assert.true(
        bottom <= stage.clientHeight + 1,
        `nothing overflows the bottom ${report}`,
      );
    });

  fits('a phone-sized card', 359, 400);
  fits('a desktop card', 557, 400);

  test('repeating the same seek changes nothing', async function (assert) {
    const app = await fired();
    app.seek(PROBE);
    await frames(6);
    const once = { ...app.state };
    const resets = app.resets;
    app.seek(PROBE);
    await frames(6);
    assert.deepEqual(
      app.state,
      once,
      'idempotent: the same clock, the same state',
    );
    assert.strictEqual(app.resets, resets, 'and no second reset');
  });
});
