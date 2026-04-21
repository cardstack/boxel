import { isDestroyed, isDestroying } from '@ember/destroyable';
import { getApplication } from '@ember/test-helpers';
import * as TestWaiters from '@ember/test-waiters';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { useTestWaiters } from '@cardstack/runtime-common';

export function setupQUnit() {
  QUnit.dump.maxDepth = 20;
  useTestWaiters(TestWaiters);
  setup(QUnit.assert);
  QUnit.config.autostart = false;

  // Per-module memory delta probe — log each test file's contribution to
  // retained memory, independent of where it falls in shard order. We GC
  // at module boundaries so the start/end snapshots compare like-for-like.
  // QUnit module name is normally 1:1 with the test file. We only probe
  // top-level modules (fullName.length === 1) so nested modules don't
  // create overlapping start/end pairs.
  let usedAtModuleStart = null;
  let inTopLevelModule = false;
  QUnit.on('suiteStart', (details) => {
    let depth = Array.isArray(details.fullName) ? details.fullName.length : 1;
    if (depth !== 1) return;
    inTopLevelModule = true;
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    try {
      let pm = performance && performance.memory;
      usedAtModuleStart = pm ? pm.usedJSHeapSize : null;
    } catch (_) {
      usedAtModuleStart = null;
    }
  });
  QUnit.on('suiteEnd', (details) => {
    let depth = Array.isArray(details.fullName) ? details.fullName.length : 1;
    if (depth !== 1 || !inTopLevelModule) return;
    inTopLevelModule = false;
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    try {
      let pm = performance && performance.memory;
      if (pm) {
        let used = pm.usedJSHeapSize;
        let usedMB = (used / 1048576).toFixed(1);
        let totalMB = (pm.totalJSHeapSize / 1048576).toFixed(1);
        let deltaMB =
          usedAtModuleStart != null
            ? ((used - usedAtModuleStart) / 1048576).toFixed(1)
            : 'na';
        let tests = details.tests ? details.tests.length : 0;
        console.log(
          `MEMPROBE_FILE module=${JSON.stringify(details.name)} tests=${tests} used=${usedMB}MB total=${totalMB}MB delta=${deltaMB}MB`,
        );
      }
    } catch (_) {
      /* ignore */
    }
  });

  // After each test, force GC (via --expose-gc) so V8 can release
  // per-test allocations before the next test starts. Without this, V8's
  // opportunistic GC can't keep up and the heap drifts toward the 4GB
  // ceiling in long shards. Every 10 tests we also log a memory line so
  // regressions are visible in CI output.
  //
  // We also read App._applicationInstances.size directly from the Ember
  // Application — any ApplicationInstance that didn't complete willDestroy
  // stays in this Set and pins its Registry + template factories + Box trees.
  // A healthy test suite should keep this at 0 between tests; a linear
  // growth in `app_instances` means we have an ApplicationInstance-level leak.
  let probeCount = 0;
  QUnit.testDone(() => {
    probeCount++;
    // Sweep out ApplicationInstances whose willDestroy completed (isDestroyed
    // is set) but where super.willDestroy() errored before _unwatchInstance
    // could remove them from App._applicationInstances. Without this sweep,
    // each leaked instance pins its Registry → template factories →
    // FieldComponent closures → Box trees → ~7.5MB of base-realm module
    // sources. Removing destroyed instances from the Set is provably safe
    // (they're already in the DESTROYED state per @glimmer/destroyable).
    try {
      let app = getApplication && getApplication();
      if (app && app._applicationInstances) {
        for (let inst of app._applicationInstances) {
          if (isDestroyed(inst)) {
            app._applicationInstances.delete(inst);
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
      globalThis.gc();
    }
    if (probeCount % 10 === 0) {
      let appInstances = -1;
      let aliveInstances = -1;
      let destroyingInstances = -1;
      let destroyedInstances = -1;
      try {
        let app = getApplication && getApplication();
        if (app && app._applicationInstances) {
          appInstances = app._applicationInstances.size;
          aliveInstances = 0;
          destroyingInstances = 0;
          destroyedInstances = 0;
          for (let inst of app._applicationInstances) {
            if (isDestroyed(inst)) destroyedInstances++;
            else if (isDestroying(inst)) destroyingInstances++;
            else aliveInstances++;
          }
        }
      } catch (_) {
        /* ignore */
      }
      try {
        let pm = performance && performance.memory;
        if (pm) {
          let used = (pm.usedJSHeapSize / 1048576).toFixed(1);
          let total = (pm.totalJSHeapSize / 1048576).toFixed(1);
          console.log(
            `MEMPROBE t=${probeCount} used=${used}MB total=${total}MB app_instances=${appInstances} alive=${aliveInstances} destroying=${destroyingInstances} destroyed=${destroyedInstances}`,
          );
        }
      } catch (_) {
        /* ignore */
      }
    }
  });
}
