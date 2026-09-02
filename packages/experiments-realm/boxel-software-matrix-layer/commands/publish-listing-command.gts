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

import { PropertyListing } from '../property-listing';

// Publish Listing — the single writer for a property listing's go-live.
// A listing may not publish half-dressed: it needs an address, an asking
// price, and at least one photo (buyers do not click photo-less listings).
// Publication stamps `publishedAt` once (event fact) and flips the status;
// later lifecycle moves (under offer, sold, withdrawn) are status edits on
// the card, but the publish moment itself never rewrites.

export class PublishListingInput extends CardDef {
  @field listing = linksTo(() => PropertyListing, { searchable: true });
}

export class PublishListingResult extends CardDef {
  @field message = contains(StringField);
}

export default class PublishListingCommand extends Command<
  typeof PublishListingInput,
  typeof PublishListingResult
> {
  static actionVerb = 'Publish';
  static displayName = 'Publish Listing';

  async getInputType() {
    return PublishListingInput;
  }

  protected async run(
    input: PublishListingInput,
  ): Promise<PublishListingResult> {
    let { listing } = input;
    if (!listing) {
      throw new Error('A property listing is required');
    }
    if (listing.id) {
      listing = (await new GetCardCommand(this.commandContext).execute({
        cardId: listing.id,
      })) as PropertyListing;
    }
    if (listing.status && listing.status !== 'draft') {
      throw new Error(
        `Only a draft listing can be published (this one is "${listing.status}")`,
      );
    }
    if (listing.publishedAt) {
      throw new Error('This listing has already been published');
    }
    if (
      !listing.address?.addressLine1?.trim() ||
      !listing.address?.city?.trim()
    ) {
      throw new Error('Complete the address before publishing');
    }
    if (listing.askingPrice?.amount == null) {
      throw new Error('Set an asking price before publishing');
    }
    let photoCount = (listing.photos?.resolvedUrls ?? []).filter(
      Boolean,
    ).length;
    if (!photoCount) {
      throw new Error(
        'Add at least one photo before publishing — photo-less listings do not get viewings',
      );
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: PropertyListing,
    }).execute({
      cardId: listing.id,
      patch: {
        attributes: {
          status: 'published',
          publishedAt: new Date().toISOString(),
        },
      },
    });

    return new PublishListingResult({
      message: `"${listing.cardTitle}" is live with ${photoCount} photo${photoCount === 1 ? '' : 's'}.`,
    });
  }
}
