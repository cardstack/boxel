import * as TestWaiters from '@ember/test-waiters';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { useTestWaiters } from '@cardstack/runtime-common';

export function setupQUnit() {
  QUnit.dump.maxDepth = 20;
  useTestWaiters(TestWaiters);
  setup(QUnit.assert);
  QUnit.config.autostart = false;

  // TEMPORARY leak-hunting probe: after each test, force GC (via --expose-gc
  // when available) and emit a marker line with memory stats. The marker is
  // watched by scripts/heap-snapshot-runner.js; the memory stats give per-test
  // heap deltas in CI logs (needs --enable-precise-memory-info to be exact).
  let probeCount = 0;
  QUnit.testDone((details) => {
    probeCount++;
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    let mem = '';
    try {
      let pm = performance && performance.memory;
      if (pm) {
        let used = (pm.usedJSHeapSize / 1048576).toFixed(1);
        let total = (pm.totalJSHeapSize / 1048576).toFixed(1);
        mem = ` used=${used}MB total=${total}MB`;
      }
    } catch (_) {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.log(
      `PROBE t=${probeCount}${mem} name="${details && details.name ? details.name : ''}"`,
    );
  });
}
