import type { ReadableSchema } from '../src/index.js';
import {
  bxlExampleInput,
  bxlExampleSchema,
} from './bxl-150-examples.ts';

export interface BxlEdgeExample {
  id: number;
  level: string;
  name: string;
  expression: string;
  expected?: unknown;
  expectIssueCodes?: string[];
  expectError?: boolean;
}

export const bxlEdgeExampleSchema: ReadableSchema = bxlExampleSchema;
export const bxlEdgeExampleInput = bxlExampleInput;

export const bxlFuzzyExamples: BxlEdgeExample[] = [
  {
    id: 1,
    level: 'fuzzy ok',
    name: 'lowercase formula and comma args',
    expression: ' round ( total , 2 ) == total ',
    expected: true,
  },
  {
    id: 2,
    level: 'fuzzy ok',
    name: 'unquoted multi-word root label',
    expression: 'Invoice Number',
    expected: 'INV-1001',
    expectIssueCodes: ['unquoted-label-phrase'],
  },
  {
    id: 3,
    level: 'fuzzy ok',
    name: 'unquoted collection label with uppercase row selector',
    expression: 'Line Item [ ROW 4 ] . quantity',
    expected: 9,
  },
  {
    id: 4,
    level: 'fuzzy ok',
    name: 'unquoted nested multi-word label',
    expression: 'customer . credit limit',
    expected: 500,
    expectIssueCodes: ['unquoted-label-phrase'],
  },
  {
    id: 5,
    level: 'fuzzy ok',
    name: 'jq pipe predicate helper',
    expression: 'line item[sku | startswith("COPY")].sku',
    expected: 'COPY-03',
  },
  {
    id: 6,
    level: 'fuzzy ok',
    name: 'mixed-case positional selector keyword',
    expression: 'line item[#LaSt].sku',
    expected: 'HARD-02',
  },
  {
    id: 7,
    level: 'fuzzy ok',
    name: 'last-offset positional selector',
    expression: 'line item[#last-1].sku',
    expected: 'SRV-01',
  },
  {
    id: 8,
    level: 'fuzzy ok',
    name: 'uppercase all selector with unquoted child label',
    expression: 'line item[ALL].line total | add',
    expected: 80,
    expectIssueCodes: ['unquoted-label-phrase'],
  },
  {
    id: 9,
    level: 'fuzzy ok',
    name: 'comma-separated any function',
    expression: 'ANY(line item[], sku | startswith("COPY"))',
    expected: true,
  },
  {
    id: 10,
    level: 'fuzzy ok',
    name: 'uppercase boolean literal in predicate',
    expression: 'shipment [ delivered = FALSE ] . carrier',
    expected: 'FedEx',
    expectIssueCodes: ['predicate-first-match'],
  },
  {
    id: 11,
    level: 'fuzzy ok',
    name: 'mixed-case if expression',
    expression: 'If total > 50 Then "medium" Else "low" End',
    expected: 'medium',
  },
  {
    id: 12,
    level: 'fuzzy ok',
    name: 'uppercase boolean literal in comparison',
    expression: 'owner.active == TRUE',
    expected: true,
  },
  {
    id: 13,
    level: 'fuzzy ok',
    name: 'lowercase text formula with comma args',
    expression: 'textjoin(", ", TRUE, ["A", "", "B"])',
    expected: 'A, B',
  },
  {
    id: 14,
    level: 'fuzzy ok',
    name: 'case-insensitive row range',
    expression: 'line item[Row 2..4].sku',
    expected: ['BRAND-RED', 'COPY-03', 'COPY-04'],
  },
  {
    id: 15,
    level: 'fuzzy ok',
    name: 'case-insensitive payment predicate',
    expression: 'PAYMENT[ STATUS = "captured" ]. amount',
    expected: 30,
    expectIssueCodes: ['predicate-first-match'],
  },
  {
    id: 16,
    level: 'fuzzy ok',
    name: 'rounded balance with lowercase formula and fuzzy spacing',
    expression: ' round ( total - payment [ status = "captured" ] . amount , 2 ) ',
    expected: 59.04,
    expectIssueCodes: ['predicate-first-match'],
  },
];

