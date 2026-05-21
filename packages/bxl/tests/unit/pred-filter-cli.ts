// Exercise the Excel-Table-style filter syntax and related row/index
// conventions added in this pass:
//
//   `[* .pred]` — filter-all with explicit current-item predicate semantics.
//                 Replaces most uses of the `_BY` builtin family.
//   `[#N]`      — one-based single-row shortcut (was zero-based).
//   `[#N..#M]`  — one-based inclusive range (preferred spelling).
//   `[#N..#last-K]` / `[#last-K..#last-J]`
//                — anchored forward ranges from the front/back.
//   `[#1, #2, #7..#9, #11]`
//                — ordered selector union (preserves collection order).
//   `[row N]`   — legacy one-based shortcut; still parses, solidify
//                 rewrites to `[#N]` + linter info code.
//   bare `[N]`  — zero-based jq-native escape hatch (info-level lint).
//   implicit `[all]` — `"Line Item"."Line Total"` auto-iterates when
//                      the preceding field is an array.
//   top-level `=` — auto-rewritten to `==` at compile so `Status = "x"`
//                   is a comparison, not a jq assignment.

import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import {
  bxlToJqExpression,
  evaluateBxl,
  lintBxlExpression,
  solidifyBxlExpression,
} from '../../src/index.js';
import { bxlExampleInput, bxlExampleSchema } from '../../examples/bxl-150-examples.js';

type Expected = number | string | boolean | null | unknown[];

interface FilterCase {
  name: string;
  expression: string;
  expectedValue: Expected;
  expectedJq?: string;
}

const cases: FilterCase[] = [
  // --- [* .pred] truthy filter-all ---
  {
    name: '[* .field] truthy filter across line items',
    expression: '"Line Item"[* ."Taxable"]."Line Total"',
    expectedValue: [10, 12, 18, 15],
    expectedJq: '[.lineItems[] | select(.taxable).lineTotal]',
  },
  {
    name: '[* .field] piped into add (Excel SUMIF shape)',
    expression: 'SUM("Line Item"[* ."Taxable"]."Line Total")',
    expectedValue: 55,
  },
  {
    name: '[* .pred] with explicit comparison',
    expression: 'SUM("Line Item"[* ."Category" = "Service"]."Line Total")',
    expectedValue: 33,
  },
  {
    name: '[* .pred] composes with numeric comparison',
    expression: '"Line Item"[* .Quantity > 5].SKU',
    expectedValue: ['COPY-04'],
  },
  {
    name: 'COUNTA over [* .pred] matches object-arity intent',
    expression: 'COUNTA("Line Item"[* ."Taxable"])',
    expectedValue: 4,
  },

  // --- [#N] one-based shortcut ---
  {
    name: '[#1] is first row',
    expression: '"Line Item"[#1].SKU',
    expectedValue: 'PAPER-01',
    expectedJq: '.lineItems[0].sku',
  },
  {
    name: '[#4] is fourth row',
    expression: '"Line Item"[#4].SKU',
    expectedValue: 'COPY-04',
    expectedJq: '.lineItems[3].sku',
  },

  // --- [#N..M] inclusive range ---
  {
    name: '[#1..#3] yields first three SKUs',
    expression: '"Line Item"[#1..#3].SKU',
    expectedValue: ['PAPER-01', 'BRAND-RED', 'COPY-03'],
  },
  {
    name: '[#2..#last-1] yields middle SKUs',
    expression: '"Line Item"[#2..#last-1].SKU',
    expectedValue: ['BRAND-RED', 'COPY-03', 'COPY-04', 'SRV-01'],
    expectedJq: '[(.lineItems) as $__seq | $__seq[1:(($__seq | length) - 1)][].sku]',
  },
  {
    name: '[#last-3..#last-1] yields forward end-anchored range',
    expression: '"Line Item"[#last-3..#last-1].SKU',
    expectedValue: ['COPY-03', 'COPY-04', 'SRV-01'],
    expectedJq: '[(.lineItems) as $__seq | $__seq[(($__seq | length) - 4):(($__seq | length) - 1)][].sku]',
  },
  {
    name: '[#1, #2, #4..#5] yields selector union in collection order',
    expression: '"Line Item"[#1, #2, #4..#5].SKU',
    expectedValue: ['PAPER-01', 'BRAND-RED', 'COPY-04', 'SRV-01'],
    expectedJq:
      '[(.lineItems) as $__seq |($__seq | length) as $__len | range(0; $__len) as $__idx | select($__idx == 0 or $__idx == 1 or ($__idx >= 3 and $__idx < 5)) | $__seq[$__idx].sku]',
  },
  {
    name: '[#5, #1, #2] still returns collection order',
    expression: '"Line Item"[#5, #1, #2].SKU',
    expectedValue: ['PAPER-01', 'BRAND-RED', 'SRV-01'],
  },
  {
    name: '[#1, #1..#2] collapses overlap naturally',
    expression: '"Line Item"[#1, #1..#2].SKU',
    expectedValue: ['PAPER-01', 'BRAND-RED'],
  },

  // --- Implicit [all] ---
  {
    name: 'implicit [all] on array field',
    expression: '"Line Item"."Line Total"',
    expectedValue: [10, 10, 12, 18, 15, 15],
    expectedJq: '[.lineItems[].lineTotal]',
  },
  {
    name: 'implicit [all] + pipeline',
    expression: '"Line Item"."Line Total" | add',
    expectedValue: 80,
  },
  {
    name: 'implicit [all] preserves non-array navigation',
    expression: 'Customer.Name',
    expectedValue: 'Acme Legal',
    expectedJq: '.customer.name',
  },
  {
    name: 'explicit [#N] does NOT auto-iterate afterwards',
    expression: '"Line Item"[#4].Quantity',
    expectedValue: 9,
    expectedJq: '.lineItems[3].quantity',
  },

  // --- Top-level `=` -> `==` compile fix ---
  {
    name: 'top-level = compiles to ==',
    expression: 'Status = "open"',
    expectedValue: true,
    expectedJq: '.status == "open"',
  },
  {
    name: 'top-level = with nested predicate keeps inner =',
    expression: '"Line Item"[SKU = "COPY-04"].Quantity = 9',
    expectedValue: true,
  },
];

