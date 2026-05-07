import { module, test } from 'qunit';
import { basename } from 'path';
import { ClearCacheTracker } from '@cardstack/runtime-common/index-runner/clear-cache-tracker';

// CS-11043. The IndexRunner used to track the "should the next render carry
// renderOptions.clearCache: true?" decision as a single boolean that the
// first render consumed and reset to false. That's correct as long as every
// render in the batch lands on the same puppeteer page — clearing the
// loader once primes the page for everything that follows. It's WRONG when
// the manager fans the batch out across multiple pages in the same affinity
// (PRERENDER_AFFINITY_TAB_MAX defaults to 5): only the first page sees
// clearCache, the rest keep stale module cache from earlier publishes of
// the same realm URL. The published nyuitp2026 realm rendered against an
// old presentation.gts for ~37 h after publishing for exactly this reason.
//
// The fix promotes the single boolean to a small state machine: default
// behavior (consume-once-then-stop) preserves the existing first-render
// arm, but when the IndexRunner detects an executable invalidation it
// upgrades the tracker to sticky-for-batch — every subsequent consume
// returns true so every fanned-out page gets a loader reset.

module(basename(__filename), function () {
  module('ClearCacheTracker — consume-once mode (default)', function () {
    test('first consume returns true, subsequent consumes return false', function (assert) {
      let tracker = new ClearCacheTracker();
      assert.strictEqual(tracker.consume(), true, 'first call returns true');
      assert.strictEqual(tracker.consume(), false, 'second call returns false');
      assert.strictEqual(tracker.consume(), false, 'third call returns false');
    });

    test('consume() returns false immediately when constructed off', function (assert) {
      let tracker = new ClearCacheTracker({ initialMode: 'off' });
      assert.strictEqual(tracker.consume(), false);
      assert.strictEqual(tracker.consume(), false);
    });
  });

  module('ClearCacheTracker — sticky-for-batch mode', function () {
    test('upgradeToStickyForBatch on a fresh tracker: every consume returns true', function (assert) {
      let tracker = new ClearCacheTracker();
      tracker.upgradeToStickyForBatch();
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(tracker.consume(), true, `consume #${i + 1}`);
      }
    });

    test('upgrade after first consume rescues subsequent renders (the CS-11043 fan-out case)', function (assert) {
      // Mirrors the live shape of an IndexRunner batch where
      // executable invalidation is detected AFTER the first render
      // has already been queued. Even in that ordering, every
      // subsequent render needs clearCache to land on its own page.
      let tracker = new ClearCacheTracker();
      assert.strictEqual(tracker.consume(), true, 'first render gets clearCache');
      assert.strictEqual(tracker.consume(), false, 'without upgrade, second would not');
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(tracker.consume(), true, 'after upgrade, every consume returns true');
      assert.strictEqual(tracker.consume(), true, 'and stays true');
    });

    test('upgrade is idempotent', function (assert) {
      let tracker = new ClearCacheTracker();
      tracker.upgradeToStickyForBatch();
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(tracker.consume(), true);
      assert.strictEqual(tracker.consume(), true);
    });

    test('an off tracker upgraded to sticky still flips on', function (assert) {
      // Operationally we don't expect this combination today, but the
      // contract should be unambiguous: the upgrade overrides off.
      let tracker = new ClearCacheTracker({ initialMode: 'off' });
      assert.strictEqual(tracker.consume(), false, 'off before upgrade');
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(tracker.consume(), true, 'sticky overrides off');
      assert.strictEqual(tracker.consume(), true);
    });
  });
});
