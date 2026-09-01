import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Order, canOrderTransition } from './sole-vault-order';
import { Shipment, canShipmentTransition } from './sole-vault-shipment';

export class MarkDeliveredInput extends CardDef {
  @field shipmentId = contains(StringField);
}

export class MarkDeliveredResult extends CardDef {
  @field shipmentId = contains(StringField);
  @field orderId = contains(StringField);
  @field orderStatus = contains(StringField);
}

// Mark Delivered (MD) — a carrier scan lands this leg.
//
// LEG-AWARE, BECAUSE THE ORDER GRAPH IS. The spec's two-leg route (seller →
// auth centre → buyer) means "delivered" means two different things to the
// Order depending on WHICH leg just arrived:
//   * the seller-to-auth leg landing is "item received at the auth centre" —
//     the Order moves `shipped` → `authenticating`, NOT to `delivered`.
//   * the auth-to-buyer leg landing is delivery to the actual buyer — the
//     Order moves `authenticating` → `delivered`.
// Reading `shipment.leg` rather than always advancing to the "next" status is
// what keeps a first-leg scan from wrongly reporting the whole order as
// delivered to the buyer.
//
// HONEST GAP: `delivered` → `completed` (the buyer's own "I received it and
// it's fine" confirmation that releases funds) has no command here. The
// spec's ten-tool list names no such command — the closest is this one — so
// it is left an explicit, undone edge rather than silently folded into a
// carrier-scan event, which is not the same fact as a buyer confirming
// receipt.
export default class MarkDeliveredCommand extends Command<
  typeof MarkDeliveredInput,
  typeof MarkDeliveredResult
> {
  static actionVerb = 'Mark delivered';
  description =
    'Record a shipment leg as delivered and advance the order status appropriately for that leg.';

  async getInputType() {
    return MarkDeliveredInput;
  }

  protected async run(input: MarkDeliveredInput): Promise<MarkDeliveredResult> {
    let shipmentId = input.shipmentId?.trim();
    if (!shipmentId) {
      throw new Error('shipmentId is required');
    }

    let shipment = (await new GetCardCommand(this.toolContext).execute({
      cardId: shipmentId,
    })) as Shipment;
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    if (!canShipmentTransition(shipment.shipmentStatus, 'delivered')) {
      throw new Error(
        `Shipment ${shipmentId} cannot move from ${shipment.shipmentStatus} to delivered`,
      );
    }

    let now = new Date();
    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Shipment,
    }).execute({
      cardId: shipmentId,
      patch: {
        attributes: {
          shipmentStatus: 'delivered',
          deliveredAt: now.toISOString().slice(0, 10),
        },
      },
    });

    let result = new MarkDeliveredResult();
    result.shipmentId = shipmentId;

    let orderId = shipment.order?.id;
    if (!orderId) {
      // A shipment with no order is a real state — nothing more to advance.
      return result;
    }
    result.orderId = orderId;

    let order = (await new GetCardCommand(this.toolContext).execute({
      cardId: orderId,
    })) as Order;

    let nextOrderStatus =
      shipment.leg === 'auth-to-buyer' ? 'delivered' : 'authenticating';

    if (!canOrderTransition(order.orderStatus, nextOrderStatus)) {
      // The shipment leg still gets recorded above; the order simply does not
      // move (e.g. a second scan on an already-advanced order).
      result.orderStatus = order.orderStatus ?? undefined;
      return result;
    }

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Order,
    }).execute({
      cardId: orderId,
      patch: {
        attributes:
          nextOrderStatus === 'authenticating'
            ? { orderStatus: 'authenticating' }
            : {
                orderStatus: 'delivered',
                deliveredAt: now.toISOString().slice(0, 10),
              },
      },
    });

    result.orderStatus = nextOrderStatus;
    return result;
  }
}
