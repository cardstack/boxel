import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Opportunity } from './opportunity';
import { Subscription } from './subscription';
import { Invoice } from './invoice';
import { Contract } from './contract';

export class CloseWonInput extends CardDef {
  @field deal = linksTo(Opportunity, { searchable: true });
  @field realm = contains(StringField);
}

export class CloseWonResult extends CardDef {
  @field contract = linksTo(Contract);
  @field subscription = linksTo(Subscription);
  @field invoice = linksTo(Invoice);
  @field message = contains(StringField);
}

export default class CloseWonCommand extends Command<
  typeof CloseWonInput,
  typeof CloseWonResult
> {
  static actionVerb = 'Close Won';

  async getInputType() {
    return CloseWonInput;
  }

  protected async run(input: CloseWonInput): Promise<CloseWonResult> {
    let { deal, realm } = input;
    if (!deal) throw new Error('A deal or opportunity is required');
    if (!realm) throw new Error('A realm is required');
    if (deal.id) {
      deal = (await new GetCardCommand(this.commandContext).execute({
        cardId: deal.id,
      })) as Opportunity;
    }
    if (deal.stage === 'closed lost') {
      throw new Error('A lost deal cannot be closed won');
    }
    if (!deal.account) {
      throw new Error(
        'The deal needs an account before it can be closed won — the subscription and invoice must belong to someone',
      );
    }

    let save = async <T extends CardDef>(card: T): Promise<T> =>
      (await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      } as any)) as T;

    let amount = deal.value?.amount;
    let currencyCode = deal.value?.currency?.code ?? 'USD';
    let today = new Date();

    deal.stage = 'closed won';
    deal.lastStageChangedAt = today;
    await save(deal);

    // A one-year term starting today, matching the subscription it governs.
    let termEnd = new Date(today);
    termEnd.setFullYear(termEnd.getFullYear() + 1);
    let contract = await save(
      new Contract({
        title: `${deal.name} — agreement`,
        status: 'draft',
        startDate: today,
        endDate: termEnd,
        account: deal.account,
        deal,
      }),
    );
    if (typeof amount === 'number') {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Contract,
      }).execute({
        cardId: contract.id,
        patch: {
          attributes: {
            value: { amount, currency: { code: currencyCode } },
          },
        },
      });
    }

    let subscription = await save(
      new Subscription({
        planName: deal.name,
        billingCycle: 'yearly',
        startDate: today,
        status: 'active',
        account: deal.account,
        contract,
      }),
    );
    if (typeof amount === 'number') {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Subscription,
      }).execute({
        cardId: subscription.id,
        patch: {
          attributes: {
            price: { amount, currency: { code: currencyCode } },
          },
        },
      });
    }

    let dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 30);
    let invoiceNumber = `INV-${today.getFullYear()}-${String(
      Math.floor(Math.random() * 900) + 100,
    )}`;
    let invoice = await save(
      new Invoice({
        invoiceNumber,
        issueDate: today,
        dueDate,
        status: 'draft',
        account: deal.account,
        owner: deal.owner,
        subscription,
      }),
    );
    if (typeof amount === 'number') {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Invoice,
      }).execute({
        cardId: invoice.id,
        patch: {
          attributes: {
            lineItems: [
              {
                description: `${deal.name} — year 1`,
                quantity: 1,
                unitPrice: { amount, currency: { code: currencyCode } },
              },
            ],
          },
        },
      });
    }

    return new CloseWonResult({
      contract,
      subscription,
      invoice,
      message: `${deal.name} closed won: draft agreement prepared, subscription activated under it, and draft ${invoiceNumber} created.`,
    });
  }
}
