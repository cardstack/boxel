// Boxel-flavored expression-factory suite.
//
// Validates `expression`, `expr`, `bxl`, `jq`, and `fx` — the public
// surface that .gts files use inside `computeVia`. Maps to
// docs/internals/port-from-jqxl.md §10, §11, §11a.
//
//   §10  — `jq` tagged template preserves backslashes (sidesteps the
//          JS escape gotcha for `\(...)` interpolation).
//   §11  — `bxl()` defaults `readableSyntax: false` for jq-tagged
//          sources, true otherwise.
//   §11a — tag dispatch (`jq` / `fx` / plain string), `as`
//          materialization, and Excel-error tolerance.

import { ok, strictEqual } from 'node:assert';
import {
  beginBxlComputeCycle,
  bxl,
  expr,
  expression,
  fx,
  jq,
} from '../../src/index.js';
import { baselinePatient, fuzzEmptyVitals } from './fixtures/hospital.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (error) {
    fail++;
    failures.push(`  ${name}\n    ${(error as Error).message.split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------- §10

check('§10 jq`…` preserves backslashes for jq interpolation', () => {
  const tagged = jq`"\(.firstName)/\(.lastName)"`;
  ok(typeof tagged === 'object', 'jq returns a tagged source object');
  ok(
    tagged.source.includes('\\('),
    'backslash before `(` survives the tag — the JS escape gotcha is gone',
  );
});

check('§10 jq`…`.call(card) interpolates fields', () => {
  const compute = expression(jq`"\(.firstName)/\(.lastName)"`);
  strictEqual(compute.call(baselinePatient), 'Margaret/Okonkwo');
});

// ---------------------------------------------------------------- §11

check('§11 plain-string defaults to readable syntax', () => {
  // Bare PascalCase `Severity` only resolves via the readable-syntax
  // compiler's no-schema fallback. If `readableSyntax` had defaulted
  // to false, this would have been parsed as raw jq and missed the
  // field entirely.
  const compute = expression('Severity == "Moderate"');
  strictEqual(compute.call(baselinePatient), true);
});

check('§11 jq tag defaults to raw jq (readable syntax off)', () => {
  // `.severity` with a leading dot is the only valid form in raw jq.
  // PascalCase `Severity` would fail under the jq parser.
  const compute = expression(jq`.severity`);
  strictEqual(compute.call(baselinePatient), 'Moderate');
});

check('§11 explicit { readableSyntax: false } overrides the default', () => {
  const compute = expression('.severity', { readableSyntax: false });
  strictEqual(compute.call(baselinePatient), 'Moderate');
});

check('§11 expression is an alias of bxl', () => {
  strictEqual(expression, bxl);
  strictEqual(expr, bxl);
});

check('§11 expression exposes prepared metadata for invalidation', () => {
  const compute = expression(fx`FirstName & " " & LastName`);
  strictEqual(compute.bxl.source, 'FirstName & " " & LastName');
  ok(compute.bxl.compiledSource.includes('.firstName'));
  ok(compute.bxl.deps.includes('firstName'));
  ok(compute.bxl.deps.includes('lastName'));
  strictEqual(compute.bxl.memoize, 'microtask');
});

check('§11 expression memoizes repeated reads in one compute cycle', () => {
  let reads = 0;
  const card = {
    get firstName() {
      reads++;
      return 'Margo';
    },
    lastName: 'Okonkwo',
  };
  const compute = expression(fx`FirstName & " " & LastName`);
  strictEqual(compute.call(card), 'Margo Okonkwo');
  strictEqual(compute.call(card), 'Margo Okonkwo');
  strictEqual(reads, 1);
});

check('§11 beginBxlComputeCycle invalidates expression memoization', () => {
  const card = { firstName: 'Margo', lastName: 'Okonkwo' };
  const compute = expression(fx`FirstName & " " & LastName`);
  strictEqual(compute.call(card), 'Margo Okonkwo');
  card.firstName = 'Margaret';
  beginBxlComputeCycle();
  strictEqual(compute.call(card), 'Margaret Okonkwo');
});

check('§11 expression memoization can be disabled', () => {
  let reads = 0;
  const card = {
    get severity() {
      reads++;
      return 'Moderate';
    },
  };
  const compute = expression('Severity', { memoize: false });
  strictEqual(compute.call(card), 'Moderate');
  strictEqual(compute.call(card), 'Moderate');
  strictEqual(reads, 2);
  strictEqual(compute.bxl.memoize, false);
});

check('§11 expression factory enforces derive profile at construction', () => {
  let message = '';
  try {
    expression(jq`now`);
  } catch (error) {
    message = (error as Error).message;
  }
  ok(message.includes('computeVia expression violates the derive profile'));
  ok(message.includes('derive-call-banned'));
  ok(message.includes('now'));
});

check('§11 expression factory rejects raw jq error()', () => {
  let message = '';
  try {
    expression(jq`error("not a computed field")`);
  } catch (error) {
    message = (error as Error).message;
  }
  ok(message.includes('derive-call-banned'));
  ok(message.includes('error'));
});

// ---------------------------------------------------------------- §11a

check('§11a fx`…` enables readable BXL (Excel-style)', () => {
  const compute = expression(fx`ROUND(BpSystolic / BpDiastolic, 2)`);
  // 138/88 = 1.5681… → ROUND(2) = 1.57.
  strictEqual(compute.call(baselinePatient.vitals), 1.57);
});

check('§11a Excel #N/A from IFS with no match returns null (not a crash)', () => {
  // The realm pattern: a guarded IFS that misses every branch used to
  // throw `#N/A` from the indexer. `bxl()` now catches Excel sentinels
  // at the boundary and surfaces null so a StringField/NumberField
  // gets a clean empty value.
  const compute = expression(
    fx`IFS(BpSystolic >= 200, "crisis", BpSystolic >= 180, "stage2")`,
  );
  strictEqual(compute.call({ bpSystolic: 90 }), null);
});

