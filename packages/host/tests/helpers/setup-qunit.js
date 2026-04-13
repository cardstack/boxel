import { getContext } from '@ember/test-helpers';
import * as TestWaiters from '@ember/test-waiters';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { useTestWaiters } from '@cardstack/runtime-common';

export function setupQUnit() {
  QUnit.dump.maxDepth = 20;
  useTestWaiters(TestWaiters);
  setup(QUnit.assert);
  QUnit.config.autostart = false;

  // After each test, force GC (via --expose-gc) so V8 can release
  // per-test allocations before the next test starts. Without this, V8's
  // opportunistic GC can't keep up and the heap drifts toward the 4GB
  // ceiling in long shards. Every 10 tests we also log a memory line so
  // regressions are visible in CI output.
  //
  // We also hold WeakRefs to each test's `this.owner` so we can count how
  // many prior-test owners are still alive after GC. If that count grows
  // linearly with probeCount, we still have an owner-retention leak.
  let probeCount = 0;
  let ownerRefs = [];
  QUnit.testDone(() => {
    probeCount++;
    // Snapshot the owner NOW (testDone fires before the owner's container is
    // torn down for the current test). The WeakRef will be dereferenceable
    // until the owner is GC'd — which should happen at the next gc() call
    // if nothing retains it.
    try {
      let ctx = getContext && getContext();
      if (ctx && ctx.owner && typeof WeakRef === 'function') {
        ownerRefs.push(new WeakRef(ctx.owner));
      }
    } catch (_) {
      /* ignore */
    }
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    if (probeCount % 10 === 0) {
      let liveOwners = 0;
      if (typeof WeakRef === 'function') {
        // Compact the array: drop dead refs so the array itself doesn't
        // keep growing unbounded, but count how many survived.
        let kept = [];
        for (let ref of ownerRefs) {
          if (ref.deref()) {
            liveOwners++;
            kept.push(ref);
          }
        }
        ownerRefs = kept;
      }
      try {
        let pm = performance && performance.memory;
        if (pm) {
          let used = (pm.usedJSHeapSize / 1048576).toFixed(1);
          let total = (pm.totalJSHeapSize / 1048576).toFixed(1);
          console.log(
            `MEMPROBE t=${probeCount} used=${used}MB total=${total}MB live_owners=${liveOwners}`,
          );
        }
      } catch (_) {
        /* ignore */
      }
    }
  });
}