let failing = 0;

for (const c of cases) {
  try {
    const value = evaluateBxl(c.expression, bxlExampleInput, {
      schema: bxlExampleSchema,
    }).value;
    deepStrictEqual(value, c.expectedValue, `${c.name}: value`);
    if (c.expectedJq !== undefined) {
      const jq = bxlToJqExpression(c.expression, { schema: bxlExampleSchema }).source;
      strictEqual(jq, c.expectedJq, `${c.name}: jq`);
    }
  } catch (error) {
    failing++;
    console.error(`  ✗ ${c.name}`);
    console.error(`    expr: ${c.expression}`);
    console.error(`    ${(error as Error).message}`);
  }
}

throws(
  () => evaluateBxl('"Line Item"[*Taxable]."Line Total"', bxlExampleInput, {
    schema: bxlExampleSchema,
  }),
  /Filter-all \[\* \.\.\.\] predicates must use explicit current-item paths/,
  'filter-all shorthand now requires an explicit current-item dot',
);

// --- Solidify rewrites: [row N] / [item N] → [#N] ---

const rowRewrite = solidifyBxlExpression('"Line Item"[row 4].Quantity', {
  schema: bxlExampleSchema,
});
strictEqual(rowRewrite.source, '"Line Item"[#4].Quantity', 'solidify: [row N] -> [#N]');
strictEqual(
  rowRewrite.rewrites.some((r) => r.code === 'row-shortcut-to-hash'),
  true,
  'solidify emits row-shortcut-to-hash rewrite',
);

const itemRewrite = solidifyBxlExpression('"Line Item"[item 2].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(itemRewrite.source, '"Line Item"[#2].SKU', 'solidify: [item N] -> [#N]');

const rangeRewrite = solidifyBxlExpression('"Line Item"[row 1..3].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(
  rangeRewrite.source,
  '"Line Item"[#1..#3].SKU',
  'solidify: [row N..M] -> [#N..#M]',
);

// --- Anchored ranges must still move forward ---

const reverseAnchored = lintBxlExpression('"Line Item"[#last-1..#last-3].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(reverseAnchored.ok, false, 'reverse anchored range must be rejected');
strictEqual(
  reverseAnchored.issues.some((i) =>
    i.message.includes('[#last-1..#last-3] range must move forward in collection order')),
  true,
);

const backToFrontAnchored = lintBxlExpression('"Line Item"[#last-3..#4].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(backToFrontAnchored.ok, false, 'back-to-front anchored range must be rejected');
strictEqual(
  backToFrontAnchored.issues.some((i) =>
    i.message.includes('[#last-3..#4] range must move forward in collection order')),
  true,
);

// --- Linter: legacy row shortcut surfaces info code ---

const legacyLint = lintBxlExpression('"Line Item"[row 4].Quantity', {
  schema: bxlExampleSchema,
});
strictEqual(legacyLint.ok, true, '[row N] still parses cleanly');
strictEqual(
  legacyLint.issues.some((i) => i.code === 'row-shortcut-deprecated'),
  true,
  'legacy row shortcut emits info-level deprecation',
);

// --- [#0] rejected at compile time ---

const zeroIndex = lintBxlExpression('"Line Item"[#0].SKU', {
  schema: bxlExampleSchema,
});
strictEqual(zeroIndex.ok, false, '[#0] must be rejected (1-based positive)');
strictEqual(
  zeroIndex.issues.some((i) => i.code === 'human-row-zero'),
  true,
);

if (failing > 0) {
  throw new Error(`pred-filter suite: ${failing} of ${cases.length} cases failed`);
}

console.log(
  `BXL predicate-filter + index suite: ${cases.length} evaluate cases + solidify + linter checks passed`,
);