check('§11a `as: Cls` materializes a plain object as an instance', () => {
  // No Boxel runtime here — `getFields` is unavailable so the factory
  // falls back to `new Cls(); Object.assign(instance, raw)`. That's
  // the contract for non-realm consumers (Node tools, tests).
  class StatusPanel {
    label: string = '';
    tone: string = '';
  }
  const compute = expression(
    jq`{ label: "Stable", tone: "blue" }`,
    { as: StatusPanel },
  );
  const out = compute.call(baselinePatient) as StatusPanel;
  ok(out instanceof StatusPanel, 'output is an instance of the shape class');
  strictEqual(out.label, 'Stable');
  strictEqual(out.tone, 'blue');
});

check('§11a `as: Cls` over an array materializes each entry', () => {
  class MedSummary {
    name: string = '';
    doseMg: number = 0;
  }
  const compute = expression(
    jq`[.medications[] | { name: .name, doseMg: .doseMg }]`,
    { as: MedSummary },
  );
  const out = compute.call(baselinePatient) as MedSummary[];
  ok(Array.isArray(out));
  strictEqual(out.length, 2);
  ok(out.every((entry) => entry instanceof MedSummary));
  strictEqual(out[0].name, 'Metoprolol');
  strictEqual(out[1].doseMg, 5);
});

check('§11a `as: Cls` returns null for null input (no instance)', () => {
  class StatusPanel {
    label: string = '';
  }
  const compute = expression(jq`null`, { as: StatusPanel });
  strictEqual(compute.call(baselinePatient), null);
});

check('§11a empty-vitals computeVia returns null, not undefined', () => {
  // The factory normalizes empty jq output to null so a Boxel
  // NumberField doesn't render `undefined`.
  const compute = expression(jq`.vitals.bpSystolic / .vitals.bpDiastolic`);
  strictEqual(compute.call(fuzzEmptyVitals), null);
});

// ----------------------------------------------------------------

console.log(`BXL Boxel expression factory: ${pass}/${pass + fail} cases passed`);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
