import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { Shipment } from './shipment';
import { FulfilmentOrder } from './fulfilment-order';
import type { Carrier } from './carrier';
import { quoteService } from './carrier';

export class DispatchShipmentInput extends CardDef {
  @field shipmentId = contains(StringField);
  @field serviceCode = contains(StringField);
  @field trackingNumber = contains(StringField);
}

export class DispatchShipmentResult extends CardDef {
  @field shipmentId = contains(StringField);
  @field trackingNumber = contains(StringField);
  @field serviceLevel = contains(StringField);
  @field quotedCost = contains(NumberField);
  @field billableWeight = contains(NumberField);
  @field estimatedDelivery = contains(StringField);
}

// A delivery date is a calendar day. Building it out of getFullYear/getMonth/
// getDate rather than toISOString is what keeps a package promised for the 15th
// from being recorded as the 14th anywhere east of UTC.
function addDays(days: number): string {
  let d = new Date();
  d.setDate(d.getDate() + days);
  let month = String(d.getMonth() + 1).padStart(2, '0');
  let day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Dispatch Shipment (DS) — the single writer of "this package is with the
// carrier".
//
// Everything it stamps onto the shipment is a SNAPSHOT: carrier name, service
// name, tracking URL pattern, dimensional divisor, quoted cost. The carrier
// card can be renamed or repriced next year without rewriting what happened to
// a package that has already gone.
//
// It also owns the order's transition to `shipped`, because a shipment
// existing and an order claiming to be shipped must never disagree — and the
// way to guarantee that is for one piece of code to write both.
export default class DispatchShipmentCommand extends Command<
  typeof DispatchShipmentInput,
  typeof DispatchShipmentResult
> {
  static actionVerb = 'Dispatch';
  description =
    'Hand a packed shipment to its carrier: stamp the service, tracking number, quoted cost and delivery window, and move the order to shipped.';

  async getInputType() {
    return DispatchShipmentInput;
  }

  protected async run(
    input: DispatchShipmentInput,
  ): Promise<DispatchShipmentResult> {
    let shipmentId = input.shipmentId?.trim();
    if (!shipmentId) {
      throw new Error('shipmentId is required');
    }
    let trackingNumber = input.trackingNumber?.trim();
    if (!trackingNumber) {
      throw new Error(
        'trackingNumber is required — a dispatched package without one cannot be tracked or chased',
      );
    }

    // Re-fetch rather than trusting what the caller handed over: a caller may
    // pass a shipment whose linked carrier was never loaded, and reading
    // `.carrier` off that gives undefined rather than an error.
    let shipment = (await new GetCardCommand(this.toolContext).execute({
      cardId: shipmentId,
    })) as Shipment;

    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    let carrierId = shipment.carrier?.id;
    if (!carrierId) {
      throw new Error(
        `Shipment ${shipment.shipmentNumber ?? shipmentId} has no carrier. Choose one on the ship desk before dispatching.`,
      );
    }

    let carrier = (await new GetCardCommand(this.toolContext).execute({
      cardId: carrierId,
    })) as Carrier;

    let serviceCode = input.serviceCode?.trim();
    let service =
      (carrier.services ?? []).find((s) => s?.code === serviceCode) ??
      carrier.cheapestService;

    if (!service) {
      throw new Error(
        `${carrier.carrierName ?? 'This carrier'} has no priced services configured, so no rate can be quoted.`,
      );
    }

    // Volumetric weight depends on the carrier's divisor, so the parcel gets
    // the divisor stamped on it before the billable weight is read back.
    let parcel = shipment.parcel;
    let divisor = carrier.dimDivisor ?? parcel?.dimDivisor ?? null;
    let volume =
      parcel?.length && parcel?.width && parcel?.height
        ? parcel.length * parcel.width * parcel.height
        : undefined;
    let volumetric =
      volume && divisor ? Math.round((volume / divisor) * 100) / 100 : 0;
    let billableWeight = Math.max(parcel?.weight ?? 0, volumetric);

    let quotedCost = quoteService(service, billableWeight) ?? 0;
    let daysMin = service.deliveryDaysMin ?? 1;
    let daysMax = service.deliveryDaysMax ?? daysMin;
    let earliest = addDays(daysMin);
    let latest = addDays(daysMax);
    let now = new Date().toISOString();

    let existingEvents = (shipment.trackingEvents ?? []).map((e) => ({
      occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
      statusCode: e.statusCode ?? null,
      statusDescription: e.statusDescription ?? null,
      location: e.location ?? null,
      isDelivered: e.isDelivered ?? false,
    }));

    // Compound values (tracking number, parcel, delivery window, the event log)
    // are patched as JSON rather than constructed as field instances.
    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Shipment,
    }).execute({
      cardId: shipmentId,
      patch: {
        attributes: {
          status: 'in_transit',
          shippedAt: now,
          serviceLevel: service.serviceName ?? service.code ?? null,
          carrierName: carrier.carrierName ?? null,
          shippingCost: {
            amount: quotedCost,
            currency: { code: service.baseRate?.currency?.code ?? 'GBP' },
          },
          trackingNumber: {
            number: trackingNumber,
            carrierCode: carrier.code ?? null,
            trackingUrlPattern: carrier.trackingUrlPattern ?? null,
          },
          parcel: {
            length: parcel?.length ?? null,
            width: parcel?.width ?? null,
            height: parcel?.height ?? null,
            weight: parcel?.weight ?? null,
            dimDivisor: divisor,
          },
          deliveryWindow: {
            earliest,
            latest,
            commitment: service.serviceName ?? null,
          },
          trackingEvents: [
            ...existingEvents,
            {
              occurredAt: now,
              statusCode: 'DISPATCH',
              statusDescription: 'Handed to carrier',
              location: shipment.originWarehouse?.address?.city ?? null,
              isDelivered: false,
            },
          ],
        },
      },
    });

    // The order follows the package. Only orders still in the pipeline are
    // moved: an order already delivered or cancelled is not walked backwards by
    // a late dispatch on a second shipment.
    let orderId = shipment.order?.id;
    if (orderId) {
      let order = (await new GetCardCommand(this.toolContext).execute({
        cardId: orderId,
      })) as FulfilmentOrder;
      let movable = ['pending', 'processing', 'picking', 'packing'];
      if (movable.includes(order.status ?? '')) {
        await new PatchCardInstanceCommand(this.toolContext, {
          cardType: FulfilmentOrder,
        }).execute({
          cardId: orderId,
          patch: { attributes: { status: 'shipped' } },
        });
      }
    }

    let result = new DispatchShipmentResult();
    result.shipmentId = shipmentId;
    result.trackingNumber = trackingNumber;
    result.serviceLevel = service.serviceName ?? undefined;
    result.quotedCost = quotedCost;
    result.billableWeight = billableWeight;
    result.estimatedDelivery = latest;
    return result;
  }
}
