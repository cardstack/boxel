// BXL usage contexts from the BSL primer (§07 "JQXL Expressions").
//
// The primer enumerates eight positions in BSL where BXL expressions evaluate —
// Formula fields, Guide constraints, Guide visibility rules, Guide auto-fill,
// Workflow gates, Notification predicates, Reflex triggers, and Query
// transforms — plus §46 annotation targeting as a ninth. Each reuses the same
// parser, dependency tracker, and sandbox, so a field constraint, a workflow
// gate, and a Reflex predicate share a vocabulary the author learns once.
//
// This corpus demonstrates each context with a runnable BXL expression against
// the same invoice schema used by bxl-150-examples.ts. The point is not to
// stress-test the language — that's the 150-core corpus's job — but to show
// how one expression language serves nine distinct authoring surfaces.

import type { ReadableSchema } from '../src/index.js';
import { bxlExampleInput, bxlExampleSchema } from './bxl-150-examples.ts';

export type BxlContext =
  | 'FORMULA'
  | 'CONSTRAINT'
  | 'VISIBLE-WHEN'
  | 'AUTOFILL'
  | 'WORKFLOW'
  | 'NOTIFICATION'
  | 'REFLEX'
  | 'TRANSFORM'
  | 'ANNOTATION';

export interface BxlContextExample {
  id: number;
  context: BxlContext;
  name: string;
  /** What this expression does in the BSL context, in plain English. */
  purpose: string;
  /** Where in the BSL primer / spec this context is discussed. */
  primerRef: string;
  expression: string;
  expected: unknown;
  /** Optional tolerance for floating-point comparisons. */
  tolerance?: number;
}

export const bxlContextExampleSchema: ReadableSchema = bxlExampleSchema;
export const bxlContextExampleInput = bxlExampleInput;

