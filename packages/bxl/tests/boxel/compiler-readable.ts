// Boxel-flavored readable-syntax compiler suite (M2).
//
// Validates the compiler additions the realm depends on, organized
// per port-doc section. Asserts both the canonical jq the compiler
// produces AND that evaluation against fixture data lines up — so a
// regression in either the rewrite logic or the runtime gets caught.
//
// Section mapping:
//   §12  — PascalCase → camelCase fallback (no-schema mode)
//   §13  — JQ_KEYWORDS guard for the function-call branch
//   §16  — mixed-syntax (PascalCase head + jq nested, vice versa)

import { strictEqual } from 'node:assert';
import { compileBxl, evaluateBxl } from '../../src/index.js';
import {
  baselinePatient,
  fuzzShellRecord,
  highSeverityPatient,
} from './fixtures/hospital.js';

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

// Convenience: returns the canonical jq the readable-syntax compiler
// produced for `src`, with no schema.
function compiledNoSchema(src: string): string {
  return compileBxl(src).source;
}

// ---------------------------------------------------------------- §12

check('§12 single PascalCase ident → camelCase path', () => {
  strictEqual(compiledNoSchema('Severity'), '.severity');
});

check('§12 multi-letter PascalCase ident → camelCase path', () => {
  strictEqual(compiledNoSchema('BpSystolic'), '.bpSystolic');
});

check('§12 PascalCase with digits stays PascalCase-friendly', () => {
  strictEqual(compiledNoSchema('Field42Name'), '.field42Name');
});

check('§12 lowercase ident is left alone', () => {
  // No fallback fires because the source isn't PascalCase. The
  // compiler returns the source verbatim.
  strictEqual(compiledNoSchema('severity'), 'severity');
});

check('§12 ALL-UPPERCASE ident is left as a function/operator', () => {
  // `AND`, `OR`, `XOR`, `NOT`, `ID`, `URL` should NOT be camelCased.
  // The compiler's path parser bails because the ALL-CAPS guard kicks in,
  // and the token survives as-is.
  strictEqual(
    compiledNoSchema('Severity AND IsCritical'),
    '.severity and .isCritical',
  );
});

check('§12 quoted string literal stays a string (not camelCased)', () => {
  // Realm regression: `Category = "Hardware"` used to compile to
  // `.category == .hardware` because the fallback fired on the RHS.
  // The token-type guard now skips quoted strings.
  strictEqual(
    compiledNoSchema('Severity == "High"'),
    '.severity == "High"',
  );
});

check('§12 fallback resolves bare ident in a comparison', () => {
  const src = 'Severity == "High"';
  strictEqual(evaluateBxl(src, baselinePatient).value, false);
  strictEqual(evaluateBxl(src, highSeverityPatient).value, true);
});

check('§12 fallback resolves nested PascalCase path', () => {
  const result = evaluateBxl('Vitals.BpSystolic', baselinePatient);
  strictEqual(result.value, 138);
});

check('§12 fallback handles deeply-nested path', () => {
  // The compiler walks dotted continuations with the same fallback
  // gate as the head segment.
  const result = evaluateBxl(
    '{ first: FirstName, sys: Vitals.BpSystolic }',
    baselinePatient,
  );
  strictEqual(JSON.stringify(result.value), '{"first":"Margaret","sys":138}');
});

check('§12 schema present → no fallback for unknown labels', () => {
  // With a schema, the user's labels are validated against it.
  // Unrecognized PascalCase tokens stay verbatim — important for
  // context-variable paths like @User.Departments.
  const compiled = compileBxl('Department IN @User.Departments', {
    schema: {
      fields: [{ key: 'department', label: 'Department' }],
    },
  });
  // The IN function compiles, but @User.Departments must NOT have
  // been silently mangled to @User.departments.
  strictEqual(compiled.source.includes('@User.Departments'), true);
});

check('§12 PascalCase ident with no payload returns null', () => {
  // Shell record: `.severity` on an object that has no `severity` key.
  // jq returns null; the BXL surface normalizes that.
  strictEqual(evaluateBxl('Severity', fuzzShellRecord).value, null);
});

// ---------------------------------------------------------------- §13

