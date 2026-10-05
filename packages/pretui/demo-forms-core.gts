// Pretui — demo-forms-core: the issue, owner, rating and layout fixtures the form usage pages share.
import type { FormIssue } from './internal/forms-core';

// ── Salesforce-shaped fixtures, tea-trade data ───────────────────────────

export const ACCOUNT_ISSUES: FormIssue[] = [
  {
    ruleId: 'acct-website-required',
    targetPath: 'Website',
    severity: 'error',
    message:
      'Supplier accounts must record a website before they can be approved for purchasing.',
  },
  {
    ruleId: 'acct-owner-desk',
    targetPath: '"Account Owner"',
    severity: 'warning',
    message:
      'Mei-Lin Chua covers the Fujian desk; Wuyishan lots normally sit with the Highland buyer.',
  },
  {
    ruleId: 'acct-rating-stale',
    targetPath: 'Rating',
    severity: 'info',
    message: 'Rating has not been reviewed since the 2026 first flush.',
  },
  {
    ruleId: 'lot-allocation-ceiling',
    // Unknown severity — normalizeSeverity fails closed and this blocks.
    severity: 'critical',
    // Predicate path: no field on this form claims it, so it surfaces in the
    // summary as unrouted rather than vanishing.
    targetPath: '"Line Item"[SKU = "DHP-04"].Quantity',
    message:
      'Da Hong Pao lot DHP-04 is booked at 96 kg against an 84 kg allocation.',
  },
];

export const OWNERS = [
  { value: 'mei-lin', label: 'Mei-Lin Chua' },
  { value: 'tomas', label: 'Tomás Aravena' },
  { value: 'ingrid', label: 'Ingrid Halvorsen' },
  { value: 'kwame', label: 'Kwame Boateng' },
];
export const RATINGS = [
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
];
export const SECTIONED_ISSUES: FormIssue[] = [
  {
    ruleId: 'acct-website-required',
    targetPath: 'Website',
    severity: 'error',
    message:
      'Supplier accounts must record a website before they can be approved for purchasing.',
  },
  {
    ruleId: 'addr-postal-form',
    targetPath: '"Billing Postal Code"',
    severity: 'warning',
    message:
      'Postal code 354300 does not match the six-digit form used elsewhere in Fujian.',
  },
  {
    ruleId: 'terms-approver-required',
    targetPath: '"Approval Status"',
    severity: 'error',
    message:
      'A supplier on Net 90 terms needs a named approver before the record can be saved.',
  },
  {
    ruleId: 'lot-allocation-ceiling',
    severity: 'critical',
    targetPath: '"Line Item"[SKU = "DHP-04"].Quantity',
    message:
      'Da Hong Pao lot DHP-04 is booked at 96 kg against an 84 kg allocation.',
  },
];

export const LAYOUTS = ['stacked', 'horizontal'];

