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
  let probeCount = 0;
  QUnit.testDone(() => {
    probeCount++;
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    if (probeCount % 10 === 0) {
      try {
        let pm = performance && performance.memory;
        if (pm) {
          let used = (pm.usedJSHeapSize / 1048576).toFixed(1);
          let total = (pm.totalJSHeapSize / 1048576).toFixed(1);
          // eslint-disable-next-line no-console
          console.log(`MEMPROBE t=${probeCount} used=${used}MB total=${total}MB`);
        }
      } catch (_) {
        /* ignore */
      }
    }
  });
}
