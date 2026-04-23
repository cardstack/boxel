import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateBxl, prepareBxl, type ReadableSchema } from '../../src/index.js';

const schema: ReadableSchema = {
  fields: [
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'taxRate', label: 'Tax Rate' },
    { key: 'shipping', label: 'Shipping' },
  ],
};

const expr = 'ROUND(Subtotal * "Tax Rate" / 100, 2) + Shipping';
const prepared = prepareBxl(expr, { schema });

deepStrictEqual(
  [...prepared.deps].sort(),
  ['shipping', 'subtotal', 'taxRate'],
  'prepared deps should include all direct root inputs',
);

const inputs = [
  { subtotal: 50, taxRate: 8.25, shipping: 4.5 },
  { subtotal: 80, taxRate: 9.5, shipping: 12 },
];

for (const input of inputs) {
  const preparedResult = prepared.evaluate(input);
  const directResult = evaluateBxl(expr, input, { schema });

  strictEqual(
    JSON.stringify(preparedResult.value),
    JSON.stringify(directResult.value),
    'prepared evaluation should match direct evaluation',
  );
  strictEqual(
    preparedResult.compiledSource,
    directResult.compiledSource,
    'prepared evaluation should preserve canonical jq source',
  );
}

const limited = prepared.evaluate(inputs[0], {
  runtimeLimits: { maxOutputs: 2, maxMillis: 500 },
});
strictEqual(
  Number((limited.value as number).toFixed(2)),
  8.63,
  'prepared evaluation should accept per-run runtime limits',
);

console.log('Prepared BXL smoke passed');
