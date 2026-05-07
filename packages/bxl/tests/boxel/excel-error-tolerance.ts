// Boxel-flavored Excel-error tolerance suite (M3 part 1).
//
// Validates that spreadsheet error sentinels (#N/A, #DIV/0!, #VALUE!,
// #NUM!, #REF!, #NAME?, #NULL!, #ERROR!, #GETTING_DATA) raised by
// Excel functions or coercions are caught at the bxl() factory
// boundary and surface as `null` — not propagated up to the realm
// indexer, where they'd tear down the card mid-render.
//
// Maps to port-doc §11a (Excel-error catch).

import { ok, strictEqual } from 'node:assert';
import { evaluateBxl, expression, fx } from '../../src/index.js';
import { baselinePatient, fuzzShellRecord } from './fixtures/hospital.js';

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

// IFS with no matching branch raises #N/A — should land as null.
check('IFS with no matching branch → null', () => {
  const compute = expression(
    fx`IFS(BpSystolic >= 200, "crisis", BpSystolic >= 180, "stage2")`,
  );
  strictEqual(compute.call({ bpSystolic: 90 }), null);
});

check('IFS with a matching branch returns the branch value', () => {
  const compute = expression(
    fx`IFS(BpSystolic >= 200, "crisis", BpSystolic >= 100, "stage1")`,
  );
  strictEqual(compute.call({ bpSystolic: 138 }), 'stage1');
});

check('IFS/10 (5 condition/value pairs) dispatches correctly', () => {
  // Five-pair IFS — used in the airline middle-wolverine realm's
  // ScenarioField for stress-case classification.
  const compute = expression(
    fx`IFS(Score >= 100, "a", Score >= 80, "b", Score >= 60, "c", Score >= 40, "d", TRUE, "e")`,
  );
  strictEqual(compute.call({ score: 95 }), 'b');
  strictEqual(compute.call({ score: 30 }), 'e');
});

check('IFS/16 (8 condition/value pairs) dispatches correctly', () => {
  // Top arity supported. Anything past this still raises 'IFS/N is
  // not defined' — extend formula-contrib-jq.ts if a real card needs
  // more pairs.
  const compute = expression(
    fx`IFS(Score >= 8, "h", Score >= 7, "g", Score >= 6, "f", Score >= 5, "e", Score >= 4, "d", Score >= 3, "c", Score >= 2, "b", TRUE, "a")`,
  );
  strictEqual(compute.call({ score: 7.5 }), 'g');
  strictEqual(compute.call({ score: 0 }), 'a');
});

// Direct sentinel-shaped errors all pass through the catch.
const sentinels = [
  '#N/A',
  '#DIV/0!',
  '#VALUE!',
  '#NUM!',
  '#REF!',
  '#NAME?',
  '#NULL!',
  '#ERROR!',
  '#GETTING_DATA',
];

for (const sentinel of sentinels) {
  check(`${sentinel} sentinel surfaces as null`, () => {
    // Evaluate a constant expression that raises the sentinel directly.
    // jq's `error()` wraps the message; the BXL runtime preserves the
    // sentinel string in the error message, which isExcelErrorMessage
    // matches.
    const compute = expression(`error("${sentinel}")`, {
      readableSyntax: false,
    });
    strictEqual(compute.call({}), null);
  });
}

check('Excel #DIV/0! from VLOOKUP-style miss returns null', () => {
  // VLOOKUP-on-empty raises #N/A.
  const compute = expression(fx`VLOOKUP("missing", [], 1, FALSE)`);
  strictEqual(compute.call({}), null);
});

check('Excel #VALUE! from type mismatch returns null', () => {
  // Excel ABS on a string raises #VALUE!.
  const compute = expression(fx`ABS("not a number")`);
  strictEqual(compute.call({}), null);
});

check('non-Excel runtime errors still throw', () => {
  // Compile errors (bad syntax) don't have sentinel messages — they
  // need to bubble so the realm sees them and the author can fix.
  let threw = false;
  try {
    const compute = expression('this is not valid bxl(',  {
      readableSyntax: false,
    });
    compute.call({});
  } catch {
    threw = true;
  }
  strictEqual(threw, true);
});

check('Excel error captured deep inside an expression returns null', () => {
  // Nesting: VLOOKUP inside ROUND inside addition. The sentinel
  // bubbles up through the operator chain and the catch still fires.
  const compute = expression(
    fx`100 + ROUND(VLOOKUP("missing", [], 1, FALSE), 2)`,
  );
  strictEqual(compute.call({}), null);
});

check('Excel error in a path expression on a real card returns null', () => {
  // Realm-shaped: a guarded IFS that can miss every branch on
  // exotic patient data.
  const compute = expression(
    fx`IFS(Severity == "Critical", "ICU", Severity == "Critical-Plus", "ICU-X")`,
  );
  strictEqual(compute.call(baselinePatient), null);
});

check('division by zero returns null (runtime relaxation, not Excel catch)', () => {
  // 1/0 returns null via the §7 arithmetic relaxation, which doesn't
  // even reach the Excel-error catch path. Confirms the two
  // mechanisms agree on the surface contract.
  strictEqual(evaluateBxl('1 / 0', null).value, null);
});

check('shell-record path that misses doesn\'t synthesize an error', () => {
  // `.medications[]?` on a record without `medications` is empty —
  // no error to catch, no null to surface, just an empty stream
  // that evaluateBxl normalizes to null.
  const compute = expression('[.medications[]?]', { readableSyntax: false });
  ok(Array.isArray(compute.call(fuzzShellRecord)));
  strictEqual(JSON.stringify(compute.call(fuzzShellRecord)), '[]');
});

console.log(
  `BXL Boxel Excel-error tolerance: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
