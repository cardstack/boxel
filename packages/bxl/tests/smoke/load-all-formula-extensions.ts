// `loadAllFormulaExtensions` is the hook a host calls before serving this
// module to card authors: it loads every lazy formula chunk and folds it
// into DEFAULT_BUILTIN_LIBRARIES, so the synchronous `expression()` factory
// — which cannot await a chunk mid-compute — sees the full formula surface.

import { ok, strictEqual } from 'node:assert';
import {
  evaluateBxl,
  expression,
  fx,
  loadAllFormulaExtensions,
} from '../../src/index.ts';

// Synchronous evaluation does not auto-load lazy chunks; a lazy-family
// function is unavailable until the host opts in.
let syncFailed = false;
try {
  evaluateBxl('ERF(0.5)', {});
} catch (error) {
  syncFailed = String((error as Error).message).includes('ERF/1');
}
ok(syncFailed, 'lazy engineering family is absent before the load');

await loadAllFormulaExtensions();

function approx(actual: unknown, expected: number, tolerance = 1e-4) {
  ok(typeof actual === 'number', `expected number, got ${typeof actual}`);
  ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

// One function from each lazy family, all through the synchronous factory.
approx(expression(fx`ERF(0.5)`).call({}), 0.5205); // engineering
approx(expression(fx`ABS(PMT(0.005, 12, -12000))`).call({}), 1032.7972, 1e-3); // financial
approx(expression(fx`BESSELI(1.5, 1)`).call({}), 0.981666); // bessel
approx(expression(fx`NORM.S.DIST(1, TRUE)`).call({}), 0.841345); // statistical

// Idempotent: a second call must not double-register or throw.
await loadAllFormulaExtensions();
strictEqual(expression(fx`ERF(0.5)`).call({}) === null, false);

console.log('BXL load-all formula extensions: 6/6 cases passed');
