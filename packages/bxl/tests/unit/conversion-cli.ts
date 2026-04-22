import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  bxlToJqExpression,
  jqToReadableBxlExpression,
  lintBxlExpression,
  solidifyBxlExpression,
} from '../../src/index.js';
import {
  bxlExampleSchema,
} from '../../examples/bxl-150-examples.js';

function assertSolid(source: string, expected: string) {
  const result = solidifyBxlExpression(source, { schema: bxlExampleSchema });
  strictEqual(result.source, expected, source);
  strictEqual(result.changed, source !== expected, source);
  deepStrictEqual(
    result.after.issues.filter((issue) => issue.severity !== 'info'),
    [],
    source,
  );
}

assertSolid('Invoice Number', '"Invoice Number"');
assertSolid(
  'line item [ ROW 4 ] . quantity',
  '"Line Item"[#4].Quantity',
);
// `[row N]` / `[item N]` are legacy one-based shortcuts; solidify
// canonicalises them to `[#N]`. Raw zero-based indices and slices stay
// as-is (they're the jq-native escape hatch).
assertSolid('"Line Item"[item 2].SKU', '"Line Item"[#2].SKU');
assertSolid('"Line Item"[row 1..3].SKU', '"Line Item"[#1..3].SKU');
// Solid BXL canonicalizes to Excel-style `=` for equality.
assertSolid('Subtotal == 80', 'Subtotal = 80');
assertSolid('Subtotal = 80', 'Subtotal = 80');
assertSolid('Status != "closed"', 'Status <> "closed"');
assertSolid(
  '"Line Item"[all]."Line Total" | add == subtotal',
  '"Line Item"[all]."Line Total" | add = Subtotal',
);

const predicateSolid = solidifyBxlExpression(
  '"Line Item"[Category = "Service"].SKU',
  { schema: bxlExampleSchema },
);
strictEqual(predicateSolid.source, '"Line Item"[Category = "Service"].SKU');
strictEqual(
  predicateSolid.after.issues.some((issue) => issue.code === 'predicate-first-match'),
  true,
  'semantic first-match info should remain explicit',
);

strictEqual(
  bxlToJqExpression('"Line Item"[row 4].Quantity', {
    schema: bxlExampleSchema,
  }).source,
  '.lineItems[3].quantity',
);

strictEqual(
  bxlToJqExpression('"Line Item"[all]."Line Total" | add == Subtotal', {
    schema: bxlExampleSchema,
  }).source,
  '. as $root | [.lineItems[].lineTotal] | add == $root.subtotal',
);

strictEqual(
  jqToReadableBxlExpression('.lineItems[3].quantity', {
    schema: bxlExampleSchema,
  }).source,
  '"Line Item"[#4].Quantity',
);

strictEqual(
  jqToReadableBxlExpression('.lineItems[-1].lineTotal', {
    schema: bxlExampleSchema,
  }).source,
  '"Line Item":last."Line Total"',
);

strictEqual(
  jqToReadableBxlExpression('([.lineItems[].lineTotal]|add)==.subtotal', {
    schema: bxlExampleSchema,
  }).source,
  '("Line Item"[all]."Line Total" | add) = Subtotal',
);

strictEqual(
  jqToReadableBxlExpression(
    'first(.lineItems[] | select(.sku == "COPY-04")).quantity',
    { schema: bxlExampleSchema },
  ).source,
  '"Line Item"[SKU = "COPY-04"].Quantity',
);

const readableCustomerCredit = jqToReadableBxlExpression('.customer.creditLimit', {
  schema: bxlExampleSchema,
});
strictEqual(readableCustomerCredit.source, 'Customer."Credit Limit"');

const fullJq = bxlToJqExpression(readableCustomerCredit.source, {
  schema: bxlExampleSchema,
});
strictEqual(fullJq.source, '.customer.creditLimit');

strictEqual(
  lintBxlExpression(
    solidifyBxlExpression('round ( total , 2 ) == total', {
      schema: bxlExampleSchema,
    }).source,
    { schema: bxlExampleSchema },
  ).ok,
  true,
);

console.log('BXL conversion helpers: solidify and jq/readable round trips passed');