check('§13 lowercase if/then/else passes through (no IF dispatch)', () => {
  const src = 'if (.x // 0) == 0 then "zero" else "nonzero" end';
  const compiled = compiledNoSchema(src);
  // No "IF(" in the output — the keyword guard prevented the
  // function-call branch from firing.
  strictEqual(/\bIF\s*\(/.test(compiled), false);
  strictEqual(evaluateBxl(src, { x: 0 }).value, 'zero');
  strictEqual(evaluateBxl(src, { x: 5 }).value, 'nonzero');
});

check('§13 uppercase IF still dispatches to Excel formula', () => {
  // Case-sensitive guard: `IF` is the spreadsheet function, only
  // lowercase `if` is the jq keyword.
  const src = 'IF(Severity == "High", "alert", "ok")';
  strictEqual(evaluateBxl(src, baselinePatient).value, 'ok');
  strictEqual(evaluateBxl(src, highSeverityPatient).value, 'alert');
});

check('§13 plain-string if/elif/else/end with PascalCase', () => {
  // Realm pattern: probeAdmissionState. PascalCase fallback +
  // JQ_KEYWORDS guard cooperate so the user can write idiomatic jq
  // control flow without a tag.
  const src =
    'if .dischargeDate then "discharged" elif .admissionDate then "admitted" else "pending" end';
  strictEqual(evaluateBxl(src, baselinePatient).value, 'discharged');
});

check('§13 fuzzy-input mixed-case keyword (`If`/`Then`/`End`)', () => {
  // BXL accepts mixed-case for jq control keywords. The PascalCase
  // fallback's KEYWORDS exclusion is what keeps `If` from being
  // hijacked as a path step `.if`.
  const src = 'If Severity == "High" Then "alert" Else "ok" End';
  strictEqual(evaluateBxl(src, baselinePatient).value, 'ok');
  strictEqual(evaluateBxl(src, highSeverityPatient).value, 'alert');
});

check('§13 IF(empty; 1; 0) compiles to jq if-then-else', () => {
  // Excel IF with semicolon-separated args. Compiles to jq's
  // if-then-else helper. Doesn't rely on the JQ_KEYWORDS guard
  // (uppercase IF), but documents the case-sensitivity contract.
  strictEqual(evaluateBxl('IF(empty; 1; 0)', {}).outputs.length, 0);
});

// ---------------------------------------------------------------- §16

check('§16 PascalCase head + jq lowercase nested path', () => {
  // `Vitals.bpSystolic` — head resolved by fallback (`Vitals` →
  // `vitals`), nested path stays as the user wrote it.
  const compiled = compiledNoSchema('Vitals.bpSystolic');
  strictEqual(compiled, '.vitals.bpSystolic');
  strictEqual(evaluateBxl('Vitals.bpSystolic', baselinePatient).value, 138);
});

check('§16 jq lowercase head + PascalCase nested', () => {
  // `.vitals.BpSystolic` — head verbatim, nested resolved by fallback.
  const compiled = compiledNoSchema('.vitals.BpSystolic');
  strictEqual(compiled, '.vitals.bpSystolic');
  strictEqual(evaluateBxl('.vitals.BpSystolic', baselinePatient).value, 138);
});

check('§16 mixed inside an Excel function', () => {
  // ROUND wraps a PascalCase + jq mixed-syntax sub-expression.
  const result = evaluateBxl(
    'ROUND(Vitals.BpSystolic / .vitals.bpDiastolic, 2)',
    baselinePatient,
  );
  strictEqual(result.value, 1.57);
});

check('§16 mixed inside an object constructor', () => {
  const result = evaluateBxl(
    '{ id: PatientId, sys: .vitals.bpSystolic, severity: Severity }',
    baselinePatient,
  );
  strictEqual(
    JSON.stringify(result.value),
    '{"id":"PT-1001","sys":138,"severity":"Moderate"}',
  );
});

// ---------------------------------------------------------------- §11

check('§11 explicit { readableSyntax: false } skips compilation', () => {
  // PascalCase fallback should NOT fire — `Severity` is a bare
  // identifier in pure jq, which the parser rejects.
  let threw = false;
  try {
    evaluateBxl('Severity', baselinePatient, { readableSyntax: false });
  } catch {
    threw = true;
  }
  strictEqual(threw, true);
});

check('§11 explicit { readableSyntax: false } accepts pure jq', () => {
  const result = evaluateBxl('.severity', baselinePatient, {
    readableSyntax: false,
  });
  strictEqual(result.value, 'Moderate');
});

// ----------------------------------------------------------------

console.log(
  `BXL Boxel readable-syntax compiler: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
