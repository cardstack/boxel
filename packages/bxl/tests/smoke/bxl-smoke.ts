import { evaluateBxl } from '../../src/index.js';

const schema = {
  fields: [
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'taxRate', label: 'Tax Rate' },
    {
      key: 'lineItems',
      label: 'Line Item',
      kind: 'array' as const,
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
  subtotal: 50,
  taxRate: 8.25,
  lineItems: [
    { sku: 'COPY-01', quantity: 1, lineTotal: 10 },
    { sku: 'BRAND-RED', quantity: 5, lineTotal: 10 },
    { sku: 'COPY-03', quantity: 6, lineTotal: 12 },
  ],
};

const cases = [
  { expr: '"Line Item":first.SKU', expected: 'COPY-01' },
  { expr: '"Line Item"[#2].SKU', expected: 'BRAND-RED' },
  { expr: '"Line Item"[SKU ^= "BRAND"].Quantity', expected: 5 },
  { expr: 'ROUND(Subtotal * "Tax Rate" / 100, 2)', expected: 4.13 },
  { expr: '"Line Item"[all]."Line Total" | add', expected: 32 },
];

let fail = 0;
for (const c of cases) {
  try {
    const r = evaluateBxl(c.expr, invoice, { schema });
    const pass = JSON.stringify(r.value) === JSON.stringify(c.expected);
    console.log(
      `${pass ? 'OK  ' : 'FAIL'} ${c.expr} => ${JSON.stringify(r.value)} ${
        pass ? '' : `(expected ${JSON.stringify(c.expected)})`
      }`,
    );
    if (!pass) fail++;
  } catch (e) {
    console.log(`FAIL ${c.expr} threw: ${(e as Error).message}`);
    fail++;
  }
}
console.log(`${cases.length - fail}/${cases.length} passed`);
process.exit(fail);
