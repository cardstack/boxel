import { deepStrictEqual } from 'node:assert';
import { evaluateBxl, runNativeJq } from '../../src/index.js';

const input = {
  total: 89.04,
  payments: [
    { status: 'pending', amount: 10 },
    { status: 'captured', amount: 30 },
  ],
};

const firstResult = runNativeJq(
  'first(.payments[] | select(.status == "captured")).amount',
  input,
);

deepStrictEqual(firstResult.outputs, [30]);

const roundedResult = runNativeJq(
  'ROUND(.total - first(.payments[] | select(.status == "captured")).amount; 2)',
  input,
);

deepStrictEqual(roundedResult.outputs, [59.04]);

const evalCompiledResult = evaluateBxl(
  'ROUND(.total - first(.payments[] | select(.status == "captured")).amount; 2)',
  input,
);

deepStrictEqual(evalCompiledResult.value, 59.04);

console.log('first(filter()).field jq chain works');
