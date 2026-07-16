import { isDestroyed, isDestroying } from '@ember/destroyable';
import { getApplication } from '@ember/test-helpers';
import * as TestWaiters from '@ember/test-waiters';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { useTestWaiters } from '@cardstack/runtime-common';

export function setupQUnit() {
  // ResizeObserver fires this when a callback causes a layout change that
  // would trigger another notification in the same frame. The browser
  // defers the second notification safely; the error itself is benign but
  // QUnit picks it up via window.onerror and reports it as a global failure.
  // We wrap window.onerror (rather than addEventListener) because window.onerror
  // fires first; returning true suppresses the error before QUnit sees it.
  const _originalOnError = window.onerror;
  window.onerror = (message, ...args) => {
    if (
      message ===
      'ResizeObserver loop completed with undelivered notifications.'
    ) {
      return true;
    }
    return _originalOnError ? _originalOnError(message, ...args) : false;
  };

  QUnit.dump.maxDepth = 20;
  useTestWaiters(TestWaiters);
  setup(QUnit.assert);
  QUnit.config.autostart = false;

  // Post-suite teardown diagnostics.
  //
  // A shard intermittently fails with a synthetic `not ok N - error /
  // Browser timeout exceeded: 60s` attributed to whichever test ran last.
  // That error is emitted by testem when the browser's socket disconnects
  // before the suite reports done: testem waits `browser_disconnect_timeout`
  // (60s) for a reconnect, gets none, and reports the browser dead. Every
  // real test in these runs passes — the failure lives entirely in the
  // window between the last test finishing and the browser reporting the
  // suite complete, so the ordinary TAP output tells us nothing about it.
  //
  // These markers narrow that window on the next failure:
  //   - HOST_SUITE_DONE present but testem still times out  → the browser
  //     finished; the socket/handshake dropped (environment-level).
  //   - HOST_SUITE_DONE absent, HOST_TEARDOWN_BEFORE_SUITE_DONE present →
  //     the page tore down (navigation/close) before finishing, with the
  //     last test name + pending-waiter state naming what was still busy.
  //   - both absent → the browser process died outright (crash / OS OOM
  //     kill) before any teardown JS could run.
  let suiteDoneFired = false;
  let lastTestName = '(none)';
  let lastTestEndedAt = null;
  function pendingWaiterSummary() {
    try {
      if (!TestWaiters.hasPendingWaiters || !TestWaiters.hasPendingWaiters()) {
        return 'none';
      }
      let state = TestWaiters.getPendingWaiterState();
      let names = state && state.waiters ? Object.keys(state.waiters) : [];
      return names.length ? names.join(',') : 'unknown';
    } catch (_) {
      return 'unavailable';
    }
  }
  QUnit.testDone((details) => {
    lastTestName = `${details.module} > ${details.name}`;
    try {
      lastTestEndedAt = performance ? performance.now() : null;
    } catch (_) {
      lastTestEndedAt = null;
    }
  });
  QUnit.done((details) => {
    suiteDoneFired = true;
    try {
      console.log(
        `HOST_SUITE_DONE total=${details.total} passed=${details.passed} failed=${details.failed} runtime=${details.runtime}ms pendingWaiters=${pendingWaiterSummary()}`,
      );
    } catch (_) {
      /* ignore */
    }
  });
  let logTeardownBeforeDone = (reason) => {
    if (suiteDoneFired) return;
    suiteDoneFired = true; // fire once across pagehide/beforeunload
    try {
      let sinceLastTest =
        lastTestEndedAt != null && performance
          ? `${Math.round(performance.now() - lastTestEndedAt)}ms`
          : 'na';
      console.log(
        `HOST_TEARDOWN_BEFORE_SUITE_DONE reason=${reason} lastTest=${JSON.stringify(lastTestName)} sinceLastTest=${sinceLastTest} pendingWaiters=${pendingWaiterSummary()}`,
      );
    } catch (_) {
      /* ignore */
    }
  };
  window.addEventListener('pagehide', () => logTeardownBeforeDone('pagehide'));
  window.addEventListener('beforeunload', () =>
    logTeardownBeforeDone('beforeunload'),
  );

  // Per-module memory delta probe — log each test file's contribution to
  // retained memory, independent of where it falls in shard order. We GC
  // at module boundaries so the start/end snapshots compare like-for-like.
  //
  // We run several gc() cycles with a microtask yield between each call so
  // V8 can drain its FinalizationRegistry queue and finish generational
  // sweeps between passes. Without the yield, finalizers are deferred until
  // the next microtask checkpoint, so repeated synchronous gc() calls don't
  // actually settle — prior-module garbage can reclaim mid-way through our
  // window and produce negative "deltas" that aren't real.
  //
  // Uses QUnit.moduleStart/moduleDone (not QUnit.on('suiteStart')) because
  // only the logging-callback API awaits async handlers. Nested modules
  // are tracked with a simple depth counter so we only probe top-level ones.
  let usedAtModuleStart = null;
  let moduleDepth = 0;
  async function settledGc() {
    if (typeof globalThis.gc !== 'function') return;
    for (let i = 0; i < 3; i++) {
      globalThis.gc();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  QUnit.moduleStart(async () => {
    moduleDepth++;
    if (moduleDepth !== 1) return;
    await settledGc();
    try {
      let pm = performance && performance.memory;
      usedAtModuleStart = pm ? pm.usedJSHeapSize : null;
    } catch (_) {
      usedAtModuleStart = null;
    }
  });
  QUnit.moduleDone(async (details) => {
    if (moduleDepth === 1) {
      await settledGc();
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
    }
    moduleDepth--;
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
