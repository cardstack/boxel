import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Invoice } from './invoice';
import { Payment } from './payment';
import { sumLineItems } from './money';

export class RecordPaymentInput extends CardDef {
  @field invoice = linksTo(Invoice, { searchable: true });
  @field amount = contains(NumberField);
  @field currencyCode = contains(StringField);
  @field method = contains(StringField);
  @field reference = contains(StringField);
  @field realm = contains(StringField);
}

export class RecordPaymentResult extends CardDef {
  @field payment = linksTo(Payment);
  @field message = contains(StringField);
}

export default class RecordPaymentCommand extends Command<
  typeof RecordPaymentInput,
  typeof RecordPaymentResult
> {
  static actionVerb = 'Record Payment';

  async getInputType() {
    return RecordPaymentInput;
  }

  protected async run(input: RecordPaymentInput): Promise<RecordPaymentResult> {
    let { invoice, amount, currencyCode, method, reference, realm } = input;
    if (!invoice) throw new Error('An invoice is required');
    if (!realm) throw new Error('A realm is required');
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('A positive payment amount is required');
    }
    if (invoice.status === 'void') {
      throw new Error('A void invoice cannot take payments');
    }

    let save = async <T extends CardDef>(card: T): Promise<T> =>
      (await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      } as any)) as T;

    let { total, code } = sumLineItems(invoice.lineItems);
    let currency = currencyCode || code || 'USD';

    let payment = await save(
      new Payment({
        invoice,
        method: method || 'bank transfer',
        paidAt: new Date(),
        reference,
      }),
    );
    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Payment,
    }).execute({
      cardId: payment.id,
      patch: {
        attributes: { amount: { amount, currency: { code: currency } } },
      },
    });

    let priorPaid = (invoice.payments ?? []).reduce(
      (sum, p) => sum + (p?.amount?.amount ?? 0),
      0,
    );
    let paidNow = priorPaid + amount;
    invoice.payments = [...(invoice.payments ?? []), payment];
    invoice.status = paidNow >= total && total > 0 ? 'paid' : 'partial';
    await save(invoice);

    let account = invoice.account;
    if (account && !account.firstPaidAt) {
      account.firstPaidAt = new Date();
      await save(account);
    }

    return new RecordPaymentResult({
      payment,
      message: `Recorded ${amount} ${currency} against ${
        invoice.invoiceNumber ?? 'invoice'
      } — status ${invoice.status} (paid ${paidNow} of ${total})`,
    });
  }
}
