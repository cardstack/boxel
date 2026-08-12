import { deepStrictEqual, ok } from 'node:assert';
import {
  realmFormulaBundles,
  runFormulaBundle,
} from '../../src/examples/index.js';

const failures: string[] = [];

for (const bundle of realmFormulaBundles) {
  const run = await runFormulaBundle(bundle);

  for (const result of run.results) {
    try {
      deepStrictEqual(
        result.value,
        result.step.expected,
        `${bundle.id}/${result.step.id}`,
      );
    } catch (error) {
      failures.push(
        `${bundle.id}/${result.step.id}: ${(error as Error).message}`,
      );
    }
  }
}

const allExpressions = realmFormulaBundles
  .flatMap((bundle) => bundle.steps.map((step) => step.expression))
  .join('\n');

ok(allExpressions.includes('BESSELJ'), 'bundle should cover lazy Bessel formulas');
ok(allExpressions.includes('PMT('), 'bundle should cover lazy financial formulas');
ok(allExpressions.includes('NPV('), 'bundle should cover financial aggregates');
ok(
  allExpressions.includes('LOGNORM.INV'),
  'bundle should cover dotted statistical FormulaJS names',
);
ok(
  allExpressions.includes('T.INV.2T'),
  'bundle should cover statistical distribution helpers',
);
ok(allExpressions.includes('ERF('), 'bundle should cover engineering extras');

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  throw new Error(
    `Realm formula bundle examples failed: ${failures.length} mismatch(es)`,
  );
}

const stepCount = realmFormulaBundles.reduce(
  (sum, bundle) => sum + bundle.steps.length,
  0,
);

console.log(
  `BXL realm formula bundles: ${realmFormulaBundles.length} bundles, ${stepCount} steps passed`,
);
