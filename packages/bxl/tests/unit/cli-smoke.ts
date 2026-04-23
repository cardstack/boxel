import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  compileReadableSyntax,
  evaluateBxl,
  ReadableSchema,
} from '../../src/index.js';

const invoiceSchema: ReadableSchema = {
  fields: [
    { key: 'invoiceNumber', label: 'Invoice Number' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'taxRate', label: 'Tax Rate' },
    { key: 'taxAmount', label: 'Tax Amount' },
    { key: 'total', label: 'Total' },
    {
      key: 'billTo',
      label: 'Bill To',
      kind: 'object',
      fields: [
        { key: 'name', label: 'Name' },
        { key: 'countryCode', label: 'Country Code' },
      ],
    },
    {
      key: 'owner',
      label: 'Owner',
      kind: 'object',
      fields: [{ key: 'email', label: 'Email' }],
    },
    {
      key: 'lineItems',
      label: 'Line Item',
      kind: 'array',
      item: {
        fields: [
          { key: 'sku', label: 'SKU' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'lineTotal', label: 'Line Total' },
        ],
      },
    },
  ],
};

const invoice = {
  invoiceNumber: 'INV-1001',
  subtotal: 50,
  taxRate: 8.25,
  taxAmount: 4.13,
  total: 54.13,
  billTo: {
    name: 'Acme Legal',
    countryCode: 'US',
  },
  owner: {
    email: 'owner@example.test',
  },
  lineItems: [
    { sku: 'COPY-01', quantity: 1, lineTotal: 10 },
    { sku: 'BRAND-RED', quantity: 5, lineTotal: 10 },
    { sku: 'COPY-03', quantity: 6, lineTotal: 12 },
    { sku: 'COPY-04', quantity: 9, lineTotal: 18 },
  ],
};

const cases: Array<{
  name: string;
  expression: string;
  expected: unknown;
  compiled?: string;
}> = [
  {
    name: 'label path + one-based row',
    expression: '"Line Item"[row 4].Quantity',
    expected: 9,
    compiled: '.lineItems[3].quantity',
  },
  {
    name: 'hash first',
    expression: '"Line Item"[#first].SKU',
    expected: 'COPY-01',
    compiled: '.lineItems[0].sku',
  },
  {
    name: 'hash last + quoted nested label',
    expression: '"Line Item"[#last]."Line Total"',
    expected: 18,
    compiled: '.lineItems[-1].lineTotal',
  },
  {
    name: 'hash last-offset selector',
    expression: '"Line Item"[#last-1].SKU',
    expected: 'COPY-03',
    compiled: '.lineItems[-2].sku',
  },
  {
    name: 'hash numeric selector',
    expression: '"Line Item"[#4].Quantity',
    expected: 9,
    compiled: '.lineItems[3].quantity',
  },
  {
    name: 'selector union',
    expression: '"Line Item"[#1, #2, #4..#5].SKU',
    expected: ['COPY-01', 'BRAND-RED', 'COPY-04'],
    compiled:
      '[(.lineItems) as $__seq |($__seq | length) as $__len | range(0; $__len) as $__idx | select($__idx == 0 or $__idx == 1 or ($__idx >= 3 and $__idx < 5)) | $__seq[$__idx].sku]',
  },
  {
    name: 'one-based # shortcut',
    expression: '"Line Item"[#2].SKU',
    expected: 'BRAND-RED',
    compiled: '.lineItems[1].sku',
  },
  {
    name: 'predicate equality',
    expression: '"Line Item"[SKU = "COPY-04"].Quantity',
    expected: 9,
    compiled: 'first(.lineItems[] | select(.sku == "COPY-04")).quantity',
  },
  {
    name: 'predicate numeric comparison',
    expression: '"Line Item"[Quantity > 5]."Line Total"',
    expected: 12,
  },
  {
    name: 'word-form startswith',
    expression: '"Line Item"[SKU STARTSWITH "BRAND"].SKU',
    expected: 'BRAND-RED',
  },
  {
    name: 'css startswith alias',
    expression: '"Line Item"[SKU ^= "BRAND"].SKU',
    expected: 'BRAND-RED',
  },
  {
    name: 'composite row plus drift predicate',
    expression: '"Line Item"[row 4, SKU = "COPY-04"].Quantity',
    expected: 9,
    compiled: '(.lineItems[3] | select(.sku == "COPY-04")).quantity',
  },
  {
    name: 'bare labels in formula expression',
    expression: 'ROUND(Subtotal * "Tax Rate" / 100, 2) == "Tax Amount"',
    expected: true,
  },
  {
    name: 'materialized all index',
    expression: '("Line Item"[all]."Line Total" | add) == Subtotal',
    expected: true,
    compiled: '([.lineItems[].lineTotal] | add) == .subtotal',
  },
  {
    name: 'root label after pipe auto-root',
    expression: '"Line Item"[all]."Line Total" | add == Subtotal',
    expected: true,
    compiled: '. as $root | [.lineItems[].lineTotal] | add == $root.subtotal',
  },
  {
    name: 'plain path equivalence remains valid',
    expression: '.lineItems[3].quantity',
    expected: 9,
    compiled: '.lineItems[3].quantity',
  },
];

for (const testCase of cases) {
  const result = evaluateBxl(testCase.expression, invoice, {
    schema: invoiceSchema,
  });
  deepStrictEqual(result.value, testCase.expected, testCase.name);
  if (testCase.compiled) {
    strictEqual(result.compiledSource, testCase.compiled, testCase.name);
  }
}

const compiled = compileReadableSyntax('"Line Item"[row 4].Quantity', {
  schema: invoiceSchema,
});
strictEqual(compiled.source, '.lineItems[3].quantity');
strictEqual(compiled.changed, true);

const publicBuiltins = evaluateBxl('builtins | contains(["env/0"])', invoice, {
  schema: invoiceSchema,
});
strictEqual(publicBuiltins.value, false, 'public builtins should not advertise env/0');

let envError = '';
try {
  evaluateBxl('env', invoice, { schema: invoiceSchema });
} catch (error) {
  envError =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
}
strictEqual(
  envError.includes('env is not available in the public BXL sandbox'),
  true,
  'env should be unavailable in the public BXL sandbox',
);

let outputLimitError = '';
try {
  evaluateBxl('range(0; 10)', invoice, {
    schema: invoiceSchema,
    runtimeLimits: { maxOutputs: 5 },
  });
} catch (error) {
  outputLimitError =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
}
strictEqual(
  outputLimitError.includes('output runtime limit'),
  true,
  'BXL should enforce maxOutputs at runtime',
);

let stepLimitError = '';
try {
  evaluateBxl('[range(0; 10)]', invoice, {
    schema: invoiceSchema,
    runtimeLimits: { maxSteps: 5 },
  });
} catch (error) {
  stepLimitError =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
}
strictEqual(
  stepLimitError.includes('step runtime limit'),
  true,
  'BXL should enforce maxSteps during intermediate generation',
);

console.log(`BXL readable syntax smoke: ${cases.length} cases passed`);
