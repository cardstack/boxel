import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  evaluateBxl,
  runNativeJq,
  type ReadableSchema,
} from '../../src/index.js';

const nativeEmptyCases = [
  'ROUND(empty; 2)',
  'SUM(empty)',
  'MAX(empty)',
  'ABS(empty)',
  'UPPER(empty)',
  'COUNTIF(empty; "x")',
];

for (const expression of nativeEmptyCases) {
  const result = runNativeJq(expression, {});
  deepStrictEqual(
    result.outputs,
    [],
    `${expression} should propagate empty instead of crashing`,
  );
}

deepStrictEqual(
  runNativeJq('.x - empty', { x: 10 }).outputs,
  [],
  'pure jq arithmetic should still propagate empty',
);

deepStrictEqual(
  runNativeJq('IF(empty; 1; 0)', {}).outputs,
  [],
  'jq-defined IF helper should continue to propagate empty',
);

deepStrictEqual(
  runNativeJq('IFERROR(empty; 0)', {}).outputs,
  [],
  'jq-defined IFERROR helper should continue to propagate empty',
);

const paymentSchema: ReadableSchema = {
  fields: [
    { key: 'total', label: 'Total' },
    {
      key: 'payments',
      label: 'Payment',
      kind: 'array',
      item: {
        fields: [
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount' },
        ],
      },
    },
  ],
};

const noCapturedPayment = {
  total: 89.04,
  payments: [
    { status: 'pending', amount: 10 },
    { status: 'failed', amount: 5 },
  ],
};

const roundedBalance = evaluateBxl(
  'ROUND(Total - Payment[Status = "captured"].Amount, 2)',
  noCapturedPayment,
  { schema: paymentSchema },
);

deepStrictEqual(
  roundedBalance.outputs,
  [],
  'missing first-match value should propagate empty through ROUND',
);
strictEqual(
  roundedBalance.value,
  null,
  'evaluateBxl should normalize empty outputs to null',
);

console.log('Native filters propagate empty args without crashing');
