import {
  FieldDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateTimeField from '@cardstack/base/datetime';
import enumField from '@cardstack/base/enum';

import { lineTotal } from './money';

// The three-way match as data + pure functions: pay only when what the
// vendor invoiced equals what we ordered and what actually arrived, within
// tolerance. The panel (components/three-way-match-panel.gts) renders these
// results; nothing here is stored — a match is always re-derived from the
// three documents so it can never drift from them. Only RESOLUTIONS are
// stored (on the invoice), because a resolution is a human decision, not a
// derivation.

// Tolerance defaults, from the merged spec: a per-line price variance
// within ±2% or ±$25 (whichever is larger) passes without a human.
export const PRICE_TOLERANCE_PCT = 2;
export const PRICE_TOLERANCE_ABS = 25;

export type LineMatchState =
  | 'clean'
  | 'qty-variance'
  | 'price-variance'
  | 'not-on-po'
  | 'resolved';

export interface LineMatch {
  lineNumber: number;
  description: string;
  poQty?: number;
  poUnitPrice?: number;
  poTotal?: number;
  receivedQty?: number;
  invQty?: number;
  invUnitPrice?: number;
  invTotal?: number;
  varianceAmount: number;
  state: LineMatchState;
  detail: string;
}

interface LineItemish {
  description?: string | null;
  quantity?: number | null;
  unitPrice?: { amount?: number | null; currency?: { code?: string | null } } | null;
}

export function matchLines(
  poLines: (LineItemish | undefined)[],
  receivedQuantities: (number | undefined)[],
  invoiceLines: (LineItemish | undefined)[],
  resolvedLineNumbers: Set<number>,
): LineMatch[] {
  let count = Math.max(poLines.length, invoiceLines.length);
  let rows: LineMatch[] = [];
  for (let i = 0; i < count; i++) {
    let po = poLines[i];
    let inv = invoiceLines[i];
    let received = receivedQuantities[i] ?? 0;
    let lineNumber = i + 1;
    let poUnit = po?.unitPrice?.amount ?? undefined;
    let invUnit = inv?.unitPrice?.amount ?? undefined;
    let row: LineMatch = {
      lineNumber,
      description: inv?.description ?? po?.description ?? `Line ${lineNumber}`,
      poQty: po?.quantity ?? undefined,
      poUnitPrice: poUnit,
      poTotal: po ? lineTotal(po as any) : undefined,
      receivedQty: po ? received : undefined,
      invQty: inv?.quantity ?? undefined,
      invUnitPrice: invUnit,
      invTotal: inv ? lineTotal(inv as any) : undefined,
      varianceAmount: 0,
      state: 'clean',
      detail: 'clean',
    };
    if (!po && inv) {
      row.state = 'not-on-po';
      row.varianceAmount = row.invTotal ?? 0;
      row.detail = 'invoiced, not on PO';
    } else if (po && !inv) {
      // PO line the vendor did not invoice — not a variance; simply unpaid.
      row.detail = 'not invoiced';
    } else if (po && inv) {
      let invQty = inv.quantity ?? 0;
      if (invQty > received) {
        row.state = 'qty-variance';
        row.varianceAmount = (invQty - received) * (invUnit ?? 0);
        row.detail = `invoiced ${invQty}, received ${received}`;
      } else if (poUnit != null && invUnit != null) {
        let diff = Math.abs(invUnit - poUnit);
        let tolerance = Math.max(
          (PRICE_TOLERANCE_PCT / 100) * poUnit,
          PRICE_TOLERANCE_ABS / Math.max(1, invQty),
        );
        if (diff > tolerance) {
          row.state = 'price-variance';
          row.varianceAmount = (invUnit - poUnit) * invQty;
          row.detail = `unit ${invUnit} vs PO ${poUnit}`;
        }
      }
    }
    if (row.state !== 'clean' && resolvedLineNumbers.has(lineNumber)) {
      row.state = 'resolved';
    }
    rows.push(row);
  }
  return rows;
}

export function openVarianceCount(rows: LineMatch[]): number {
  return rows.filter(
    (r) => r.state !== 'clean' && r.state !== 'resolved' && r.detail !== 'not invoiced',
  ).length;
}

// ---- stored resolutions -----------------------------------------------

export const VARIANCE_ACTIONS = ['accept', 'short-pay', 'reject-line'];

export const VARIANCE_ACTION_LABELS: Record<string, string> = {
  accept: 'Accepted with reason',
  'short-pay': 'Short-paid',
  'reject-line': 'Line rejected',
};

export const VarianceActionField = enumField(StringField, {
  options: VARIANCE_ACTIONS.map((value) => ({
    value,
    label: VARIANCE_ACTION_LABELS[value],
  })),
  displayName: 'Variance Action',
});

// One human decision about one failing line — stored on the invoice so the
// exception history survives for audit. The match itself is never stored.
export class VarianceResolutionField extends FieldDef {
  static displayName = 'Variance Resolution';

  @field lineNumber = contains(NumberField);
  @field action = contains(VarianceActionField);
  @field reason = contains(StringField);
  @field resolvedAt = contains(DateTimeField);

  static embedded = class Embedded extends Component<typeof this> {
    get actionLabel() {
      return VARIANCE_ACTION_LABELS[this.args.model?.action ?? ''] ?? '';
    }
    <template>
      <div class='res'>
        <span class='res-line'>line {{@model.lineNumber}}</span>
        <span class='res-action'>{{this.actionLabel}}</span>
        <span class='res-reason'>{{@model.reason}}</span>
      </div>
      <style scoped>
        .res {
          display: grid;
          grid-template-columns: auto auto 1fr;
          gap: var(--boxel-sp-xs);
          align-items: baseline;
          font-size: 0.8125rem;
          padding: var(--boxel-sp-5xs) 0;
        }
        .res-line {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .res-action {
          font-weight: 600;
        }
        .res-reason {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };
}
