/**
 * The feature reel under a direct external clock — the acceptance proof
 * for docs/external-clock-camera-seek-handoff.md, on the page the bug was
 * found on. The reel's score is now the natural authoring contract (a
 * camera move, then a wait); before the transport reconstructed the
 * camera from the score prefix, every one of those waits had to be
 * written as a constant-easing camera duplicate or a random-access seek
 * landed on the wrong shot entirely. The checkpoints are the doc's own —
 * the times its packaged HyperFrames capture was verified at — and the
 * transaction driven here is renderAt(), the same one the capture
 * worker's hf-seek barrier calls.
 */
import { find, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { module, test } from 'qunit';

interface ReelHandle {
  renderAt(time: number): Promise<void>;
}

const reel = () =>
  (window as Window & { __choreoReel?: ReelHandle }).__choreoReel!;

const worldTransform = () =>
  (find('.reel-world') as HTMLElement).style.transform;

const zoomOf = (transform: string): number => {
  const m = /scale\(([\d.]+)\)/.exec(transform);
  return m ? parseFloat(m[1]!) : 1;
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const opacityOf = (sel: string) =>
  getComputedStyle(find(sel) as HTMLElement).opacity;

/**
 * Gone from the PICTURE. A removed participant the score names is a
 * Choreo leaver, and only a playing clock releases leavers — a scrub is
 * a still and must stay reversible — so under an external clock the
 * element may stand in the DOM at the opacity its fade landed on: zero.
 */
const visuallyGone = (sel: string) => {
  const el = find(sel);
  return !el || getComputedStyle(el).opacity === '0';
};

module('Acceptance | feature reel transport', function (hooks) {
  setupApplicationTest(hooks);
  setupChoreo(hooks);

  test('the preview PLAYS: WAAPI composites the camera, and cues fire with no recorder', async function (assert) {
    await visit('/_feature-reel');
    const world = find('.reel-world') as HTMLElement;

    // play() is GPU: during the live camera move a platform animation owns
    // the frame — the old preview paused and seeked every rAF and never
    // had one
    let running = false;
    for (let i = 0; i < 240 && !running; i++) {
      await frames(1);
      running = world.getAnimations().some((a) => a.playState === 'running');
    }
    assert.true(
      running,
      'a platform animation composites the camera during live preview'
    );

    // the 0.55s cue opens the lightbox through its real shot button, on
    // the preview clock, through the same fold capture uses
    let open = false;
    for (let i = 0; i < 240 && !open; i++) {
      await frames(1);
      open = Boolean(find('.reel-lightbox .overlay'));
    }
    assert.true(open, 'the photo.open cue fired on the preview clock');
  });

  test('the doc checkpoints land their shots from direct, out-of-order seeks', async function (assert) {
    await visit('/_feature-reel');
    assert.ok(reel(), 'the reel published its capture handle');

    // the doc's observed failure, replayed as the FIRST transport op on a
    // fresh page: 8.9s sits in a wait, clean past four camera windows
    await reel().renderAt(8.9);
    const buildLogo = worldTransform();
    assert.notStrictEqual(
      buildLogo,
      '',
      `8.9s paints a camera pose at all (was: the rest frame)`
    );
    assert.true(
      Number.isFinite(zoomOf(buildLogo)) && zoomOf(buildLogo) !== 1,
      `8.9s is a real shot, not identity (${buildLogo})`
    );

    // the remaining checkpoints, deliberately out of order — the score
    // frames a different aim at each of these, so every transform must
    // differ from the others
    const shots = new Map<number, string>();
    shots.set(8.9, buildLogo);
    for (const t of [1.5, 5.1, 10.8]) {
      await reel().renderAt(t);
      shots.set(t, worldTransform());
    }
    const seen = [...shots.values()];
    assert.strictEqual(
      new Set(seen).size,
      seen.length,
      `four aims, four distinct framings:\n${[...shots]
        .map(([t, s]) => `  ${t}s → ${s}`)
        .join('\n')}`
    );

    // the closing shot RETURNS to the logo aim: a different time, the same
    // declared pose — reconstruction must land both on the identical pixel.
    // Both landings are compared at their exact arrival instants, before
    // each hold's breathing push-in moves off the landed pose
    await reel().renderAt(8.75);
    const logoLanding = worldTransform();
    await reel().renderAt(12.9);
    assert.strictEqual(
      worldTransform(),
      logoLanding,
      '8.75s and 12.9s land the same declared aim on the identical frame'
    );

    // the lockup's SlowZoom is RELATIVE and must fold under random access:
    // deeper into the hold, the zoom has grown past the landed pose
    await reel().renderAt(14.5);
    assert.true(
      zoomOf(worldTransform()) > zoomOf(buildLogo) * 1.005,
      `14.5s: the push-in is under way (${worldTransform()})`
    );

    // random access must agree with itself: back to the failure time after
    // four other shots, to the pixel
    await reel().renderAt(8.9);
    assert.strictEqual(
      worldTransform(),
      buildLogo,
      'returning to 8.9s repaints the identical transform'
    );

    // and with a monotonically increasing external clock, the way a
    // sequential capture worker walks the composition
    for (let t = 0; t <= 8.9; t += 0.5) {
      await reel().renderAt(Math.min(t, 8.9));
    }
    await reel().renderAt(8.9);
    assert.strictEqual(
      worldTransform(),
      buildLogo,
      'walking 0 → 8.9 sequentially lands on the same frame as jumping there'
    );
  });

  test('the title plane and the demo fold reconstruct at every checkpoint', async function (assert) {
    await visit('/_feature-reel');

    // each checkpoint has exactly one third up — the plane's own score,
    // seeked by the same transaction that stands the camera
    await reel().renderAt(1.5);
    assert.strictEqual(opacityOf('[data-lt="lt-lightbox"]'), '1', '1.5s: 01');
    assert.true(
      Boolean(find('.reel-lightbox .overlay')),
      '1.5s: the photo.open cue folded in'
    );
    assert.true(
      visuallyGone('.reel-poster'),
      '1.5s: the poster clip cut away at 0.45s'
    );

    await reel().renderAt(5.1);
    assert.strictEqual(opacityOf('[data-lt="lt-beacons"]'), '1', '5.1s: 02');
    assert.strictEqual(
      opacityOf('[data-lt="lt-lightbox"]'),
      '0',
      '5.1s: 01 has left'
    );

    await reel().renderAt(8.9);
    assert.strictEqual(opacityOf('[data-lt="lt-build"]'), '1', '8.9s: 03');

    await reel().renderAt(14.5);
    assert.strictEqual(opacityOf('[data-lt="lt-logo"]'), '1', '14.5s: lockup');

    // the backward fold: photo.open cannot be un-clicked, so the lightbox
    // actor resets through its real close button and the empty prefix
    // replays — before the cue the lightbox is semantically CLOSED. Its
    // Presence exit then plays out on the demo's own engine (a monotonic
    // capture never walks backward, so the transient is preview-only).
    // 0.05s also predates the first title's 0.15s entrance, so the plane
    // must stand at its stylesheet rest
    await reel().renderAt(0.05);
    const overlay = find('.reel-lightbox .overlay');
    assert.true(
      !overlay || overlay.classList.contains('is-closing'),
      '0.05s after 14.5s: the lightbox folded back shut'
    );
    assert.strictEqual(
      opacityOf('[data-lt="lt-lightbox"]'),
      '0',
      '0.05s: no third is up yet'
    );
    assert.true(
      Boolean(find('.reel-poster')),
      '0.05s: the poster clip re-derives PRESENT from a backward fold'
    );
  });

  test('the poster crosses to the brand chip, and the flight is seekable', async function (assert) {
    await visit('/_feature-reel');

    // FIRST op on a fresh page lands mid-flight (window 0.45–1.15): the
    // boundary fold flips both clips in one pass, the changeset pairs the
    // wordmark with the chip, and the Move is sampled mid-journey
    await reel().renderAt(0.8);
    const chip = find('.reel-brand-mark') as HTMLElement;
    assert.ok(chip, '0.8s: the chip is mounted');
    const midFlight = chip.style.transform;
    assert.true(
      midFlight !== '' && midFlight !== 'none',
      `0.8s: the crossing is mid-flight (${midFlight})`
    );

    // past the flight: the chip rests in the corner, the poster is gone
    await reel().renderAt(5);
    assert.true(visuallyGone('.reel-poster'), '5s: the poster has left');
    assert.ok(find('.reel-brand-mark'), '5s: the chip holds the corner');

    // the same mid-flight time, revisited without recrossing the
    // boundary: the pair is unchanged and the sample must be identical
    await reel().renderAt(0.8);
    assert.strictEqual(
      (find('.reel-brand-mark') as HTMLElement).style.transform,
      midFlight,
      '0.8s revisited: the flight resamples identically'
    );

    // backward across the boundary: the poster is re-derived, standing —
    // and the region pairs the REVERSE crossing (chip → poster), which is
    // interactive scrub semantics: a monotonic capture never recrosses,
    // so the forward pair's geometry is the recorded one
    await reel().renderAt(0.1);
    assert.ok(find('.reel-poster'), '0.1s: the poster stands again');
    await reel().renderAt(0.8);
    const reflight = (find('.reel-brand-mark') as HTMLElement).style.transform;
    assert.true(
      reflight !== '' && reflight !== 'none',
      `0.8s after a recross: a fresh forward pair flies again (${reflight})`
    );
  });

  test('the clock plane keeps SMPTE time and pulses on its own camera', async function (assert) {
    await visit('/_feature-reel');

    // the readout is a parameter channel: pure function of the clock
    await reel().renderAt(8.9);
    assert.strictEqual(
      (find('.reel-clock-tc') as HTMLElement).textContent,
      '00:00:08:54',
      '8.9s is frame 54 of second 8'
    );

    // mid-transition (the world camera crossing to Build Order) the clock
    // plane's OWN camera is pulsed in — independent zoom on an overlay
    await reel().renderAt(7.0);
    const clockPlane = find('.reel-clock[data-choreo]') as HTMLElement;
    assert.true(
      Math.abs(zoomOf(clockPlane.style.transform) - 1.3) < 0.02,
      `7.0s: the clock plane stands pulsed (${clockPlane.style.transform})`
    );

    // and between transitions the pulse has returned whence it came
    await reel().renderAt(5.1);
    assert.true(
      Math.abs(zoomOf(clockPlane.style.transform) - 1) < 0.005,
      `5.1s: the clock plane is at rest (${clockPlane.style.transform})`
    );
    assert.strictEqual(
      (find('.reel-clock-tc') as HTMLElement).textContent,
      '00:00:05:06',
      '5.1s is frame 6 of second 5'
    );
  });

  test('the mark docks across planes: chip out of the brand plane, into the world', async function (assert) {
    await visit('/_feature-reel');

    // before the homecoming: chip in its corner, no mark in the world
    await reel().renderAt(12.0);
    assert.ok(find('.reel-brand-mark'), '12.0s: the chip holds the corner');
    assert.false(Boolean(find('.reel-dock-mark')), '12.0s: nothing docked');

    // direct seek INTO the flight: one fold flips both planes in one pass,
    // the barrier pairs chip and mark across regions, and the Move is
    // sampled mid-journey — into a world zoomed by the lockup framing
    await reel().renderAt(13.1);
    const mark = find('.reel-world .reel-dock-mark') as HTMLElement;
    assert.ok(mark, '13.1s: the mark is received in the WORLD region itself');
    assert.true(
      mark.style.transform !== '' && mark.style.transform !== 'none',
      `13.1s: the cross-plane flight is mid-journey (${mark.style.transform})`
    );
    assert.false(
      Boolean(find('.reel-brand-mark')),
      '13.1s: the chip has left the brand plane'
    );

    // landed: the mark rests in the world, under the world's camera
    await reel().renderAt(14.5);
    assert.ok(
      find('.reel-world .reel-dock-mark'),
      '14.5s: the mark rests in the scene, riding the push-in'
    );

    // and the backward fold sends it home
    await reel().renderAt(12.0);
    assert.ok(find('.reel-brand-mark'), '12.0s again: the chip is back');
    assert.false(
      Boolean(find('.reel-dock-mark')),
      '12.0s again: the world let it go'
    );
  });
});
