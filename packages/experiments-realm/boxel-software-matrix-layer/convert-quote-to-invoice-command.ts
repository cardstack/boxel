import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Quote } from './quote';
import { Invoice } from './invoice';
import { TaxJurisdiction } from './tax-jurisdiction';
import CalculateTaxCommand from './calculate-tax-command';

// Convert Quote to Invoice — approves a Quote, stamps an Invoice Number,
// copies its line items onto a new Invoice, and (when a Tax Jurisdiction is
// supplied) calculates and attaches a Tax Breakdown. Mirrors this realm's
// `close-won.gts` pattern: re-fetch the subject before reading its links,
// save through `SaveCardCommand`, patch compound fields (line items, tax
// breakdown) via `PatchCardInstanceCommand` rather than constructing them as
// field-class instances directly.

export class ConvertQuoteToInvoiceInput extends CardDef {
  @field quote = linksTo(Quote, { searchable: true });
  @field jurisdiction = linksTo(TaxJurisdiction);
  @field realm = contains(StringField);
}

export class ConvertQuoteToInvoiceResult extends CardDef {
  @field invoice = linksTo(Invoice);
  @field message = contains(StringField);
}

export default class ConvertQuoteToInvoiceCommand extends Command<
  typeof ConvertQuoteToInvoiceInput,
  typeof ConvertQuoteToInvoiceResult
> {
  static actionVerb = 'Convert Quote to Invoice';

  async getInputType() {
    return ConvertQuoteToInvoiceInput;
  }

  protected async run(
    input: ConvertQuoteToInvoiceInput,
  ): Promise<ConvertQuoteToInvoiceResult> {
    let { quote, jurisdiction, realm } = input;
    if (!quote) throw new Error('A quote is required');
    if (!realm) throw new Error('A realm is required');

    if (quote.id) {
      quote = (await new GetCardCommand(this.commandContext).execute({
        cardId: quote.id,
      })) as Quote;
    }
    if (quote.status !== 'won') {
      throw new Error(
        `Only a "won" quote can be converted to an invoice (this one is "${quote.status}")`,
      );
    }
    if (!quote.deal?.account) {
      throw new Error(
        'The deal needs an account before an invoice can be created',
      );
    }

    let today = new Date();
    let invoiceNumber = `INV-${today.getFullYear()}-${String(
      Math.floor(Math.random() * 900) + 100,
    )}`;

    let invoice = (await new SaveCardCommand(this.commandContext).execute({
      card: new Invoice({
        invoiceNumber,
        issueDate: today,
        status: 'draft',
        account: quote.deal.account,
        owner: quote.deal.owner,
      }),
      realm,
    } as any)) as Invoice;

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Invoice,
    }).execute({
      cardId: invoice.id,
      patch: {
        attributes: {
          lineItems: quote.lineItems,
        },
      },
    });

    let message = `${invoiceNumber} created from ${quote.cardTitle}.`;

    if (jurisdiction) {
      // Calculate Tax is domain-neutral (Layer 04) — it knows nothing about
      // Invoice, so this Layer 05.5 command computes the taxable amount
      // from the Invoice's own line items and passes a plain number.
      let taxableAmount = (quote.lineItems ?? []).reduce(
        (sum, item) =>
          sum + (item?.quantity ?? 0) * (item?.unitPrice?.amount ?? 0),
        0,
      );
      let taxResult = await new CalculateTaxCommand(
        this.commandContext,
      ).execute({
        taxableAmount,
        jurisdiction,
      } as any);
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Invoice,
      }).execute({
        cardId: invoice.id,
        patch: {
          attributes: {
            taxBreakdown: {
              taxableAmount: taxResult.taxableAmount,
              taxAmount: taxResult.taxAmount,
              rateApplied: taxResult.rateApplied,
            },
          },
          relationships: {
            'taxBreakdown.jurisdiction': {
              links: { self: jurisdiction.id },
            },
          },
        },
      });
      message += ` Tax calculated at ${taxResult.rateApplied}%.`;
    }

    return new ConvertQuoteToInvoiceResult({ invoice, message });
  }
}
