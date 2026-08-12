import { ok, strictEqual } from 'node:assert';
import {
  evaluateBxl,
  getBoxelValue,
  prepareBoxelRuntimeAsync,
  runNativeJqAsync,
  type BoxelRuntimeDefinition,
} from '../../src/index.js';

function approx(actual: unknown, expected: number, tolerance = 1e-6) {
  ok(typeof actual === 'number', `expected number, got ${typeof actual}`);
  ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

let syncFailed = false;
try {
  evaluateBxl('BESSELI(1.5, 1)', {});
} catch (error) {
  syncFailed = String((error as Error).message).includes('BESSELI/2');
}
ok(syncFailed, 'sync evaluation should not load the bessel extension');

const direct = await runNativeJqAsync('BESSELI(1.5, 1)', {});
approx(direct.outputs[0], 0.981666);
strictEqual(direct.compiledSource, 'BESSELI(1.5; 1)');

const explicitLibrary = await runNativeJqAsync('1 + 1', {}, {
  libraries: ['core', 'formula-bessel'],
});
strictEqual(explicitLibrary.outputs[0], 2);

const definition: BoxelRuntimeDefinition = {
  guide: {
    fieldGuides: [
      {
        fieldPath: '.besselScore',
        computedVia: 'BESSELJ(1.9, 2)',
      },
    ],
  },
};

const prepared = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'lazy-bessel-formulas-smoke',
  worker: false,
});
const result = await prepared.evaluate({});

approx(getBoxelValue(result.state, '.besselScore'), 0.329926);

console.log('BXL lazy bessel formulas: async extension loaded on demand');
