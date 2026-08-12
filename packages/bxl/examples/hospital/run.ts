// Runnable hospital example: evaluates each expression in
// `expressions.ts` against `patient.json` and prints the result. No
// Boxel runtime — just BXL evaluating against plain JS data.
//
// Usage:
//   node scripts/run-ts-entry.mjs examples/hospital/run.ts
//
// Or, if you've installed @cardstack/bxl globally / locally and prefer
// the published surface:
//   tsx examples/hospital/run.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expression, evaluateBxl } from '../../src/index.js';
import { hospitalExpressions } from './expressions.js';
import { hospitalSchema } from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const patient: unknown = JSON.parse(
  readFileSync(join(here, 'patient.json'), 'utf8'),
);

console.log(`Patient: ${(patient as { firstName: string }).firstName} ` +
            `${(patient as { lastName: string }).lastName}`);
console.log('');

let pass = 0;
let fail = 0;

for (const ex of hospitalExpressions) {
  // Two equivalent ways to evaluate. Realms use `expression(...)` /
  // `bxl(...)` because the factory binds `this` and adds the
  // Excel-error catch + materialize behaviors. Tools and CLIs that
  // already have the input in hand can call `evaluateBxl(...)` more
  // directly.
  //
  // We use the factory here so the example matches what a .gts file
  // would write — `compute.call(patient)` instead of
  // `evaluateBxl(source, patient)`.
  const compute = expression(ex.source as never, { schema: hospitalSchema });
  const actual = compute.call(patient as object);

  const ok = JSON.stringify(actual) === JSON.stringify(ex.expected);
  if (ok) {
    pass++;
    console.log(`OK   ${ex.name.padEnd(22)} → ${JSON.stringify(actual)}`);
    console.log(`     ${ex.illustrates}`);
  } else {
    fail++;
    console.log(`FAIL ${ex.name.padEnd(22)} → ${JSON.stringify(actual)}`);
    console.log(`     expected ${JSON.stringify(ex.expected)}`);
    console.log(`     ${ex.illustrates}`);
  }
}

console.log('');
console.log(`${pass}/${pass + fail} expressions evaluated successfully`);

// Sanity check: evaluateBxl works equivalently for a plain-string
// source. Realms don't usually call it directly, but tooling does.
const direct = evaluateBxl('Severity', patient, { schema: hospitalSchema });
if (direct.value !== 'Moderate') {
  console.log(`evaluateBxl smoke check failed: got ${JSON.stringify(direct.value)}`);
  fail++;
}

process.exit(fail);
