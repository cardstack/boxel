import { Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// Purchase Order number — the immutable document identity referenced on
// packing slips, invoices, and audits. Snapshot pattern (same as Invoice
// Number): AwardRfqCommand / ApprovePurchaseOrderCommand assign it exactly
// once at issue time and nothing ever recomputes it. The field itself is a
// StringField that renders in document style (mono, tabular) so a PO number
// reads as a reference everywhere it appears.
export class PONumberField extends StringField {
  static displayName = 'PO Number';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='po-number'>{{@model}}</span>
      <style scoped>
        .po-number {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='po-number'>{{@model}}</span>
      <style scoped>
        .po-number {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          font-weight: 600;
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}

// Sequence helper used by the single writers that stamp a number at issue
// time. Year-scoped, random tail — collision-tolerant for demo scale; a
// production system would allocate from a counter service.
export function nextPoNumber(now: Date = new Date()): string {
  let tail = String(Math.floor(Math.random() * 9000) + 1000);
  return `PO-${now.getFullYear()}-${tail}`;
}

export default PONumberField;
