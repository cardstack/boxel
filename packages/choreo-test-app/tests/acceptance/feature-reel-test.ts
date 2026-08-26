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

module('Acceptance | feature reel transport', function (hooks) {
  setupApplicationTest(hooks);

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
    // declared pose — reconstruction must land both on the identical pixel
    await reel().renderAt(14.5);
    assert.strictEqual(
      worldTransform(),
      buildLogo,
      '14.5s and 8.9s declare the same aim and paint the same frame'
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
});
