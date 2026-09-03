import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import DateTimeField from '@cardstack/base/datetime';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { PropertyListing } from '../property-listing';
import {
  PUBLISH_CHANNELS,
  PUBLISH_CHANNEL_LABELS,
} from '../components/channel-selector';

// Publish Listing — the single writer for a property listing's go-live.
// A listing may not publish half-dressed: it needs an address, an asking
// price, and at least one photo (buyers do not click photo-less listings).
// Publication stamps `publishedAt` once (event fact) and flips the status;
// later lifecycle moves (under offer, sold, withdrawn) are status edits on
// the card, but the publish moment itself never rewrites.
//
// Publishing is SIMULATED (no broker credentials, no real MLS API): the
// command waits a realistic beat, mints a mock MLS number, and reports
// every selected channel as a success. Real syndication would replace only
// the middle of `run` — the guards and the patch stay.

// The channel vocabulary lives in the (leaf) channel-selector module so the
// listing's isolated view can mount the selector without a module cycle;
// re-exported here so command consumers keep one import site.
export { PUBLISH_CHANNELS, PUBLISH_CHANNEL_LABELS };

// One channel's outcome. `resultStatus`, not `status`: a nested field named
// `status` inherits the ROOT card's status configuration (field-component
// resolves configuration by field name against the owning card), so the
// enum dropdown would show the listing's ladder here.
export class ChannelResultField extends FieldDef {
  static displayName = 'Channel Result';

  @field channel = contains(StringField);
  @field label = contains(StringField);
  @field resultStatus = contains(StringField); // 'success' | 'failed' | 'pending' | 'skipped'
  @field externalId = contains(StringField);
  @field url = contains(StringField);
}

export class PublishListingInput extends CardDef {
  @field listing = linksTo(() => PropertyListing, { searchable: true });
  // Channels to publish to (values from PUBLISH_CHANNELS). MLS is the
  // required primary — it is unioned in even when the caller omits it,
  // because syndication to the portals hangs off the MLS entry.
  @field channels = containsMany(StringField);
  // Optional deferred go-live. A realm has no background scheduler, so a
  // future date records the intent and the command declines to publish —
  // see the scheduled branch in `run`.
  @field scheduledDate = contains(DateTimeField);
}

export class PublishListingResult extends CardDef {
  @field message = contains(StringField);
  @field publishedAtIso = contains(StringField);
  @field mlsNumber = contains(StringField);
  @field scheduled = contains(BooleanField);
  @field channelResults = containsMany(ChannelResultField);
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
    if (
      listing.status &&
      listing.status !== 'draft' &&
      listing.status !== 'prepared'
    ) {
      throw new Error(
        `Only a draft or prepared listing can be published (this one is "${listing.status}")`,
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
        'Add at least one photo before publishing (10+ recommended) — photo-less listings do not get viewings',
      );
    }

    // MLS is always in the set: the portals syndicate FROM it.
    let channels = [
      ...new Set(['mls', ...(input.channels ?? []).filter(Boolean)]),
    ].filter((c) => PUBLISH_CHANNELS.includes(c));

    // Deferred go-live: record the intent, publish nothing. A realm has no
    // scheduler to fire later, so the agent re-runs the command after the
    // moment passes — the listing itself is untouched (status and
    // publishedAt unchanged), so nothing needs unwinding if plans change.
    let scheduledDate = input.scheduledDate
      ? new Date(input.scheduledDate)
      : undefined;
    if (scheduledDate && scheduledDate.getTime() > Date.now()) {
      let when = scheduledDate.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      return new PublishListingResult({
        message: `"${listing.cardTitle}" is scheduled for ${when} — run Publish again after that time.`,
        scheduled: true,
        channelResults: channels.map(
          (channel) =>
            new ChannelResultField({
              channel,
              label: PUBLISH_CHANNEL_LABELS[channel] ?? channel,
              resultStatus: 'pending',
            }),
        ),
      });
    }

    // Simulated syndication: a realistic beat, then a minted MLS number.
    await new Promise((resolve) =>
      setTimeout(resolve, 2000 + Math.random() * 1000),
    );
    let mlsDigits =
      listing.mlsNumber?.replace(/\D/g, '') ||
      String(Math.floor(10000000 + Math.random() * 90000000));
    let mlsNumber = listing.mlsNumber?.trim() || `MLS-${mlsDigits}`;

    let channelResults = channels.map((channel) => {
      let externalId: string;
      let url: string;
      switch (channel) {
        case 'mls':
          externalId = mlsNumber;
          url = `https://mls.example.com/listing/${mlsDigits}`;
          break;
        case 'zillow':
          externalId = `zpid-${mlsDigits.slice(0, 6)}`;
          url = `https://zillow.example.com/homes/${mlsDigits.slice(0, 6)}`;
          break;
        case 'realtor':
          externalId = `rc-${mlsDigits.slice(2)}`;
          url = `https://realtor.example.com/property/${mlsDigits.slice(2)}`;
          break;
        case 'redfin':
          externalId = `rf-${mlsDigits.slice(0, 7)}`;
          url = `https://redfin.example.com/home/${mlsDigits.slice(0, 7)}`;
          break;
        default:
          externalId = `${channel}-${mlsDigits.slice(0, 5)}`;
          url = `https://${channel}.example.com/post/${mlsDigits.slice(0, 5)}`;
      }
      return new ChannelResultField({
        channel,
        label: PUBLISH_CHANNEL_LABELS[channel] ?? channel,
        resultStatus: 'success',
        externalId,
        url,
      });
    });

    let publishedAtIso = new Date().toISOString();
    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: PropertyListing,
    }).execute({
      cardId: listing.id,
      patch: {
        attributes: {
          status: 'published',
          publishedAt: publishedAtIso,
          mlsNumber,
        },
      },
    });

    return new PublishListingResult({
      message: `"${listing.cardTitle}" is live on ${channels.length} channel${channels.length === 1 ? '' : 's'} with ${photoCount} photo${photoCount === 1 ? '' : 's'}. ${mlsNumber}.`,
      publishedAtIso,
      mlsNumber,
      scheduled: false,
      channelResults,
    });
  }
}
