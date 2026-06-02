import { isDestroyed, isDestroying } from '@ember/destroyable';
import { getApplication } from '@ember/test-helpers';
import * as TestWaiters from '@ember/test-waiters';

import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import {
  registeredCardReferencePrefixes,
  useTestWaiters,
} from '@cardstack/runtime-common';

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
  // The permanent base-realm prefix mappings (@cardstack/base/, etc.) are
  // registered during boot/warmup and are expected for the whole suite.
  // Captured after the first top-level module so the leak guard below only
  // flags prefixes a test module added and failed to clean up.
  let baselineCardReferencePrefixes = null;
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
    // Diagnostic: a card-reference prefix mapping a test module added but
    // didn't clean up leaks into the global registry and corrupts later
    // modules — `unresolveCardReference` rewrites their indexed/resolved
    // URLs into the prefix form. The first top-level module establishes the
    // permanent baseline (base-realm prefixes); after that, name any module
    // that leaves an extra prefix so the next such failure is
    // self-explanatory instead of an opaque deepEqual diff.
    if (moduleDepth === 1) {
      let current = registeredCardReferencePrefixes();
      if (baselineCardReferencePrefixes === null) {
        baselineCardReferencePrefixes = new Set(current);
      } else {
        let leaked = current.filter(
          (p) => !baselineCardReferencePrefixes.has(p),
        );
        if (leaked.length > 0) {
          console.warn(
            `LEAKED_CARD_REFERENCE_PREFIXES module=${JSON.stringify(
              details.name,
            )} prefixes=${JSON.stringify(leaked)} — register/unregister must ` +
              `be symmetric (clean up addRealmMapping in an afterEach), or ` +
              `these mappings will unresolve URLs in sibling test modules.`,
          );
        }
      }
    }
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
