// Verify `expandBxlExpression` and `collapseBxlExpression` — the
// multi-line / single-line format toggles.
//
// Properties covered:
//   - collapse(expand(x)) == canonical(x)   (round-trip)
//   - expand keeps short expressions inline (threshold-based)
//   - expand wraps function-call args, object entries, and pipelines
//   - collapse handles multi-line user input (textarea paste)
//   - Both functions are crash-safe on un-tokenizable input

import { strictEqual } from 'node:assert';
import {
  collapseBxlExpression,
  expandBxlExpression,
} from '../../src/index.js';

// -- Inline cases (short enough to not wrap) -----------------------------

const inlineCases: Array<[string, string]> = [
  ['DATE(2025, 1, 1)', 'DATE(2025, 1, 1)'],
  ['ROUND(x, 2)', 'ROUND(x, 2)'],
  ['a + b', 'a + b'],
  ['Subtotal > 100', 'Subtotal > 100'],
];
for (const [input, expected] of inlineCases) {
  const expanded = expandBxlExpression(input).source;
  strictEqual(expanded, expected, `expand stays inline: ${JSON.stringify(input)}`);
}

// -- Wrapping: function calls -------------------------------------------

const expandSumifBy = expandBxlExpression(
  'SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)',
).source;
strictEqual(
  expandSumifBy,
  [
    'SUMIF_BY(',
    '  "Line Item"[all],',
    '  "lineTotal",',
    '  "taxable",',
    '  true',
    ')',
  ].join('\n'),
  'expand wraps SUMIF_BY args one per line',
);

// -- Wrapping: nested function calls ------------------------------------

const expandedNested = expandBxlExpression(
  'ROUND(SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true) * "Tax Rate" / 100, 2)',
).source;
strictEqual(
  expandedNested,
  [
    'ROUND(',
    '  SUMIF_BY(',
    '    "Line Item"[all],',
    '    "lineTotal",',
    '    "taxable",',
    '    true',
    '  ) * "Tax Rate" / 100,',
    '  2',
    ')',
  ].join('\n'),
  'expand wraps nested calls independently',
);

// -- Wrapping: object literals ------------------------------------------

const expandedObject = expandBxlExpression(
  '{ invoice: "Invoice Number", customer: Customer.Name, status: Status, total: Total }',
).source;
strictEqual(
  expandedObject,
  [
    '{',
    '  invoice:"Invoice Number",',
    '  customer:Customer.Name,',
    '  status:Status,',
    '  total:Total',
    '}',
  ].join('\n'),
  'expand wraps object entries one per line',
);

// -- Wrapping: pipelines ------------------------------------------------

const expandedPipe = expandBxlExpression(
  '"Line Item"[all] | map({sku: .SKU, ext: (.Quantity * ."Unit Price")}) | add',
).source;
strictEqual(
  expandedPipe,
  [
    '"Line Item"[all]',
    '| map({',
    '  sku:.SKU,',
    '  ext:(.Quantity * ."Unit Price")',
    '})',
    '| add',
  ].join('\n'),
  'expand wraps pipelines at each | and nested objects',
);

// -- Round-trip property: collapse(expand(x)) == canonical(x) -----------

const roundTripCases: string[] = [
  'DATE(2025, 1, 1)',
  'SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)',
  'IF(Subtotal > 100, "high", IF(Subtotal > 50, "medium", "low"))',
  '"Line Item"[all] | map({sku: .SKU, ext: (.Quantity * ."Unit Price")}) | add',
  '{ invoice: "Invoice Number", customer: Customer.Name, status: Status, total: Total }',
  'ROUND(SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true) * "Tax Rate" / 100, 2)',
  'Subtotal == 80',
];
for (const source of roundTripCases) {
  const expanded = expandBxlExpression(source).source;
  const collapsed = collapseBxlExpression(expanded).source;
  // The canonical single-line of the ORIGINAL should match the collapsed
  // form of the expanded. This proves the wrap/unwrap is lossless.
  const canonicalSource = collapseBxlExpression(source).source;
  strictEqual(
    collapsed,
    canonicalSource,
    `round-trip: collapse(expand(x)) === canonical(x) for ${JSON.stringify(source)}`,
  );
}

// -- Collapse handles textarea paste (with arbitrary whitespace) --------

const textareaPaste = `
SUMIF_BY(
  "Line Item"[all],
  "lineTotal",
  "taxable",
  true
)
`;
strictEqual(
  collapseBxlExpression(textareaPaste).source,
  'SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)',
  'collapse normalizes multi-line textarea input',
);

// -- Rewrites are surfaced ----------------------------------------------

const collapseLong = collapseBxlExpression(textareaPaste);
strictEqual(collapseLong.changed, true);
strictEqual(
  collapseLong.rewrites.some((r) => r.code === 'format-collapsed'),
  true,
  'collapse surfaces format-collapsed rewrite',
);
const expandLong = expandBxlExpression(
  'SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)',
);
strictEqual(expandLong.changed, true);
strictEqual(
  expandLong.rewrites.some((r) => r.code === 'format-expanded'),
  true,
  'expand surfaces format-expanded rewrite',
);

// -- Hostile input doesn't crash ----------------------------------------

for (const hostile of ['foo£bar', 'A ~ B', '\u203c!']) {
  const collapse = collapseBxlExpression(hostile);
  strictEqual(typeof collapse.source, 'string');
  const expand = expandBxlExpression(hostile);
  strictEqual(typeof expand.source, 'string');
}

// -- No-op when input is already canonical ------------------------------

const alreadyInline = 'DATE(2025, 1, 1)';
const collapseInline = collapseBxlExpression(alreadyInline);
// DATE(2025, 1, 1) is already canonical single-line; collapse should
// detect no change.
strictEqual(collapseInline.changed, false, 'collapse no-ops on canonical input');

console.log(
  `BXL format conversion: ${inlineCases.length} inline + 4 wrap + ${roundTripCases.length} round-trip + 1 paste + 2 rewrite + 3 hostile cases passed`,
);
