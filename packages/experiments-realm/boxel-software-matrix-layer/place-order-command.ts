import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { Listing } from './listing';
import { Order } from './sole-vault-order';

export class PlaceOrderInput extends CardDef {
  @field listingId = contains(StringField);
  @field buyerId = contains(StringField);
}

export class PlaceOrderResult extends CardDef {
  @field orderId = contains(StringField);
  @field reference = contains(StringField);
}

// Place Order (PO) — a buyer commits to a listing.
//
// FEES ARE SNAPSHOTS, PICKED HERE, NOT A RATE RE-DERIVED LATER. The auth fee
// and platform-fee percentage are the checkout's own numbers, applied once at
// order-creation time (matching the spec's sample checkout: a flat $10
// authentication fee, a 3% platform fee) — see `order.gts`'s header note on
// why `Order.platformFee` holds the money actually charged, never "3%".
//
// LISTING GOES `sold` HERE, NOT ON PAYMENT. `ListingStatusField`'s own
// `active` meaning is "visible to buyers and accepting offers"; `sold` means
// "a buyer committed — the item is spoken for". That commitment happens the
// moment an order is placed, before money moves, which is why this command —
// not ProcessPayment — is the one that flips it.
// `AmountWithCurrency.amount` is a decimal figure in the currency's own major
// unit (dollars, not cents — see `money-format.ts`'s header note on why this
// realm never scales to minor units), so $10.00 is the literal number 10.
const AUTH_FEE_AMOUNT = 10; // $10.00, flat, per the spec's sample checkout
const PLATFORM_FEE_RATE = 0.03; // 3%, per the spec's sample checkout

export default class PlaceOrderCommand extends Command<
  typeof PlaceOrderInput,
  typeof PlaceOrderResult
> {
  static actionVerb = 'Place order';
  description =
    'Create an order from an active listing, snapshotting price and fees, and mark the listing sold.';

  async getInputType() {
    return PlaceOrderInput;
  }

  protected async run(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    let listingId = input.listingId?.trim();
    let buyerId = input.buyerId?.trim();
    if (!listingId) {
      throw new Error('listingId is required');
    }
    if (!buyerId) {
      throw new Error('buyerId is required');
    }

    let listing = (await new GetCardCommand(this.toolContext).execute({
      cardId: listingId,
    })) as Listing;
    if (!listing) {
      throw new Error(`Listing not found: ${listingId}`);
    }
    if (listing.listingStatus !== 'active') {
      throw new Error(
        `Listing ${listingId} is not active (status: ${listing.listingStatus}) — cannot place an order against it`,
      );
    }
    if (!listing.price?.amount || !listing.price?.currency) {
      throw new Error(`Listing ${listingId} has no price set`);
    }
    let sellerId = listing.seller?.id;
    if (!sellerId) {
      throw new Error(`Listing ${listingId} has no seller`);
    }

    let currency = listing.price.currency;
    let priceAmount = listing.price.amount;
    let shippingAmount = listing.shippingPrice?.amount ?? 0;
    let authFeeAmount = AUTH_FEE_AMOUNT;
    // Rounded to the nearest cent, not the nearest dollar — `amount` carries
    // two decimal places.
    let platformFeeAmount =
      Math.round(priceAmount * PLATFORM_FEE_RATE * 100) / 100;

    let now = new Date();
    let reference = `SV-${now.getFullYear()}-${Math.floor(
      1000 + Math.random() * 9000,
    )}`;

    let order = new Order();
    order.reference = reference;
    order.listing = listing;
    order.buyer = (await new GetCardCommand(this.toolContext).execute({
      cardId: buyerId,
    })) as any;
    order.seller = listing.seller;
    // Real AmountWithCurrency instances, not `{ amount, currency }` literals
    // — a plain object throws when the searchable walker's peekAtField
    // reaches it (see order.gts's `total` computeVia for the same note).
    order.price = new AmountWithCurrency({ amount: priceAmount, currency });
    order.shippingPrice = new AmountWithCurrency({
      amount: shippingAmount,
      currency,
    });
    order.authFee = new AmountWithCurrency({
      amount: authFeeAmount,
      currency,
    });
    order.platformFee = new AmountWithCurrency({
      amount: platformFeeAmount,
      currency,
    });
    order.orderStatus = 'pending-payment';
    order.placedAt = now;

    let realm = listing[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: order,
      realm,
    })) as Order;

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: Listing,
    }).execute({
      cardId: listingId,
      patch: {
        attributes: {
          listingStatus: 'sold',
          soldAt: now.toISOString().slice(0, 10),
        },
      },
    });

    let result = new PlaceOrderResult();
    result.orderId = saved.id;
    result.reference = reference;
    return result;
  }
}
