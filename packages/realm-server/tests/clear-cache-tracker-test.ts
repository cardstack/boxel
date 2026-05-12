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
// CS-11043 step 2 (this contract). Resetting the *whole* prerender state
// on every render in a batch erased per-batch hydration data that was
// baked into serialized HTML (the host's store cache), so the upgrade
// distinguishes two reset shapes:
//
//   - 'clear-cache'       — first render of a batch, full reset
//                           (Loader + store). Mirrors the historical
//                           consume-once behavior.
//   - 'reset-loader-only' — subsequent renders in a sticky batch,
//                           Loader-only reset so accumulated store
//                           hydration data survives for query-field
//                           serialization.
//   - 'none'              — no reset requested.

module(basename(__filename), function () {
  module('ClearCacheTracker — consume-once mode (default)', function () {
    test("first consume returns 'clear-cache', subsequent consumes return 'none'", function (assert) {
      let tracker = new ClearCacheTracker();
      assert.strictEqual(tracker.consume(), 'clear-cache', 'first call');
      assert.strictEqual(tracker.consume(), 'none', 'second call');
      assert.strictEqual(tracker.consume(), 'none', 'third call');
    });

    test("consume() returns 'none' immediately when constructed off", function (assert) {
      let tracker = new ClearCacheTracker({ initialMode: 'off' });
      assert.strictEqual(tracker.consume(), 'none');
      assert.strictEqual(tracker.consume(), 'none');
    });
  });

  module('ClearCacheTracker — sticky-for-batch mode', function () {
    test("upgradeToStickyForBatch on a fresh tracker: first consume returns 'clear-cache', subsequent return 'reset-loader-only'", function (assert) {
      let tracker = new ClearCacheTracker();
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(
        tracker.consume(),
        'clear-cache',
        'first consume after upgrade is full clear-cache',
      );
      for (let i = 0; i < 4; i++) {
        assert.strictEqual(
          tracker.consume(),
          'reset-loader-only',
          `consume #${i + 2} is reset-loader-only`,
        );
      }
    });

    test('upgrade after first consume rescues subsequent renders (the CS-11043 fan-out case)', function (assert) {
      // Mirrors the live shape of an IndexRunner batch where
      // executable invalidation is detected AFTER the first render
      // has already been queued. The first render already got the
      // full clear-cache; the upgrade ensures every subsequent
      // render gets a Loader reset so multi-page fan-out doesn't
      // serve stale modules.
      let tracker = new ClearCacheTracker();
      assert.strictEqual(
        tracker.consume(),
        'clear-cache',
        'first render gets full clear-cache',
      );
      assert.strictEqual(
        tracker.consume(),
        'none',
        'without upgrade, second render would get no reset',
      );
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(
        tracker.consume(),
        'reset-loader-only',
        'after upgrade, subsequent consumes reset only the loader',
      );
      assert.strictEqual(tracker.consume(), 'reset-loader-only', 'and stays');
    });

    test('upgrade is idempotent', function (assert) {
      let tracker = new ClearCacheTracker();
      tracker.upgradeToStickyForBatch();
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(tracker.consume(), 'clear-cache');
      assert.strictEqual(tracker.consume(), 'reset-loader-only');
    });

    test('an off tracker upgraded to sticky still flips on', function (assert) {
      // Operationally we don't expect this combination today, but the
      // contract should be unambiguous: upgrade lifts off → sticky,
      // and the first consume after lift is the batch's full reset.
      let tracker = new ClearCacheTracker({ initialMode: 'off' });
      assert.strictEqual(tracker.consume(), 'none', 'off before upgrade');
      tracker.upgradeToStickyForBatch();
      assert.strictEqual(
        tracker.consume(),
        'clear-cache',
        'first consume after upgrade is full clear-cache',
      );
      assert.strictEqual(
        tracker.consume(),
        'reset-loader-only',
        'subsequent consumes loader-only',
      );
    });
  });
});
