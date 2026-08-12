// Boxel-flavored materialize-as suite (M3 part 2).
//
// Validates the Object.assign fallback path of the
// `expression(..., { as: Cls })` materializer. The schema-aware path
// (`getFields(...)` recursion through nested `contains` / `containsMany`)
// requires Boxel's runtime; that's exercised in the realm-server's own
// tests, not here.
//
// Maps to port-doc §11a (`as` materialization).

import { ok, strictEqual } from 'node:assert';
import { expression, jq } from '../../src/index.js';
import { baselinePatient, icuWarner } from './fixtures/hospital.js';

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

// ---------------------------------------------------------------- Plain object → instance

class StatusPanel {
  label: string = '';
  tone: string = '';
}

check('object literal materializes as Cls instance', () => {
  const compute = expression(
    jq`{ label: "Stable", tone: "blue" }`,
    { as: StatusPanel },
  );
  const out = compute.call(baselinePatient) as StatusPanel;
  ok(out instanceof StatusPanel);
  strictEqual(out.label, 'Stable');
  strictEqual(out.tone, 'blue');
});

check('keys not in the source preserve the constructor defaults', () => {
  const compute = expression(jq`{ label: "ICU CARE" }`, { as: StatusPanel });
  const out = compute.call(icuWarner) as StatusPanel;
  ok(out instanceof StatusPanel);
  strictEqual(out.label, 'ICU CARE');
  strictEqual(out.tone, ''); // constructor default; jq output didn't override
});

check('keys in source but not on Cls survive via Object.assign', () => {
  // The Object.assign fallback doesn't filter — extra fields land on
  // the instance even though they're not declared on the class. Boxel's
  // serializer will silently drop them later, but BXL doesn't try to
  // mirror the schema rules in the no-getFields path.
  const compute = expression(
    jq`{ label: "X", tone: "y", uncategorized: 42 }`,
    { as: StatusPanel },
  );
  const out = compute.call(baselinePatient) as StatusPanel & {
    uncategorized?: number;
  };
  strictEqual(out.label, 'X');
  strictEqual(out.uncategorized, 42);
});

// ---------------------------------------------------------------- Array of plain objects

class MedicationSummary {
  name: string = '';
  doseMg: number = 0;
  frequency: string = '';
}

check('array materializes each entry as Cls', () => {
  const compute = expression(
    jq`[.medications[] | { name: .name, doseMg: .doseMg, frequency: .frequency }]`,
    { as: MedicationSummary },
  );
  const out = compute.call(baselinePatient) as MedicationSummary[];
  ok(Array.isArray(out));
  strictEqual(out.length, 2);
  ok(out.every((entry) => entry instanceof MedicationSummary));
  strictEqual(out[0].name, 'Metoprolol');
  strictEqual(out[1].doseMg, 5);
});

check('empty array materializes as []', () => {
  const compute = expression(jq`[]`, { as: MedicationSummary });
  const out = compute.call(baselinePatient) as MedicationSummary[];
  ok(Array.isArray(out));
  strictEqual(out.length, 0);
});

check('null in array materializes as null instance (no crash)', () => {
  // jq output that's `null` per element should not crash the
  // materialize path — null is not an object, so it's returned
  // unchanged.
  const compute = expression(jq`[null, { name: "x" }, null]`, {
    as: MedicationSummary,
  });
  const out = compute.call(baselinePatient) as Array<MedicationSummary | null>;
  strictEqual(out.length, 3);
  strictEqual(out[0], null);
  ok(out[1] instanceof MedicationSummary);
  strictEqual((out[1] as MedicationSummary).name, 'x');
  strictEqual(out[2], null);
});

// ---------------------------------------------------------------- null / scalar

check('null source returns null (no instance created)', () => {
  const compute = expression(jq`null`, { as: StatusPanel });
  strictEqual(compute.call(baselinePatient), null);
});

check('scalar source returns scalar (not wrapped)', () => {
  // The materializer only wraps objects/arrays. A bare number stays
  // a number — Boxel's serializer expects scalars at scalar fields.
  const compute = expression(jq`42`, { as: StatusPanel });
  strictEqual(compute.call(baselinePatient), 42);
});

check('string source returns string (not wrapped)', () => {
  const compute = expression(jq`"hello"`, { as: StatusPanel });
  strictEqual(compute.call(baselinePatient), 'hello');
});

// ---------------------------------------------------------------- No `as` provided

check('without `as`, raw output flows through verbatim', () => {
  const compute = expression(jq`{ label: "X", tone: "y" }`);
  const out = compute.call(baselinePatient) as Record<string, unknown>;
  ok(typeof out === 'object' && out !== null);
  ok(!(out instanceof StatusPanel));
  strictEqual(out.label, 'X');
});

// ---------------------------------------------------------------- Nested shape (Object.assign is shallow)

class StatusPanelWithSub {
  label: string = '';
  meta: { since: string } = { since: '' };
}

check('nested object lands as a plain object via Object.assign (no getFields)', () => {
  // Without Boxel's getFields, the materialize path is a single
  // Object.assign — nested values are NOT recursively wrapped. The
  // `meta` field gets the raw plain object from jq. The realm's own
  // integration suite covers the recursive `getFields` walk.
  const compute = expression(
    jq`{ label: "Stable", meta: { since: "2024-11-15" } }`,
    { as: StatusPanelWithSub },
  );
  const out = compute.call(baselinePatient) as StatusPanelWithSub;
  ok(out instanceof StatusPanelWithSub);
  strictEqual(out.label, 'Stable');
  // Note: `out.meta` is the raw object literal jq produced.
  strictEqual(out.meta.since, '2024-11-15');
});

console.log(
  `BXL Boxel materialize-as fallback: ${pass}/${pass + fail} cases passed`,
);
if (fail > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
