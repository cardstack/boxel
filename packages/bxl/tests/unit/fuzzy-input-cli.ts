import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  compileReadableSyntax,
  evaluateBxl,
  lintBxlExpression,
} from '../../src/index.js';
import {
  bxlExampleInput,
  bxlExampleSchema,
} from '../../examples/bxl-150-examples.js';

const cases: Array<{
  name: string;
  expression: string;
  expected: unknown;
}> = [
  {
    name: 'lowercase formula and comma args',
    expression: ' round ( total , 2 ) == total ',
    expected: true,
  },
  {
    name: 'unquoted multi-word root label',
    expression: 'Invoice Number',
    expected: 'INV-1001',
  },
  {
    name: 'unquoted collection label with uppercase row selector',
    expression: 'Line Item [ ROW 4 ] . quantity',
    expected: 9,
  },
  {
    name: 'unquoted nested multi-word label',
    expression: 'customer . credit limit',
    expected: 500,
  },
  {
    name: 'mixed-case predicate operator',
    expression: 'line item[sku startswith "COPY"].sku',
    expected: 'COPY-03',
  },
  {
    name: 'mixed-case pseudo-class',
    expression: 'line item:LaSt.sku',
    expected: 'HARD-02',
  },
  {
    name: 'mixed-case nth-last pseudo-class',
    expression: 'line item:NtH-LaSt(1).sku',
    expected: 'HARD-02',
  },
  {
    name: 'uppercase all selector with unquoted child label',
    expression: 'line item[ALL].line total | add',
    expected: 80,
  },
  {
    name: 'comma-separated any function',
    expression: 'ANY(line item[], sku ^= "COPY")',
    expected: true,
  },
  {
    name: 'uppercase boolean literal in predicate',
    expression: 'shipment [ delivered = FALSE ] . carrier',
    expected: 'FedEx',
  },
  {
    name: 'mixed-case if expression',
    expression: 'If total > 50 Then "medium" Else "low" End',
    expected: 'medium',
  },
  {
    name: 'uppercase boolean literal in comparison',
    expression: 'owner.active == TRUE',
    expected: true,
  },
  {
    name: 'lowercase text formula with comma args',
    expression: 'textjoin(", ", TRUE, ["A", "", "B"])',
    expected: 'A, B',
  },
  {
    name: 'case-insensitive row range',
    expression: 'line item[Row 2..4].sku',
    expected: ['BRAND-RED', 'COPY-03', 'COPY-04'],
  },
  {
    name: 'case-insensitive payment predicate',
    expression: 'PAYMENT[ STATUS = "captured" ]. amount',
    expected: 30,
  },
  {
    name: 'rounded balance with lowercase formula and fuzzy spacing',
    expression: ' round ( total - payment [ status = "captured" ] . amount , 2 ) ',
    expected: 59.04,
  },
];

for (const testCase of cases) {
  const result = evaluateBxl(testCase.expression, bxlExampleInput, {
    schema: bxlExampleSchema,
  });
  deepStrictEqual(result.value, testCase.expected, testCase.name);
  strictEqual(result.warnings.length, 0, testCase.name);

  const lint = lintBxlExpression(testCase.expression, {
    schema: bxlExampleSchema,
  });
  strictEqual(lint.ok, true, testCase.name);
}

const compiled = compileReadableSyntax(
  ' round ( total , 2 ) ',
  { schema: bxlExampleSchema },
);
strictEqual(compiled.source, 'ROUND(.total; 2)');

console.log(`BXL fuzzy input: ${cases.length} cases passed`);