export const bxlContextExamples: BxlContextExample[] = [
  // ─── FORMULA ────────────────────────────────────────────────
  // A FormulaField evaluates a BXL expression and stores the typed result.
  // The expression reads siblings on the current card and recomputes
  // reactively when they change.
  {
    id: 1,
    context: 'FORMULA',
    name: 'taxable subtotal',
    purpose: 'FormulaField derives the taxable-subtotal as line items change.',
    primerRef: '§42 FormulaField · §07 Primer',
    expression: 'SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)',
    expected: 55, // PAPER-01(10) + COPY-03(12) + COPY-04(18) + HARD-02(15) = 55
  },
  {
    id: 2,
    context: 'FORMULA',
    name: 'grand total recompute',
    purpose: 'Reactive FormulaField — recomputes when any input changes.',
    primerRef: '§42 FormulaField',
    expression: 'ROUND(Subtotal-"Discount Amount"+"Tax Amount"+Shipping, 2)',
    expected: 89.04,
  },

  // ─── CONSTRAINT ─────────────────────────────────────────────
  // A Guide constraint is a BXL boolean expression. The UI surfaces violations
  // as validation errors; workflows can refuse to advance past a violation.
  {
    id: 3,
    context: 'CONSTRAINT',
    name: 'line totals sum to subtotal',
    purpose: 'Invariant: the sum of line-item totals must equal the stored Subtotal.',
    primerRef: '§43 Guide · §07 Primer',
    expression: '("Line Item"[all]."Line Total" | add) == Subtotal',
    expected: true, // Subtotal=80, line totals 10+10+12+18+15+15 = 80
  },
  {
    id: 4,
    context: 'CONSTRAINT',
    name: 'line items all have positive quantity',
    purpose: 'Cross-item invariant using all(); one false item fails the whole card.',
    primerRef: '§43 Guide',
    expression: 'all("Line Item"[], Quantity > 0)',
    expected: true,
  },

  // ─── VISIBLE-WHEN ───────────────────────────────────────────
  // Guide visibility rules are BXL predicates. The UI evaluates them as the
  // card changes to show/hide fields reactively.
  {
    id: 5,
    context: 'VISIBLE-WHEN',
    name: 'show reviewer fields when in review',
    purpose: 'Guide rule — reveal reviewer section only for in-review invoices.',
    primerRef: '§44 visibility',
    expression: 'Status == "open"',
    expected: true,
  },
  {
    id: 6,
    context: 'VISIBLE-WHEN',
    name: 'show customer PO field for large orders',
    purpose: 'Compound visibility predicate with business-rule thresholds.',
    primerRef: '§44 visibility',
    expression: 'Customer.Tier == "gold" and Total > 50',
    expected: true,
  },

  // ─── AUTOFILL ───────────────────────────────────────────────
  // Guide auto-fill is a BXL expression whose output becomes the initial value
  // of a stored field. Unlike computeVia, autofill is editable by the user.
  {
    id: 7,
    context: 'AUTOFILL',
    name: 'credit remaining on card create',
    purpose: 'Seed the "credit remaining" field from live computed numbers.',
    primerRef: '§45 auto-fill',
    expression: 'Customer."Credit Limit"-Total',
    expected: 410.96,
  },
  {
    id: 8,
    context: 'AUTOFILL',
    name: 'suggested tax amount',
    purpose: 'Default a computed tax from rate + taxable items; user may override.',
    primerRef: '§45 auto-fill',
    expression: 'ROUND(SUMIF_BY("Line Item"[all], "lineTotal", "taxable", true)*"Tax Rate"/100, 2)',
    expected: 4.54, // 55 * 8.25 / 100 = 4.5375 → 4.54
  },

  // ─── WORKFLOW ───────────────────────────────────────────────
  // Workflow step predicates gate advancement. The workflow engine only
  // advances past a step when the predicate returns true.
  {
    id: 9,
    context: 'WORKFLOW',
    name: 'can close when all shipments delivered',
    purpose: 'Gate: workflow advances to "closed" only when every shipment is delivered.',
    primerRef: '§10 Commands · §07 Primer',
    expression: 'all(Shipment[], Delivered == true)',
    expected: false, // UPS delivered, FedEx+Courier not → false
  },
  {
    id: 10,
    context: 'WORKFLOW',
    name: 'can invoice when captured payment covers total',
    purpose: 'Gate: can advance to "paid" state when captured amounts meet the total.',
    primerRef: '§10 Commands',
    expression: 'Payment[Status = "captured"].Amount >= Total',
    expected: false, // captured=30, total=89.04 → false
  },

  // ─── NOTIFICATION ───────────────────────────────────────────
  // Notification predicates fire when they transition from false to true.
  // They read the card state and return boolean.
  {
    id: 11,
    context: 'NOTIFICATION',
    name: 'low credit remaining alert',
    purpose: 'Notification: fire when customer is close to hitting their credit limit.',
    primerRef: '§07 Primer · notification triggers',
    expression: '(Customer."Credit Limit"-Total) < 500',
    expected: true, // 500 - 89.04 = 410.96, < 500 → true
  },
  {
    id: 12,
    context: 'NOTIFICATION',
    name: 'failed payment alert',
    purpose: 'Notification: fire when any payment is in "failed" state.',
    primerRef: '§07 Primer',
    expression: 'any(Payment[], Status == "failed")',
    expected: true,
  },

  // ─── REFLEX ─────────────────────────────────────────────────
  // Reflex predicates trigger reactive handlers when state enters a matching
  // shape. Read-only side of a Reflex rule (the handler itself runs outside BXL).
  {
    id: 13,
    context: 'REFLEX',
    name: 'overdue invoice trigger',
    purpose: 'Reflex: fires when Due Days drops under a threshold so follow-up logic runs.',
    primerRef: '§11 Reflex · §07 Primer',
    expression: '"Due Days" < 7 and Status != "paid"',
    expected: false, // Due Days = 30, >= 7
  },
  {
    id: 14,
    context: 'REFLEX',
    name: 'stale workflow trigger',
    purpose: 'Reflex: fires when pending payments pile up on an open invoice.',
    primerRef: '§11 Reflex',
    expression: 'Status == "open" and any(Payment[], Status = "pending")',
    expected: true,
  },

  // ─── TRANSFORM ──────────────────────────────────────────────
  // Query transforms shape bulk data for downstream consumers (tables, charts,
  // exports). Transforms project, filter, or reshape arrays of cards.
  {
    id: 15,
    context: 'TRANSFORM',
    name: 'line-item report projection',
    purpose: 'Build a report row per line item with SKU and extended price.',
    primerRef: '§07 Primer · query transforms',
    expression: '["Line Item"[] | {sku: .SKU, ext: (.Quantity * ."Unit Price")}]',
    expected: [
      { sku: 'PAPER-01', ext: 10 },
      { sku: 'BRAND-RED', ext: 10 },
      { sku: 'COPY-03', ext: 12 },
      { sku: 'COPY-04', ext: 18 },
      { sku: 'SRV-01', ext: 15 },
      { sku: 'HARD-02', ext: 15 },
    ],
  },
  {
    id: 16,
    context: 'TRANSFORM',
    name: 'category rollup',
    purpose: 'Group and sum line totals by category for an analytics view.',
    primerRef: '§07 Primer',
    expression: '"Line Item"[all] | group_by(.category) | map({ category: .[0].category, total: (map(.lineTotal) | add) })',
    expected: [
      { category: 'Hardware', total: 15 },
      { category: 'Marketing', total: 10 },
      { category: 'Service', total: 33 },
      { category: 'Supplies', total: 22 },
    ],
  },

  // ─── ANNOTATION ─────────────────────────────────────────────
  // §46 annotations target a card, field, array row, or text range. The
  // target path is a BXL expression; predicate forms survive row reorders.
  {
    id: 17,
    context: 'ANNOTATION',
    name: 'stable target — by SKU',
    purpose:
      'Annotation targetPath follows the data; survives reorder/insertion that would orphan a positional target.',
    primerRef: '§46 annotations by agents',
    expression: '"Line Item"[SKU = "COPY-04"].Quantity',
    expected: 9,
  },
  {
    id: 18,
    context: 'ANNOTATION',
    name: 'composite — row + predicate drift check',
    purpose:
      'Composite anchor: fast positional access with a data predicate that warns if the data shifted.',
    primerRef: '§46 annotations',
    expression: '"Line Item"[row 4, SKU = "COPY-04"].Quantity',
    expected: 9,
  },
];

if (bxlContextExamples.length < 9) {
  throw new Error(
    `Expected at least 9 context examples covering the BSL primer's 8 BXL positions + §46 annotations, found ${bxlContextExamples.length}`,
  );
}

// Verify every context is exercised by at least one example.
const REQUIRED_CONTEXTS: BxlContext[] = [
  'FORMULA',
  'CONSTRAINT',
  'VISIBLE-WHEN',
  'AUTOFILL',
  'WORKFLOW',
  'NOTIFICATION',
  'REFLEX',
  'TRANSFORM',
  'ANNOTATION',
];
for (const ctx of REQUIRED_CONTEXTS) {
  if (!bxlContextExamples.some((ex) => ex.context === ctx)) {
    throw new Error(`Missing at least one example for context: ${ctx}`);
  }
}
