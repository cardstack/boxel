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

import { GoodsReceipt } from '../goods-receipt';
import { PurchaseOrder } from '../purchase-order';
import { ProcurementBudget } from '../procurement-budget';
import { lineTotal } from '../money';

// Receive Goods — posts a draft Goods Receipt against its PO: the two-way
// match. Receipts accumulate (partial receiving): the PO carries
// `receivedQuantities` per line, this command adds the receipt's quantities
// on top, snapshots each line's ordered quantity onto the receipt (audit
// document), flips the PO to received / partially-received, and moves the
// received value from the budget's `committed` to `actual`. Over-receipt is
// allowed but requires a note on the line, and never moves more than the
// ordered value through the budget.

export class ReceiveGoodsInput extends CardDef {
  @field receipt = linksTo(() => GoodsReceipt, { searchable: true });
}

export class ReceiveGoodsResult extends CardDef {
  @field message = contains(StringField);
}

export default class ReceiveGoodsCommand extends Command<
  typeof ReceiveGoodsInput,
  typeof ReceiveGoodsResult
> {
  static actionVerb = 'Post Receipt';
  static displayName = 'Receive Goods';

  async getInputType() {
    return ReceiveGoodsInput;
  }

  protected async run(input: ReceiveGoodsInput): Promise<ReceiveGoodsResult> {
    let { receipt } = input;
    if (!receipt) {
      throw new Error('A goods receipt is required');
    }
    if (receipt.id) {
      receipt = (await new GetCardCommand(this.commandContext).execute({
        cardId: receipt.id,
      })) as GoodsReceipt;
    }
    if (receipt.posted) {
      throw new Error('This receipt has already been posted');
    }
    let receiptLines = (receipt.lines ?? []).filter(Boolean);
    if (!receiptLines.length) {
      throw new Error('Record at least one received line before posting');
    }
    let po = receipt.purchaseOrder as PurchaseOrder | undefined;
    if (!po) {
      throw new Error('Link this receipt to a purchase order first');
    }
    if (po.id) {
      po = (await new GetCardCommand(this.commandContext).execute({
        cardId: po.id,
      })) as PurchaseOrder;
    }
    if (!['approved', 'sent', 'partially-received'].includes(po.status ?? '')) {
      throw new Error(
        `Goods can only be received against an approved/sent PO (this one is "${po.status ?? 'draft'}")`,
      );
    }

    let poLines = (po.lineItems ?? []).filter(Boolean);
    if (receiptLines.length > poLines.length) {
      throw new Error(
        `This receipt has ${receiptLines.length} lines but the PO has only ${poLines.length}`,
      );
    }

    let prior = poLines.map((_, i) => po!.receivedQuantities?.[i] ?? 0);
    let newReceived = [...prior];
    let movedValue = 0;

    let snapshotLines = receiptLines.map((line, i) => {
      let ordered = poLines[i]?.quantity ?? 0;
      let qty = line.qtyReceived ?? 0;
      let already = prior[i];
      let willHave = already + qty;
      if (willHave > ordered && !line.note?.trim()) {
        throw new Error(
          `Line ${i + 1} (${poLines[i]?.description ?? 'item'}) would be over-received (${willHave}/${ordered}) — add a note explaining the overage first`,
        );
      }
      newReceived[i] = willHave;
      // Budget movement clamps at the ordered value: overage is flagged,
      // not paid for.
      let payableQty = Math.max(0, Math.min(qty, ordered - already));
      movedValue += lineTotal({
        quantity: payableQty,
        unitPrice: poLines[i]?.unitPrice,
      } as any);
      return {
        description: poLines[i]?.description ?? line.description,
        qtyOrdered: ordered,
        qtyReceived: qty,
        note: line.note,
      };
    });

    let fullyReceived = poLines.every(
      (l, i) => newReceived[i] >= (l.quantity ?? 0),
    );

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: PurchaseOrder,
    }).execute({
      cardId: po.id,
      patch: {
        attributes: {
          receivedQuantities: newReceived,
          status: fullyReceived ? 'received' : 'partially-received',
        },
      },
    });

    let budget = po.budget as ProcurementBudget | undefined;
    if (budget?.id && movedValue > 0) {
      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: ProcurementBudget,
      }).execute({
        cardId: budget.id,
        patch: {
          attributes: {
            committed: Math.max(0, (budget.committed ?? 0) - movedValue),
            actual: (budget.actual ?? 0) + movedValue,
          },
        },
      });
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: GoodsReceipt,
    }).execute({
      cardId: receipt.id,
      patch: {
        attributes: {
          posted: true,
          lines: snapshotLines,
        },
      },
    });

    return new ReceiveGoodsResult({
      message: fullyReceived
        ? `${po.poNumber ?? 'PO'} fully received — $${movedValue.toLocaleString('en-US')} moved from committed to actual.`
        : `Partial receipt posted against ${po.poNumber ?? 'PO'} — $${movedValue.toLocaleString('en-US')} moved committed → actual.`,
    });
  }
}
