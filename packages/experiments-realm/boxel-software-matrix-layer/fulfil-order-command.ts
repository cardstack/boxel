import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Shipment } from './shipment';
import { FulfilmentOrder } from './fulfilment-order';

export class FulfilOrderInput extends CardDef {
  @field shipmentId = contains(StringField);
  @field proofOfDelivery = contains(StringField);
}

export class FulfilOrderResult extends CardDef {
  @field orderId = contains(StringField);
  @field orderNumber = contains(StringField);
  @field fulfilledAt = contains(StringField);
  @field wasAlreadyFulfilled = contains(BooleanField);
  @field unitsFulfilled = contains(NumberField);
}

// Fulfil Order (FO) — closes the loop when a package lands.
//
// `fulfilledAt` is an EVENT FACT: the datetime the order first completed,
// written exactly once and never moved. A second delivery on a split shipment
// does not rewrite it, so "how long did this order take" keeps answering the
// same thing forever. The boolean "is it fulfilled" is a question about that
// date, not a separate flag that can drift out of step with it.
export default class FulfilOrderCommand extends Command<
  typeof FulfilOrderInput,
  typeof FulfilOrderResult
> {
  static actionVerb = 'Mark delivered';
  description =
    'Record a shipment as delivered and, if nothing is left outstanding, complete its order — stamping the fulfilment date once.';

  async getInputType() {
    return FulfilOrderInput;
  }

  protected async run(input: FulfilOrderInput): Promise<FulfilOrderResult> {
    let shipmentId = input.shipmentId?.trim();
    if (!shipmentId) {
      throw new Error('shipmentId is required');
    }

    // Re-fetch: the caller's copy may never have loaded the order link.
    let shipment = (await new GetCardCommand(this.toolContext).execute({
      cardId: shipmentId,
    })) as Shipment;

    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    let now = new Date().toISOString();
    let existingEvents = (shipment.trackingEvents ?? []).map((e) => ({
      occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
      statusCode: e.statusCode ?? null,
      statusDescription: e.statusDescription ?? null,
      location: e.location ?? null,
      isDelivered: e.isDelivered ?? false,
    }));

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Shipment,
    }).execute({
      cardId: shipmentId,
      patch: {
        attributes: {
          status: 'delivered',
          deliveredAt: now,
          proofOfDelivery: input.proofOfDelivery?.trim() || null,
          trackingEvents: [
            ...existingEvents,
            {
              occurredAt: now,
              statusCode: 'DL',
              statusDescription: 'Delivered',
              location: null,
              isDelivered: true,
            },
          ],
        },
      },
    });

    let result = new FulfilOrderResult();
    result.wasAlreadyFulfilled = false;
    result.unitsFulfilled = (shipment.lineItems ?? []).reduce(
      (sum, l) => sum + (l?.quantity ?? 0),
      0,
    );

    let orderId = shipment.order?.id;
    if (!orderId) {
      // A shipment with no order is a real state (a sample sent out, a
      // replacement) — not an error, just nothing more to close.
      return result;
    }

    let order = (await new GetCardCommand(this.toolContext).execute({
      cardId: orderId,
    })) as FulfilmentOrder;

    result.orderId = orderId;
    result.orderNumber = order.orderNumber ?? undefined;

    if (order.fulfilledAt) {
      // Monotonic: already stamped, so the date stands. The order's status is
      // still moved in case a later shipment arrived after a partial delivery.
      result.wasAlreadyFulfilled = true;
      result.fulfilledAt = order.fulfilledAt.toISOString();
      return result;
    }

    // Marking every line fulfilled in the same write as the date keeps the two
    // from disagreeing — the outstanding count is what the returns and partial-
    // ship views read.
    let lineItems = (order.lineItems ?? []).map((l) => ({
      sku: l.sku ?? null,
      productName: l.productName ?? null,
      quantity: l.quantity ?? null,
      quantityFulfilled: l.quantity ?? null,
      unitPrice: l.unitPrice?.amount
        ? {
            amount: l.unitPrice.amount,
            currency: { code: l.unitPrice.currency?.code ?? 'GBP' },
          }
        : null,
    }));

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: FulfilmentOrder,
    }).execute({
      cardId: orderId,
      patch: {
        attributes: {
          status: 'delivered',
          fulfilledAt: now,
          lineItems,
        },
      },
    });

    result.fulfilledAt = now;
    return result;
  }
}
