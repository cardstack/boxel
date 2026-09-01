import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import CurrencyField from '@cardstack/base/currency';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { CollectionItem } from './collection-item';
import { Listing } from './listing';

export class CreateListingInput extends CardDef {
  @field collectionItemId = contains(StringField);
  @field price = contains(NumberField);
  @field currency = contains(StringField);
  @field shippingPrice = contains(NumberField);
  @field shipsFrom = contains(StringField);
}

export class CreateListingResult extends CardDef {
  @field listingId = contains(StringField);
}

// Create Listing (CL) — marks an owned copy for sale.
//
// THE COLLECTION ITEM'S `forSale` FLAG IS A COMPUTED READ OF `listedAt`, so
// this command writes `listedAt`, never a boolean — same rule
// `collection-item.gts`'s header applies to `verified`: a threshold flag is
// an event fact, and storing the boolean separately is how it drifts from
// the listing that actually caused it.
export default class CreateListingCommand extends Command<
  typeof CreateListingInput,
  typeof CreateListingResult
> {
  static actionVerb = 'Create listing';
  description =
    'List an owned collection item for sale at a given price, denormalizing the seller and product from it.';

  async getInputType() {
    return CreateListingInput;
  }

  protected async run(input: CreateListingInput): Promise<CreateListingResult> {
    let collectionItemId = input.collectionItemId?.trim();
    if (!collectionItemId) {
      throw new Error('collectionItemId is required');
    }
    if (input.price == null) {
      throw new Error('price is required');
    }

    let collectionItem = (await new GetCardCommand(this.toolContext).execute({
      cardId: collectionItemId,
    })) as CollectionItem;
    if (!collectionItem) {
      throw new Error(`CollectionItem not found: ${collectionItemId}`);
    }
    if (!collectionItem.owner) {
      throw new Error(
        `CollectionItem ${collectionItemId} has no owner to list as seller`,
      );
    }
    if (collectionItem.forSale) {
      throw new Error(`CollectionItem ${collectionItemId} is already for sale`);
    }

    let currency = new CurrencyField({ code: input.currency?.trim() || 'USD' });
    let now = new Date();

    let listing = new Listing();
    listing.collectionItem = collectionItem;
    listing.product = collectionItem.item;
    listing.price = new AmountWithCurrency({ amount: input.price, currency });
    listing.shippingPrice = new AmountWithCurrency({
      amount: input.shippingPrice ?? 0,
      currency,
    });
    listing.listingStatus = 'active';
    listing.shipsFrom = input.shipsFrom?.trim() || '';
    listing.seller = collectionItem.owner;
    listing.listedAt = now;

    // Save into the SOURCE card's own realm. Without `realm`, SaveCard
    // defaults to the base realm and the write 401s — verified live when a
    // ProcessPayment run tried to save its Payment to cardstack.com/base/.
    let realm = (collectionItem as any)?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: listing,
      realm,
    })) as Listing;

    await new PatchCardInstanceCommand(this.toolContext, {
      cardType: CollectionItem,
    }).execute({
      cardId: collectionItemId,
      patch: { attributes: { listedAt: now.toISOString().slice(0, 10) } },
    });

    let result = new CreateListingResult();
    result.listingId = saved.id;
    return result;
  }
}
