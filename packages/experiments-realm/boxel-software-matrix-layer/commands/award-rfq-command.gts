import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Rfq } from '../rfq';
import { VendorQuote } from '../vendor-quote';
import type { VendorProfile } from '../vendor-profile';
import { ProcurementBudget } from '../procurement-budget';
import {
  PurchaseOrder,
  poApprovalRouteFor,
  PO_ROUTE_STEP_ROLES,
  type PoApprovalRoute,
} from '../purchase-order';
import { nextPoNumber } from '../po-number-field';
import { sumLineItems } from '../money';

// Award RFQ — the single writer for the RFQ → PO transition. Picks the
// winning quote, re-enforces both award gates the comparison board displays
// (stale quote, lapsed vendor compliance), stamps a PO number, generates the
// threshold-routed approval chain, and copies the winning lines onto a new
// Purchase Order. An auto-route PO (< $1k) is approved immediately and its
// total committed against the linked budget; larger POs start
// pending-approval and commit on final approval instead
// (ApprovePurchaseOrderCommand).

export class AwardRfqInput extends CardDef {
  @field rfq = linksTo(() => Rfq, { searchable: true });
  @field quote = linksTo(() => VendorQuote);
  @field realm = contains(StringField);
}

export class AwardRfqResult extends CardDef {
  @field purchaseOrder = linksTo(() => PurchaseOrder);
  @field message = contains(StringField);
}

export default class AwardRfqCommand extends Command<
  typeof AwardRfqInput,
  typeof AwardRfqResult
> {
  static actionVerb = 'Award';
  static displayName = 'Award RFQ';

  async getInputType() {
    return AwardRfqInput;
  }

  protected async run(input: AwardRfqInput): Promise<AwardRfqResult> {
    let { rfq, quote, realm } = input;
    if (!rfq) {
      throw new Error('An RFQ is required');
    }
    if (!quote) {
      throw new Error('A winning quote is required');
    }
    if (!realm) {
      throw new Error('A realm is required');
    }

    // Re-fetch both subjects before reading links/computed state.
    if (rfq.id) {
      rfq = (await new GetCardCommand(this.commandContext).execute({
        cardId: rfq.id,
      })) as Rfq;
    }
    if (quote.id) {
      quote = (await new GetCardCommand(this.commandContext).execute({
        cardId: quote.id,
      })) as VendorQuote;
    }

    if (rfq.status === 'awarded') {
      throw new Error('This RFQ has already been awarded');
    }
    if (rfq.status === 'cancelled') {
      throw new Error('A cancelled RFQ cannot be awarded');
    }
    if (quote.rfq?.id && rfq.id && quote.rfq.id !== rfq.id) {
      throw new Error('That quote belongs to a different RFQ');
    }
    if (quote.isStale) {
      throw new Error(
        'This quote is past its validity date — ask the vendor to re-confirm pricing first',
      );
    }
    let profile = quote.vendorProfile as VendorProfile | undefined;
    if (profile && !profile.complianceOk) {
      throw new Error(
        `${quote.vendor?.name ?? 'This vendor'} has expired insurance or certifications — refresh compliance before awarding`,
      );
    }

    let total = sumLineItems(quote.lineItems ?? []).total;
    let route: PoApprovalRoute = poApprovalRouteFor(total);
    let roles = PO_ROUTE_STEP_ROLES[route];
    let now = new Date();
    let poNumber = nextPoNumber(now);
    let autoApproved = route === 'auto';

    let expectedDelivery: Date | undefined;
    if (quote.leadTimeDays != null) {
      expectedDelivery = new Date(now);
      expectedDelivery.setDate(expectedDelivery.getDate() + quote.leadTimeDays);
    }

    let budget = rfq.requisition?.budget as ProcurementBudget | undefined;

    let po = (await new SaveCardCommand(this.commandContext).execute({
      card: new PurchaseOrder({
        poNumber,
        status: autoApproved ? 'approved' : 'pending-approval',
        approvalRoute: route,
        vendor: quote.vendor,
        rfq,
        budget,
        expectedDelivery,
      }),
      realm,
    } as any)) as PurchaseOrder;

    // Compound values (line items, the approval chain) are patched as JSON
    // after save — never constructed as field-class instances.
    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: PurchaseOrder,
    }).execute({
      cardId: po.id,
      patch: {
        attributes: {
          lineItems: quote.lineItems,
          approvalChain: {
            startedAt: now.toISOString(),
            steps: roles.map(() => ({
              decision: 'pending',
              openedAt: now.toISOString(),
            })),
          },
        },
      },
    });

    if (autoApproved && budget?.id) {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: ProcurementBudget,
      }).execute({
        cardId: budget.id,
        patch: {
          attributes: {
            committed: (budget.committed ?? 0) + total,
          },
        },
      });
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Rfq,
    }).execute({
      cardId: rfq.id,
      patch: {
        attributes: {
          status: 'awarded',
        },
        relationships: {
          awardedQuote: {
            links: { self: quote.id },
          },
        },
      },
    });

    let message = autoApproved
      ? `${poNumber} created and auto-approved (under threshold) — ${quote.vendor?.name ?? 'vendor'} awarded.`
      : `${poNumber} created for ${quote.vendor?.name ?? 'vendor'} — awaiting ${roles.join(' → ')} approval.`;

    return new AwardRfqResult({ purchaseOrder: po, message });
  }
}
