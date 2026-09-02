import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Invoice } from '../invoice';
import { matchLines, openVarianceCount } from '../three-way-match';

// Approve Invoice for Payment — the control this whole desk exists for:
// there is NO path to payment around an open variance. The command re-runs
// the match itself (never trusting the panel's display) and refuses unless
// every failing line carries a stored resolution. On success the invoice
// moves to `approved-for-payment`; from there the EXISTING payment flow
// (Record Payment / Process Payment) takes over — no parallel payment
// model.

export class ApproveInvoiceForPaymentInput extends CardDef {
  @field invoice = linksTo(() => Invoice, { searchable: true });
}

export class ApproveInvoiceForPaymentResult extends CardDef {
  @field message = contains(StringField);
}

export default class ApproveInvoiceForPaymentCommand extends Command<
  typeof ApproveInvoiceForPaymentInput,
  typeof ApproveInvoiceForPaymentResult
> {
  static actionVerb = 'Approve for Payment';
  static displayName = 'Approve Invoice for Payment';

  async getInputType() {
    return ApproveInvoiceForPaymentInput;
  }

  protected async run(
    input: ApproveInvoiceForPaymentInput,
  ): Promise<ApproveInvoiceForPaymentResult> {
    let { invoice } = input;
    if (!invoice) {
      throw new Error('An invoice is required');
    }
    if (invoice.id) {
      invoice = (await new GetCardCommand(this.commandContext).execute({
        cardId: invoice.id,
      })) as Invoice;
    }
    let po = invoice.purchaseOrder;
    if (!po) {
      throw new Error(
        'This invoice names no purchase order — a vendor invoice cannot be approved without the match',
      );
    }
    if (
      ['approved-for-payment', 'partial', 'paid'].includes(invoice.status ?? '')
    ) {
      throw new Error(`This invoice is already "${invoice.status}"`);
    }

    // Re-run the match here — the guard trusts the documents, not the UI.
    let resolved = new Set<number>(
      (invoice.varianceResolutions ?? [])
        .filter(Boolean)
        .map((r) => r.lineNumber as number),
    );
    let rows = matchLines(
      po.lineItems ?? [],
      po.receivedQuantities ?? [],
      invoice.lineItems ?? [],
      resolved,
    );
    let open = openVarianceCount(rows);
    if (open > 0) {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Invoice,
      }).execute({
        cardId: invoice.id,
        patch: { attributes: { status: 'exception' } },
      });
      throw new Error(
        `${open} open variance${open === 1 ? '' : 's'} — resolve each line (with a reason) before payment can be approved`,
      );
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Invoice,
    }).execute({
      cardId: invoice.id,
      patch: { attributes: { status: 'approved-for-payment' } },
    });

    let resolvedCount = resolved.size;
    return new ApproveInvoiceForPaymentResult({
      message:
        resolvedCount > 0
          ? `Match closed with ${resolvedCount} resolved variance${resolvedCount === 1 ? '' : 's'} — approved for payment.`
          : 'Match clean — approved for payment.',
    });
  }
}
