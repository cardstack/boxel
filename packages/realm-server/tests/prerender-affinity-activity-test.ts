import { module, test } from 'qunit';
import { basename } from 'path';
import { AffinityActivityTracker } from '../prerender/affinity-activity.ts';

// CS-10872 (affinity-snapshot diagnostic). The Prerenderer reads this
// tracker at render-settle time and merges its output with
// PagePool queue depths into `response.meta.diagnostics.affinitySnapshot`.
// Policy we care about here: self-exclusion, ageMs computation, kind/state
// fidelity, per-affinity isolation. The Prerenderer class itself launches
// Chrome in its constructor (PagePool.warmStandbys), so — like
// `computeBatchClearCacheGate` for CS-10758 — we test the extracted
// helper directly rather than spinning up a full Prerenderer.

module(basename(import.meta.filename), function () {
  const REALM_A = 'realm:http://localhost:4201/user/alpha/';
  const REALM_B = 'realm:http://localhost:4201/user/beta/';

  function trackerAt(startAt: number): {
    tracker: AffinityActivityTracker;
    advance: (ms: number) => void;
  } {
    let now = startAt;
    return {
      tracker: new AffinityActivityTracker({ now: () => now }),
      advance: (ms) => {
        now += ms;
      },
    };
  }

  test('self is excluded from its own snapshot', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    let self = tracker.record(
      REALM_A,
      'http://localhost/x.json',
      'visit',
      'file',
    );
    assert.deepEqual(
      tracker.sameAffinityActivity(REALM_A, self.handle),
      [],
      'lone call has no same-affinity siblings',
    );
  });

  test('sibling module call on same affinity appears as queued with its URL', function (assert) {
    let { tracker, advance } = trackerAt(1_000_000);
    let outer = tracker.record(
      REALM_A,
      'http://localhost/index.json',
      'visit',
      'file',
    );
    advance(50);
    tracker.record(
      REALM_A,
      'http://localhost/customer.gts',
      'module',
      'module',
    );
    advance(25);

    let snap = tracker.sameAffinityActivity(REALM_A, outer.handle);
    assert.strictEqual(snap.length, 1, 'one sibling visible');
    assert.deepEqual(
      {
        url: snap[0]!.url,
        kind: snap[0]!.kind,
        queue: snap[0]!.queue,
        state: snap[0]!.state,
      },
      {
        url: 'http://localhost/customer.gts',
        kind: 'module',
        queue: 'module',
        state: 'queued',
      },
      'sibling recorded as a queued module call on the module queue',
    );
    assert.strictEqual(
      snap[0]!.ageMs,
      25,
      'ageMs reflects time since sibling was recorded',
    );
  });

  test('markRunning flips state; release removes the entry', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    let outer = tracker.record(
      REALM_A,
      'http://localhost/i.json',
      'visit',
      'file',
    );
    let sibling = tracker.record(
      REALM_A,
      'http://localhost/c.gts',
      'module',
      'module',
    );

    sibling.markRunning();
    assert.strictEqual(
      tracker.sameAffinityActivity(REALM_A, outer.handle)[0]!.state,
      'running',
      'markRunning flips the entry state',
    );

    sibling.release();
    assert.deepEqual(
      tracker.sameAffinityActivity(REALM_A, outer.handle),
      [],
      'release removes the entry',
    );
  });

  test('release is idempotent and survives missing affinity', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    let h = tracker.record(REALM_A, 'http://localhost/x', 'visit', 'file');
    h.release();
    h.release(); // must not throw
    assert.ok(true, 'release-after-release is a no-op');
  });

  test('per-affinity isolation — sibling on different affinity is NOT visible', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    let outer = tracker.record(
      REALM_A,
      'http://localhost/i.json',
      'visit',
      'file',
    );
    tracker.record(REALM_B, 'http://localhost/other.gts', 'module', 'module');

    assert.deepEqual(
      tracker.sameAffinityActivity(REALM_A, outer.handle),
      [],
      'only same-affinity siblings show in the snapshot',
    );
    assert.strictEqual(
      tracker.sameAffinityActivity(REALM_B).length,
      1,
      'but REALM_B correctly reports its own sibling when queried',
    );
  });

  test('snapshot without selfHandle returns all entries (diagnostic dump mode)', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    tracker.record(REALM_A, 'http://localhost/a', 'visit', 'file');
    tracker.record(REALM_A, 'http://localhost/b.gts', 'module', 'module');
    assert.strictEqual(
      tracker.sameAffinityActivity(REALM_A).length,
      2,
      'both entries listed when no selfHandle is provided',
    );
  });

  test('priority is captured on each entry and surfaced in snapshots', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    let outer = tracker.record(
      REALM_A,
      'http://localhost/i.json',
      'visit',
      'file',
      10,
    );
    tracker.record(REALM_A, 'http://localhost/bg.gts', 'module', 'module', 0);
    tracker.record(
      REALM_A,
      'http://localhost/refresh.gts',
      'module',
      'module',
      5,
    );

    let snap = tracker.sameAffinityActivity(REALM_A, outer.handle);
    let priorities = snap.map((s) => s.priority).sort((a, b) => a - b);
    assert.deepEqual(priorities, [0, 5], 'sibling priorities surfaced');
  });

  test('priority defaults to 0 when not provided', function (assert) {
    let { tracker } = trackerAt(1_000_000);
    tracker.record(REALM_A, 'http://localhost/x', 'visit', 'file');
    let snap = tracker.sameAffinityActivity(REALM_A);
    assert.strictEqual(snap[0]!.priority, 0, 'default priority is 0');
  });
});
