// Pretui — demo-forms-expression: the resources and condition helper the rule-builder usage pages share.
import type { SelectOption } from './components/select';
import { newCondition } from './internal/forms-expression';
import type { ExpressionCondition, ExpressionResource } from './internal/forms-expression';
import { SUPPLIERS, TEAS } from './examples';

// ── The record shape the rules are written against ───────────────────────
// Every `value` is a BXL label path, already quoted where it needs quoting.
// The last one is a PREDICATE path: it contains dots, brackets, quotes and a
// space, which is exactly why nothing in this territory ever splits a path.

const STAGE_OPTIONS: SelectOption[] = [
  { value: 'Sourcing', label: 'Sourcing' },
  { value: 'Cupping', label: 'Cupping' },
  { value: 'Negotiation', label: 'Negotiation' },
  { value: 'Closed Won', label: 'Closed Won' },
  { value: 'Closed Lost', label: 'Closed Lost' },
];

const SUPPLIER_OPTIONS: SelectOption[] = SUPPLIERS.slice(0, 8).map((s) => ({
  value: s,
  label: s,
}));

const GRADE_OPTIONS: SelectOption[] = TEAS.slice(0, 6).map((t) => ({
  value: t,
  label: t,
}));

const BOOLEAN_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

export const REQUEST_RESOURCES: ExpressionResource[] = [
  { value: 'Total', label: 'Total', type: 'currency' },
  { value: '"Approved Budget"', label: 'Approved Budget', type: 'currency' },
  { value: '"Approver Email"', label: 'Approver Email', type: 'text' },
  { value: 'Stage', label: 'Stage', type: 'picklist', options: STAGE_OPTIONS },
  {
    value: 'Supplier',
    label: 'Supplier',
    type: 'picklist',
    options: SUPPLIER_OPTIONS,
  },
  { value: 'Lot', label: 'Lot', type: 'picklist', options: GRADE_OPTIONS },
  {
    value: '"Requested Delivery Days"',
    label: 'Requested Delivery Days',
    type: 'number',
  },
  { value: '"Close Date"', label: 'Close Date', type: 'date' },
  {
    value: '"Terms Accepted"',
    label: 'Terms Accepted',
    type: 'boolean',
    options: BOOLEAN_OPTIONS,
  },
  {
    value: '"Line Item"[SKU = "DHP-04"].Quantity',
    label: 'Line item DHP-04 · Quantity',
    type: 'number',
  },
];

export const LOGIC_KNOB = ['all', 'any', 'custom', 'always'];

export function condition(
  targetPath: string,
  operator: string,
  value: string,
  valueKind?: 'literal' | 'path',
): ExpressionCondition {
  return newCondition({ targetPath, operator, value, valueKind });
}