export const bxlWarningExamples: BxlEdgeExample[] = [
  {
    id: 1,
    level: 'edge ok',
    name: 'root label after pipe auto-root',
    expression: '"Line Item"[all]."Line Total" | add == Subtotal',
    expected: true,
  },
  {
    id: 2,
    level: 'edge warning',
    name: 'legacy row shortcut (deprecated)',
    expression: '"Line Item"[row 1].SKU',
    expected: 'PAPER-01',
    expectIssueCodes: ['row-shortcut-deprecated'],
  },
  {
    id: 3,
    level: 'edge warning',
    name: 'native zero-based index',
    expression: '"Line Item"[0].SKU',
    expected: 'PAPER-01',
    expectIssueCodes: ['native-zero-based-index'],
  },
  {
    id: 4,
    level: 'edge warning',
    name: 'first-match predicate selector',
    expression: '"Line Item"[Category = "Service"].SKU',
    expected: 'COPY-04',
    expectIssueCodes: ['predicate-first-match'],
  },
  {
    id: 5,
    level: 'edge warning',
    name: 'top-level double equals (non-canonical)',
    expression: 'Subtotal == 80',
    expected: true,
    expectIssueCodes: ['prefer-excel-equality'],
  },
  {
    id: 6,
    level: 'edge warning',
    name: 'helper-dependent IN predicate',
    expression: '"Line Item"[SKU IN ["COPY-03"]].SKU',
    expectIssueCodes: ['in-predicate-needs-helper', 'predicate-first-match'],
    expectError: true,
  },
  {
    id: 7,
    level: 'fuzzy ok',
    name: '[#odd] returns 1st, 3rd, 5th items',
    expression: '"Line Item"[#odd].SKU',
    expected: ['PAPER-01', 'COPY-03', 'SRV-01'],
  },
  {
    id: 8,
    level: 'edge error',
    name: 'human row zero',
    expression: '"Line Item"[row 0].SKU',
    expectIssueCodes: ['human-row-zero'],
    expectError: true,
  },
  {
    id: 9,
    level: 'edge error',
    name: 'descending row range',
    expression: '"Line Item"[row 4..2].SKU',
    expectIssueCodes: ['descending-row-range'],
    expectError: true,
  },
  {
    id: 10,
    level: 'edge warning',
    name: 'unquoted label phrase',
    expression: 'Line Item[row 1].Line Total',
    expected: 10,
    expectIssueCodes: ['unquoted-label-phrase'],
  },
  {
    id: 11,
    level: 'fuzzy ok',
    name: '[#even] returns 2nd, 4th, 6th items',
    expression: '"Line Item"[#even].SKU',
    expected: ['BRAND-RED', 'COPY-04', 'HARD-02'],
  },
  {
    id: 12,
    level: 'fuzzy ok',
    name: '[#only] returns the lone shipment item',
    expression: 'Shipment[0:1][#only].Carrier',
    expected: 'UPS',
  },
  {
    id: 13,
    level: 'fuzzy ok',
    name: 'empty check uses length',
    expression: '(Shipment[0:0] | length) = 0',
    expected: true,
  },
  {
    id: 14,
    level: 'edge error',
    name: 'human selector zero',
    expression: '"Line Item"[#0].SKU',
    expectIssueCodes: ['human-row-zero'],
    expectError: true,
  },
  {
    id: 15,
    level: 'edge error',
    name: 'legacy pseudo syntax now errors',
    expression: '"Line Item":first.SKU',
    expectIssueCodes: ['legacy-pseudo-class-removed'],
    expectError: true,
  },
];
// Known edge: applying positional selectors to bare array-literal primaries
// (e.g. `[Subtotal][#only]`) is not currently supported — the compiler
// treats `[` at expression start as an IndexSegment requiring a base path.
// If that becomes a real user need, widen Primary parsing to recognize
// ArrayCtor followed by positional selector suffixes.

export const bxlEdgeExamples = [...bxlFuzzyExamples, ...bxlWarningExamples];
