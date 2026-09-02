import { Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

// Invoice number — the immutable document identity a customer quotes back
// at you. Snapshot pattern, same family as PO Number: the command that
// issues the invoice (e.g. ConvertQuoteToInvoiceCommand) stamps it exactly
// once and nothing ever recomputes it. The field renders in document style
// (mono, tabular) so an invoice number reads as a reference everywhere.
export class InvoiceNumberField extends StringField {
  static displayName = 'Invoice Number';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='invoice-number'>{{@model}}</span>
      <style scoped>
        .invoice-number {
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
      <span class='invoice-number'>{{@model}}</span>
      <style scoped>
        .invoice-number {
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

// Year-scoped generator for the single writer that issues invoices.
// Collision-tolerant at demo scale; a production system allocates from a
// counter service.
export function nextInvoiceNumber(now: Date = new Date()): string {
  let tail = String(Math.floor(Math.random() * 900) + 100);
  return `INV-${now.getFullYear()}-${tail}`;
}

export default InvoiceNumberField;
