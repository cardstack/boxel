import { statusField, canTransition, nextStatuses } from './status-field';

// Payment Status — extracted from `invoice.gts`, where it lived as a private
// `InvoiceStatusField` (plain enumField). Sole consumer of the original
// definition was `invoice.gts` itself, so this extraction touches no other
// file — `invoice.gts` keeps a re-export shim below its own class for
// symmetry with the Pipeline Stage extraction, even though nothing external
// currently imports it.
//
// UPGRADED to the realm's `statusField` utility (was plain `enumField`): the
// option set is unchanged, but the graph below now says which moves are
// legal. `overdue` is deliberately NOT one of the stored options — it stays
// a derived field on Invoice (`isOverdue`/`displayStatus`), because overdue
// is what "unpaid past the due date" looks like, not a state anyone sets.
// Storing it would reintroduce the exact stored-vs-computed drift this realm
// has already hit once (a ticket's `overdue` flag disagreeing with its own
// aging report).

export const PaymentStatusField = statusField({
  displayName: 'Payment Status',
  options: [
    { value: 'draft', hue: 'slate', meaning: 'Not yet sent to the customer.' },
    { value: 'sent', hue: 'blue', meaning: 'Delivered, not yet opened.' },
    { value: 'viewed', hue: 'purple', meaning: 'Customer has opened it.' },
    {
      value: 'partial',
      hue: 'amber',
      meaning: 'Some payments recorded, balance remains.',
    },
    {
      value: 'paid',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'Fully paid. Nothing further happens on this record.',
    },
    {
      value: 'void',
      hue: 'red',
      terminal: true,
      holds: true,
      meaning: 'Cancelled. A correction is a new invoice, not an edit.',
    },
  ],
  transitions: {
    draft: ['sent', 'void'],
    sent: ['viewed', 'partial', 'paid', 'void'],
    viewed: ['partial', 'paid', 'void'],
    partial: ['paid', 'void'],
  },
});

export { canTransition, nextStatuses };
