// Boxel-flavored probe-field regression suite (M4).
//
// Each gigantic-crawdad probe field gets a corresponding compile +
// evaluate assertion here. When a probe field stops rendering in
// the realm, the failure should reproduce in this suite — and the
// fix lands here first, in BXL CI.
//
// The probe fields are deliberately designed to exercise specific
// quirks documented in the port doc:
//   probeRiskFlag           — cascading-computed reference, plain-string
//                             with jq if/else, PascalCase fallback (§12,
//                             §13)
//   probeAdmissionQuarter   — multi-line plain-string, PascalCase +
//                             jq if/elif/elif/else/end (§12, §13)
//   probeAdmissionState     — plain-string if/then/elif/else/end with
//                             raw-jq-style .admissionDate paths (§13)
//   probeFullNameWithId     — Excel `&` string-concat operator (§11)
//   probeRecentlyAdmitted   — date-string range comparison via fx (§11)

import { strictEqual } from 'node:assert';
import { evaluateBxl, expression, fx } from '../../src/index.js';
import {
  baselinePatient,
  dischargedPatient,
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

// ---------------------------------------------------------------- probeRiskFlag

check('probeRiskFlag: PascalCase ref to a sibling computed (high risk → flag)', () => {
  // Realm declares `fxIsHighRisk` first, then `probeRiskFlag` references
  // it via `FxIsHighRisk`. Here we simulate with the precomputed flag
  // baked into the input.
  const compute = expression(
    'if FxIsHighRisk then "⚠ HIGH RISK" else "" end',
  );
  strictEqual(compute.call({ fxIsHighRisk: true }), '⚠ HIGH RISK');
  strictEqual(compute.call({ fxIsHighRisk: false }), '');
});

check('probeRiskFlag: derives the underlying flag from severity (no precompute)', () => {
  // Inline the high-risk check + the dependent label in one expression
  // so the test is hermetic.
  const src =
    'if (Severity == "High" or Severity == "Critical") then "⚠ HIGH RISK" else "" end';
  strictEqual(evaluateBxl(src, baselinePatient).value, '');
  strictEqual(evaluateBxl(src, highSeverityPatient).value, '⚠ HIGH RISK');
});

// ---------------------------------------------------------------- probeAdmissionQuarter

check('probeAdmissionQuarter: multi-line PascalCase + if/elif/else/end', () => {
  const src = `
    if AdmissionDate >= "2024-12" then "Q4"
    elif AdmissionDate >= "2024-09" then "Q3"
    elif AdmissionDate >= "2024-06" then "Q2"
    elif AdmissionDate >= "2024-01" then "Q1"
    else "older"
    end
  `;
  strictEqual(evaluateBxl(src, { admissionDate: '2024-11-01' }).value, 'Q3');
  strictEqual(evaluateBxl(src, { admissionDate: '2024-12-15' }).value, 'Q4');
  strictEqual(evaluateBxl(src, { admissionDate: '2024-04-10' }).value, 'Q1');
  strictEqual(evaluateBxl(src, { admissionDate: '2023-08-22' }).value, 'older');
});

check('probeAdmissionQuarter: works against the baseline patient', () => {
  const src = `
    if AdmissionDate >= "2024-12" then "Q4"
    elif AdmissionDate >= "2024-09" then "Q3"
    else "earlier"
    end
  `;
  // baselinePatient.admissionDate = "2024-11-01"
  strictEqual(evaluateBxl(src, baselinePatient).value, 'Q3');
});

// ---------------------------------------------------------------- probeAdmissionState

check('probeAdmissionState: jq if/then/elif/else/end with raw-jq paths', () => {
  const src =
    'if .dischargeDate then "discharged" elif .admissionDate then "admitted" else "pending" end';
  strictEqual(evaluateBxl(src, baselinePatient).value, 'discharged');
  strictEqual(evaluateBxl(src, dischargedPatient).value, 'discharged');
  strictEqual(
    evaluateBxl(src, { admissionDate: '2024-11-01', dischargeDate: null }).value,
    'admitted',
  );
  strictEqual(evaluateBxl(src, { admissionDate: null }).value, 'pending');
});

// ---------------------------------------------------------------- probeFullNameWithId

check('probeFullNameWithId: Excel & string-concat operator', () => {
  const compute = expression(
    fx`PatientId & " — " & FirstName & " " & LastName`,
  );
  strictEqual(
    compute.call(baselinePatient),
    'PT-1001 — Margaret Okonkwo',
  );
});

check('probeFullNameWithId: handles null first/last (§7 + §8)', () => {
  // Realm fuzz pattern — partial patient. The & operator goes through
  // assertString coercion, so null becomes "".
  const compute = expression(
    fx`PatientId & " — " & FirstName & " " & LastName`,
  );
  const out = compute.call({
    patientId: 'PT-FUZZ-1',
    firstName: null,
    lastName: 'Smith',
  });
  // PT-FUZZ-1 — _ Smith — depending on ascii_concat; verify only the
  // ID portion survives so a missing name doesn't crash the indexer.
  strictEqual(typeof out, 'string');
  strictEqual((out as string).startsWith('PT-FUZZ-1 — '), true);
});

// ---------------------------------------------------------------- probeRecentlyAdmitted

check('probeRecentlyAdmitted: date-string range via fx', () => {
  const compute = expression(fx`AdmissionDate >= "2024-11-01"`);
  strictEqual(compute.call(baselinePatient), true);
  strictEqual(
    compute.call({ admissionDate: '2024-09-30' }),
    false,
  );
});

check('probeRecentlyAdmitted: null admissionDate compares as false', () => {
  // jq's `null >= "2024-11-01"` is false (null is less than every
  // string in jq's ordering). The runtime relaxation doesn't change
  // comparison semantics — only arithmetic.
  const compute = expression(fx`AdmissionDate >= "2024-11-01"`);
  strictEqual(compute.call({ admissionDate: null }), false);
});

// ---------------------------------------------------------------- fxAdmissionStateLabel

check('fxAdmissionStateLabel: plain-string jq-syntax field works', () => {
  // The "failing test" field from the realm's hospital-patient.gts.
  // Goal: the readable-syntax compiler detects lowercase
  // then/else/end and passes the source through unchanged. With the
  // §13 guard in place, this should compile + evaluate cleanly.
  const compute = expression(
    'if .dischargeDate then "discharged" elif .admissionDate then "admitted" else "pending" end',
  );
  strictEqual(compute.call(baselinePatient), 'discharged');
});

console.log(
  `BXL Boxel probe-field regressions: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
