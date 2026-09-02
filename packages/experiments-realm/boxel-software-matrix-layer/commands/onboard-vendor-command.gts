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

import { Vendor } from '../vendor';
import { VendorProfile } from '../vendor-profile';

// Onboard Vendor — the single writer for the profile → vendor transition.
// Converts an APPROVED, compliance-current VendorProfile into an active
// Vendor record, links the two, and stamps the profile `onboarded`. The
// command enforces the same gate the RFQ comparison board displays: a
// profile with expired insurance or certifications cannot onboard, because
// an award-ineligible vendor should never enter the invitable pool.

export class OnboardVendorInput extends CardDef {
  @field profile = linksTo(() => VendorProfile, { searchable: true });
  @field realm = contains(StringField);
}

export class OnboardVendorResult extends CardDef {
  @field vendor = linksTo(() => Vendor);
  @field message = contains(StringField);
}

export default class OnboardVendorCommand extends Command<
  typeof OnboardVendorInput,
  typeof OnboardVendorResult
> {
  static actionVerb = 'Onboard Vendor';
  static displayName = 'Onboard Vendor';

  async getInputType() {
    return OnboardVendorInput;
  }

  protected async run(input: OnboardVendorInput): Promise<OnboardVendorResult> {
    let { profile, realm } = input;
    if (!profile) {
      throw new Error('A vendor profile is required');
    }
    if (!realm) {
      throw new Error('A realm is required');
    }

    // Re-fetch the subject before reading its links/computed state — the
    // caller may pass a card whose fields were never loaded.
    if (profile.id) {
      profile = (await new GetCardCommand(this.commandContext).execute({
        cardId: profile.id,
      })) as VendorProfile;
    }

    if (profile.status !== 'approved') {
      throw new Error(
        `Only an "approved" profile can be onboarded (this one is "${profile.status ?? 'intake'}")`,
      );
    }
    if (!profile.complianceOk) {
      throw new Error(
        'This profile has expired insurance or certifications — refresh compliance documents before onboarding',
      );
    }
    if (profile.linkedVendor?.id) {
      throw new Error(
        `${profile.companyName ?? 'This profile'} is already onboarded as an active vendor`,
      );
    }

    let vendor = (await new SaveCardCommand(this.commandContext).execute({
      card: new Vendor({
        name: profile.companyName,
        contactName: profile.contactName,
        email: profile.email,
        serviceCategory: profile.serviceCategory,
        contractStart: new Date(),
      }),
      realm,
    } as any)) as Vendor;

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: VendorProfile,
    }).execute({
      cardId: profile.id,
      patch: {
        attributes: {
          status: 'onboarded',
        },
        relationships: {
          linkedVendor: {
            links: { self: vendor.id },
          },
        },
      },
    });

    return new OnboardVendorResult({
      vendor,
      message: `${profile.companyName ?? 'Vendor'} onboarded as an active vendor.`,
    });
  }
}
