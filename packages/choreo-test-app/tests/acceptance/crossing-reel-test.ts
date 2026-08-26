/**
 * The Kiln Magic Move reel: three clips of the same identities, the
 * transition is the trip. Tests step clips through the public handle so
 * live autoplay (a play()-driven conductor) cannot race the assertions.
 */
import { find, settled, visit } from '@ember/test-helpers';
import { setupApplicationTest } from 'ember-qunit';
import {
  animationsSettled,
  orphanCount,
  strandedTransforms,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

interface CrossingReelHandle {
  go(clip: 0 | 1 | 2): void;
}

const reel = () =>
  (window as Window & { __choreoCrossingReel?: CrossingReelHandle })
    .__choreoCrossingReel!;

const plateBox = () =>
  (find('[data-test-plate]') as HTMLElement).getBoundingClientRect();

module('Acceptance | crossing reel', function (hooks) {
  setupApplicationTest(hooks);

  test('three clips Magic-Move the same plate, title, and note', async function (assert) {
    await visit('/_crossing-reel');
    await animationsSettled();

    const root = find('[data-test-crossing-reel]') as HTMLElement;
    assert.ok(reel(), 'the reel published its handle');
    assert.strictEqual(root.dataset.clip, '0', 'opens on the title card');
    assert.dom('[data-test-title]').hasText('Kiln');
    assert.dom('[data-test-note]').doesNotExist('clip 0 has no note');

    const titleCard = plateBox();
    reel().go(1);
    await settled();
    await animationsSettled();

    assert.strictEqual(root.dataset.clip, '1', 'clip 2 — the split');
    const split = plateBox();
    assert.true(
      split.width - titleCard.width > 40,
      `plate grew into the right half (${titleCard.width.toFixed(0)} → ${split.width.toFixed(0)})`
    );
    assert.dom('[data-test-note]').hasText('Hold 1280°');

    reel().go(2);
    await settled();
    await animationsSettled();

    assert.strictEqual(root.dataset.clip, '2', 'clip 3 — the bleed');
    const bleed = plateBox();
    assert.true(
      Math.abs(bleed.left - split.left) > 20,
      `plate travelled to the left edge (${split.left.toFixed(0)} → ${bleed.left.toFixed(0)})`
    );
    assert.dom('[data-test-note]').hasText('Pass 04');
    assert.strictEqual(orphanCount(), 0, 'no orphans after the last landing');
    assert.deepEqual(
      strandedTransforms(),
      [],
      'nothing wearing a leftover transform'
    );
  });

  test('a mid-flight cut retargets rather than queueing', async function (assert) {
    await visit('/_crossing-reel');
    await animationsSettled();

    reel().go(1);
    await settled();
    reel().go(2);
    await settled();
    await animationsSettled();

    assert.strictEqual(
      (find('[data-test-crossing-reel]') as HTMLElement).dataset.clip,
      '2',
      'the second cut won'
    );
    assert.dom('[data-test-note]').hasText('Pass 04');
    assert.strictEqual(orphanCount(), 0);
    assert.deepEqual(strandedTransforms(), []);
  });
});
