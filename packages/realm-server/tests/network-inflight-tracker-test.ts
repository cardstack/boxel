import { module, test } from 'qunit';
import { NetworkInflightTracker } from '../prerender/network-inflight-tracker';

// The tracker is the one render-hang signal that survives a wedged page
// JS thread: a passive CDP-side map of in-flight requests, read only on
// the timeout path. These tests pin the read-side contract the timeout
// diagnostics depend on — settling drops a request, the snapshot is
// oldest-first (the longest-hanging fetch is the interesting one), and
// both the count and per-URL length are capped so a pathological page
// can't bloat the persisted diagnostics row.
module('network-inflight-tracker', function () {
  test('a started request is reported until it settles', function (assert) {
    let tracker = new NetworkInflightTracker();
    tracker.recordStarted('1', 'https://example.com/a');
    tracker.recordStarted('2', 'https://example.com/b');
    assert.strictEqual(tracker.getPending().length, 2, 'both in flight');

    tracker.recordSettled('1');
    let pending = tracker.getPending();
    assert.strictEqual(pending.length, 1, 'settled request dropped');
    assert.strictEqual(pending[0].url, 'https://example.com/b');
  });

  test('settling an unknown request id is a no-op', function (assert) {
    let tracker = new NetworkInflightTracker();
    tracker.recordStarted('1', 'https://example.com/a');
    tracker.recordSettled('does-not-exist');
    assert.strictEqual(tracker.getPending().length, 1);
  });

  test('the snapshot is ordered oldest-first', function (assert) {
    let tracker = new NetworkInflightTracker();
    for (let i = 0; i < 5; i++) {
      tracker.recordStarted(String(i), `https://example.com/${i}`);
    }
    // recordStarted stamps startedAt at call time, so the snapshot must
    // come back with ageMs monotonically non-increasing (oldest first).
    let ages = tracker.getPending().map((r) => r.ageMs);
    let descending = [...ages].sort((a, b) => b - a);
    assert.deepEqual(ages, descending, 'ageMs is non-increasing');
  });

  test('the reported list is capped', function (assert) {
    let tracker = new NetworkInflightTracker();
    for (let i = 0; i < 25; i++) {
      tracker.recordStarted(String(i), `https://example.com/${i}`);
    }
    assert.strictEqual(
      tracker.getPending().length,
      20,
      'capped at MAX_PENDING_REPORTED',
    );
  });

  test('long URLs are truncated to the prefix', function (assert) {
    let tracker = new NetworkInflightTracker();
    let longUrl = 'https://example.com/' + 'x'.repeat(500);
    tracker.recordStarted('1', longUrl);
    let [only] = tracker.getPending();
    assert.strictEqual(only.url.length, 200, 'truncated to MAX_URL_LENGTH');
    assert.ok(longUrl.startsWith(only.url), 'truncation keeps the prefix');
  });
});
