// Boxel-flavored runtime null-tolerance suite.
//
// Validates the runtime relaxations the realm depends on. Maps to
// docs/internals/port-from-jqxl.md §6–9 — each case is tagged with the section it
// asserts so a failure trace points straight at the rule that broke.
//
// Section mapping:
//   §6  — null[]  → empty stream (no `null is not iterable`)
//   §7  — null arithmetic propagates rather than throwing
//   §8  — assertString / assertNumber coerce null to "" / 0
//   §9  — startswith/1 + endswith/1 honor the coerced return value
//         (the bug was assigning the coercion result and then still
//         using the raw `input` afterward).

import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateBxl, jq, expression } from '../../src/index.js';
import {
  baselinePatient,
  fuzzBadTypes,
  fuzzEmptyVitals,
  fuzzShellRecord,
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

// ---------------------------------------------------------------- §6

check('§6 null[] yields an empty stream (no crash)', () => {
  const result = evaluateBxl('[null[]]', null, { readableSyntax: false });
  deepStrictEqual(result.value, []);
});

check('§6 iterating a missing field on a shell record is empty', () => {
  // `.medications[]` on a record with no `medications` key.
  const result = evaluateBxl(
    jq`[.medications[]?]`.source,
    fuzzShellRecord,
    { readableSyntax: false },
  );
  deepStrictEqual(result.value, []);
});

// ---------------------------------------------------------------- §7

check('§7 null - 5 propagates as null', () => {
  const result = evaluateBxl('null - 5', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 5 - null propagates as null', () => {
  const result = evaluateBxl('5 - null', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 null * 3 propagates as null', () => {
  const result = evaluateBxl('null * 3', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 division by zero returns null', () => {
  const result = evaluateBxl('1 / 0', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 modulo by zero returns null', () => {
  const result = evaluateBxl('5 % 0', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 null + null is null (identity preserved for +)', () => {
  // jq's canonical `+` keeps null-identity semantics — neither operand
  // contributes a value, so the result is null. The relaxation only
  // touched `-`, `*`, `/`, `%`.
  const result = evaluateBxl('null + null', null, { readableSyntax: false });
  strictEqual(result.value, null);
});

check('§7 ratio over an empty-vitals record stays null end-to-end', () => {
  // Realm parallel: hospital-fields' bpRatio computes
  //   .vitals.bpSystolic / .vitals.bpDiastolic
  // which used to crash with "Operator / cannot be applied to null
  // and null" when both operands were missing.
  const result = evaluateBxl(
    '.vitals.bpSystolic / .vitals.bpDiastolic',
    fuzzEmptyVitals,
    { readableSyntax: false },
  );
  strictEqual(result.value, null);
});

// ---------------------------------------------------------------- §8

check('§8 ascii_upcase on null yields empty string', () => {
  // `assertString(null)` used to throw "Got null, string expected" —
  // now coerces to "" and the filter applies cleanly.
  const result = evaluateBxl(
    '.firstName | ascii_upcase',
    { firstName: null },
    { readableSyntax: false },
  );
  strictEqual(result.value, '');
});

check('§8 string concat with a null operand uses null-as-identity', () => {
  // Standard jq semantics: `null + x` is `x` and `x + null` is `x`.
  // The runtime relaxation in §7 only changed `-`, `*`, `/`, `%`; the
  // additive identity rule for `+` is unchanged. Confirms the
  // assertString coercion in §8 isn't bleeding into the operator
  // path.
  const result = evaluateBxl(
    '.firstName + " " + .lastName',
    { firstName: null, lastName: 'Cohen' },
    { readableSyntax: false },
  );
  strictEqual(result.value, ' Cohen');
});

// ---------------------------------------------------------------- §9

check('§9 null | startswith("a") returns false', () => {
  const result = evaluateBxl(
    'null | startswith("a")',
    null,
    { readableSyntax: false },
  );
  strictEqual(result.value, false);
});

check('§9 null | endswith("z") returns false', () => {
  const result = evaluateBxl(
    'null | endswith("z")',
    null,
    { readableSyntax: false },
  );
  strictEqual(result.value, false);
});

check('§9 startswith on a string field is unchanged', () => {
  const result = evaluateBxl(
    '.firstName | startswith("Mar")',
    baselinePatient,
    { readableSyntax: false },
  );
  strictEqual(result.value, true);
});

check('§9 startswith on a record where the field is the wrong type', () => {
  // Realm parallel: a fuzz patient has `bpSystolic = "high"` (a string
  // where the schema wants a number). Asking startswith on that string
  // must still work without tripping the assertString rewrite bug.
  const result = evaluateBxl(
    '.vitals.bpSystolic | startswith("hi")',
    fuzzBadTypes,
    { readableSyntax: false },
  );
  strictEqual(result.value, true);
});

// ---------------------------- §11a — bxl() factory smoke ----------

check('§11a expression(jq`…`).call(card) returns the resolved value', () => {
  const compute = expression(
    jq`.vitals.bpSystolic / .vitals.bpDiastolic`,
  );
  const ratio = compute.call(baselinePatient);
  strictEqual(typeof ratio, 'number');
  // 138/88 ≈ 1.568… — assert a tolerance.
  strictEqual(Math.abs((ratio as number) - 138 / 88) < 1e-9, true);
});

check('§11a empty-vitals card returns null instead of throwing', () => {
  const compute = expression(
    jq`.vitals.bpSystolic / .vitals.bpDiastolic`,
  );
  strictEqual(compute.call(fuzzEmptyVitals), null);
});

// --- Parenthesization regression (jq parser left-associativity) ---
//
// Pre-fix bug: `A - (B + C)` normalized to `(A - B) + C` because `+`
// and `-` share precedence and the AST normalizer reassociated across
// the (parenthesized) RHS. Caught by the airline fixture's
// contributionProfit computeVia, which has the exact shape
// `Revenue - (FuelCost + CrewCost + ...)`.

check('paren regression: 100 - (50 + 30) === 20', () => {
  strictEqual(
    evaluateBxl('100 - (50 + 30)', null, { readableSyntax: false }).value,
    20,
  );
});

check('paren regression: A - (B + C) over a card', () => {
  strictEqual(
    evaluateBxl('.a - (.b + .c)', { a: 100, b: 50, c: 30 }, { readableSyntax: false }).value,
    20,
  );
});

check('paren regression: A - (B - C) === A - B + C', () => {
  // `5 - (3 - 1)` should be 3, not 1.
  strictEqual(
    evaluateBxl('5 - (3 - 1)', null, { readableSyntax: false }).value,
    3,
  );
});

check('paren regression: realistic contributionProfit shape', () => {
  // Mirrors the airline FlightProfit.contributionProfit formula on
  // the AA1001 fixture with stress-test fuel price.
  const card = {
    passengers: 198,
    scheduledFareUsd: 419.76,
    ancillaryUsdPerPax: 32,
    cargoRevenueUsd: 1450,
    codeshareShareUsd: 0,
    fuelGallons: 5650,
    fuelPriceUsdGal: 5.99,
    crewCostUsd: 5235.2,
    airportFeesUsd: 18879.6,
    maintenanceCostUsd: 7940,
    ownershipCostUsd: 11200,
    fixedFlightCostUsd: 5200,
  };
  const compute = expression(
    jq`(.passengers * .scheduledFareUsd) + (.passengers * .ancillaryUsdPerPax) + .cargoRevenueUsd - .codeshareShareUsd - (.fuelGallons * .fuelPriceUsdGal + .crewCostUsd + .airportFeesUsd + .maintenanceCostUsd + .ownershipCostUsd + .fixedFlightCostUsd)`,
  );
  // Net rev 90898.48 − op cost 82298.30 = 8600.18.
  const out = compute.call(card) as number;
  strictEqual(Math.round(out * 100) / 100, 8600.18);
});

// ----------------------------------------------------------------

console.log(
  `BXL Boxel runtime null-tolerance: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
