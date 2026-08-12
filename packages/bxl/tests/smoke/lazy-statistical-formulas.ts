import { ok, strictEqual } from 'node:assert';
import {
  evaluateBxl,
  getBoxelValue,
  prepareBoxelRuntimeAsync,
  runNativeJqAsync,
  type BoxelRuntimeDefinition,
} from '../../src/index.js';

function approx(actual: unknown, expected: number, tolerance = 1e-12) {
  ok(typeof actual === 'number', `expected number, got ${typeof actual}`);
  ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} +/- ${tolerance}, got ${actual}`,
  );
}

let syncFailed = false;
try {
  evaluateBxl('NORM.DIST(42, 40, 1.5, true)', {});
} catch (error) {
  syncFailed = String((error as Error).message).includes('NORM_DIST/4');
}
ok(syncFailed, 'sync evaluation should not load the statistical extension');

const direct = await runNativeJqAsync('NORM.DIST(42, 40, 1.5, true)', {});
approx(direct.outputs[0], 0.9087887802741321);
strictEqual(
  direct.compiledSource,
  'NORM_DIST(42; 40; 1.5; true)',
  'readable syntax should rewrite dotted FormulaJS names to BXL identifiers',
);

const explicitLibrary = await runNativeJqAsync('1 + 1', {}, {
  libraries: ['core', 'formula-statistical'],
});
strictEqual(explicitLibrary.outputs[0], 2);

const definition: BoxelRuntimeDefinition = {
  guide: {
    fieldGuides: [
      {
        fieldPath: '.normalScore',
        computedVia: 'NORM.DIST(42, 40, 1.5, true)',
      },
      {
        fieldPath: '.betaScore',
        computedVia: 'BETA.DIST(2, 8, 10, true, 1, 3)',
      },
    ],
  },
};

const prepared = await prepareBoxelRuntimeAsync(definition, {
  cacheKey: 'lazy-statistical-formulas-smoke',
  worker: false,
});
const result = await prepared.evaluate({});

approx(getBoxelValue(result.state, '.normalScore'), 0.9087887802741321);
approx(getBoxelValue(result.state, '.betaScore'), 0.6854705810117458);

console.log('BXL lazy statistical formulas: async extension loaded on demand');
