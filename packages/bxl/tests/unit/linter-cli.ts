import { deepStrictEqual, strictEqual } from 'node:assert';
import { lintBxlExpression } from '../../src/index.js';
import { bxlExampleSchema } from '../../examples/bxl-150-examples.js';

function issueCodes(source: string): string[] {
  return lintBxlExpression(source, { schema: bxlExampleSchema }).issues.map(
    (issue) => issue.code,
  );
}

const clean = lintBxlExpression('"Line Item"[#4].Quantity', {
  schema: bxlExampleSchema,
});
strictEqual(clean.ok, true);
deepStrictEqual(clean.issues, []);

const safeAggregate = lintBxlExpression(
  '("Line Item"[all]."Line Total" | add) == Subtotal',
  { schema: bxlExampleSchema },
);
strictEqual(safeAggregate.ok, true);
strictEqual(
  safeAggregate.issues.some((issue) => issue.code === 'root-label-after-pipe'),
  false,
);

const missingQuotes = lintBxlExpression('Invoice Number', {
  schema: bxlExampleSchema,
});
strictEqual(missingQuotes.ok, true);
deepStrictEqual(issueCodes('Invoice Number').sort(), [
  'unquoted-label-phrase',
]);

const autoRootAfterPipe = lintBxlExpression(
  '"Line Item"[all]."Line Total" | add == Subtotal',
  { schema: bxlExampleSchema },
);
strictEqual(autoRootAfterPipe.ok, true);
strictEqual(
  autoRootAfterPipe.issues.some((issue) => issue.code === 'root-label-after-pipe'),
  false,
);

strictEqual(
  issueCodes('"Line Item"[row 4].SKU').includes('row-shortcut-deprecated'),
  true,
);
strictEqual(
  issueCodes('"Line Item"[0].SKU').includes('native-zero-based-index'),
  true,
);
strictEqual(
  issueCodes('"Line Item"[Category = "Service"].SKU').includes(
    'predicate-first-match',
  ),
  true,
);
// `=` at top level is now canonical BXL — no info code. `==` nudges.
strictEqual(issueCodes('Subtotal = 80').includes('prefer-excel-equality'), false);
strictEqual(issueCodes('Subtotal == 80').includes('prefer-excel-equality'), true);
strictEqual(
  issueCodes('"Line Item"[SKU IN ["COPY-03"]].SKU').includes(
    'in-predicate-needs-helper',
  ),
  true,
);
const removedPseudo = lintBxlExpression('"Line Item":odd.SKU', {
  schema: bxlExampleSchema,
});
strictEqual(removedPseudo.ok, false);
strictEqual(
  removedPseudo.issues.some((issue) => issue.code === 'legacy-pseudo-class-removed'),
  true,
);

const badRow = lintBxlExpression('"Line Item"[row 0].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(badRow.ok, false);
strictEqual(badRow.issues.some((issue) => issue.code === 'human-row-zero'), true);

// ─────────────────────────────────────────────────────────────────────
// excel-name-uppercase-preferred — fires on lowercase Excel-name call sites
// ─────────────────────────────────────────────────────────────────────

// Lowercase Excel call site → info-level nudge.
const lowerAtan2 = lintBxlExpression('atan2(.x, .y)', { schema: bxlExampleSchema });
strictEqual(lowerAtan2.ok, true, 'lint should be info, not error');
strictEqual(
  lowerAtan2.issues.some(
    (issue) =>
      issue.code === 'excel-name-uppercase-preferred' && issue.severity === 'info',
  ),
  true,
  'lowercase atan2(...) should emit excel-name-uppercase-preferred',
);

// UPPERCASE call site → no lint.
const upperAtan2 = lintBxlExpression('ATAN2(.x, .y)', { schema: bxlExampleSchema });
strictEqual(
  upperAtan2.issues.some((issue) => issue.code === 'excel-name-uppercase-preferred'),
  false,
  'ATAN2(...) is canonical — no lint',
);

// Mixed case → also lints (only all-UPPERCASE is exempt).
const mixedAtan2 = lintBxlExpression('Atan2(.x, .y)', { schema: bxlExampleSchema });
strictEqual(
  mixedAtan2.issues.some((issue) => issue.code === 'excel-name-uppercase-preferred'),
  true,
  'Atan2(...) (mixed case) should still emit the nudge',
);

// Pipe form `x | sqrt` → no lint (no `(` after the name).
const pipeSqrt = lintBxlExpression('.value | sqrt', { schema: bxlExampleSchema });
strictEqual(
  pipeSqrt.issues.some((issue) => issue.code === 'excel-name-uppercase-preferred'),
  false,
  'pipe form `x | sqrt` is canonical jq idiom — no lint',
);

// Other Excel-collision names: gamma, round, floor, log10, erf.
for (const lowerCall of [
  'gamma(.x)',
  'round(.x)',
  'floor(.x)',
  'log10(.x)',
  'erf(.x)',
  'sin(.x)',
  'cosh(.x)',
  'sort(.list)',
]) {
  const result = lintBxlExpression(lowerCall, { schema: bxlExampleSchema });
  strictEqual(
    result.issues.some(
      (issue) => issue.code === 'excel-name-uppercase-preferred',
    ),
    true,
    `${lowerCall} should emit excel-name-uppercase-preferred`,
  );
}

// Honest jq-only idioms must NOT lint — different name from any Excel formula.
for (const lowerJq of [
  'map(.x + 1)',
  'select(.active)',
  'pow(.b, .e)',
  'fmod(.a, .b)',
  'hypot(.a, .b)',
  'jn(2, .x)',
  'fmax(.a, .b)',
]) {
  const result = lintBxlExpression(lowerJq, { schema: bxlExampleSchema });
  strictEqual(
    result.issues.some(
      (issue) => issue.code === 'excel-name-uppercase-preferred',
    ),
    false,
    `${lowerJq} is jq-only, must NOT emit the nudge`,
  );
}

console.log('BXL linter: edge-case diagnostics passed');
