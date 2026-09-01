import { CardDef, contains, field, linksTo } from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import { TaxJurisdiction } from './tax-jurisdiction';

// Calculate Tax — computes a Tax Breakdown for a taxable amount against a
// Tax Jurisdiction. A SIMULATION only, the same honesty boundary as Payment:
// this realm has no real tax-authority integration, so the rate comes from
// whatever Tax Jurisdiction record the caller supplies, not a live filing
// lookup.
//
// FIXED (audit against block-factory's "no upward dependencies" and
// "domain-neutral block, consumer supplies specifics" rules): this command
// originally took an `Invoice` link and read `invoice.lineItems` directly —
// an upward dependency from this Layer 04 "Standards" block onto a Layer
// 05.5 Commerce Domain Kit type, and a hardcoded assumption that the only
// thing ever taxed is an Invoice's line items. Now takes a plain
// `taxableAmount` number; the caller (`convert-quote-to-invoice-command.ts`,
// which IS Layer 05.5 and correctly allowed to know about Invoice) computes
// that amount from whatever it's taxing and passes it in. This also makes
// the command genuinely reusable by any future domain, not just Commerce.

export class CalculateTaxInput extends CardDef {
  @field taxableAmount = contains(NumberField);
  @field jurisdiction = linksTo(TaxJurisdiction, { searchable: true });
}

export class CalculateTaxResult extends CardDef {
  @field taxableAmount = contains(NumberField);
  @field taxAmount = contains(NumberField);
  @field rateApplied = contains(NumberField);
  @field message = contains(StringField);
}

export default class CalculateTaxCommand extends Command<
  typeof CalculateTaxInput,
  typeof CalculateTaxResult
> {
  static actionVerb = 'Calculate Tax';

  async getInputType() {
    return CalculateTaxInput;
  }

  protected async run(input: CalculateTaxInput): Promise<CalculateTaxResult> {
    let { taxableAmount, jurisdiction } = input;
    if (typeof taxableAmount !== 'number') {
      throw new Error('A taxable amount is required');
    }
    if (!jurisdiction) throw new Error('A tax jurisdiction is required');

    if (jurisdiction.id) {
      jurisdiction = (await new GetCardCommand(this.commandContext).execute({
        cardId: jurisdiction.id,
      })) as TaxJurisdiction;
    }

    let rateApplied = jurisdiction.rate ?? 0;
    let taxAmount = Math.round(taxableAmount * (rateApplied / 100) * 100) / 100;

    return new CalculateTaxResult({
      taxableAmount,
      taxAmount,
      rateApplied,
      message: `Tax calculated at ${rateApplied}% for ${jurisdiction.cardTitle}.`,
    });
  }
}
