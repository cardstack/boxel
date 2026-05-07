// Runnable insurance example. Evaluates each expression against
// `policy.json` and prints results. No Boxel runtime — just BXL
// against plain JS data.
//
// Usage:
//   node scripts/run-ts-entry.mjs examples/insurance/run.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expression } from '../../src/index.js';
import { insuranceExpressions } from './expressions.js';

const here = dirname(fileURLToPath(import.meta.url));
const policy: unknown = JSON.parse(
  readFileSync(join(here, 'policy.json'), 'utf8'),
);

console.log(`Policy: ${(policy as { policyId: string }).policyId} ` +
            `(${(policy as { productLine: string }).productLine})`);
console.log('');

let pass = 0;
let fail = 0;

for (const ex of insuranceExpressions) {
  const compute = expression(ex.source as never);
  const actual = compute.call(policy as object);

  const ok = JSON.stringify(actual) === JSON.stringify(ex.expected);
  if (ok) {
    pass++;
    console.log(`OK   ${ex.name.padEnd(24)} → ${JSON.stringify(actual)}`);
    console.log(`     ${ex.illustrates}`);
  } else {
    fail++;
    console.log(`FAIL ${ex.name.padEnd(24)} → ${JSON.stringify(actual)}`);
    console.log(`     expected ${JSON.stringify(ex.expected)}`);
    console.log(`     ${ex.illustrates}`);
  }
}

console.log('');
console.log(`${pass}/${pass + fail} expressions evaluated successfully`);

process.exit(fail);
