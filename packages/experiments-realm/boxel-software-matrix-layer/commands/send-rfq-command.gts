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

import { Rfq } from '../rfq';

// Send RFQ — flips a draft RFQ to `sent` once it is actually sendable
// (has lines and at least one invited vendor). Single-persona rule: there is
// no vendor delivery channel here — "sending" marks the ask as issued; the
// buyer transmits it by email/portal outside the system and records the
// inbound quotes themselves.

export class SendRfqInput extends CardDef {
  @field rfq = linksTo(() => Rfq, { searchable: true });
}

export class SendRfqResult extends CardDef {
  @field message = contains(StringField);
}

export default class SendRfqCommand extends Command<
  typeof SendRfqInput,
  typeof SendRfqResult
> {
  static actionVerb = 'Send RFQ';
  static displayName = 'Send RFQ';

  async getInputType() {
    return SendRfqInput;
  }

  protected async run(input: SendRfqInput): Promise<SendRfqResult> {
    let { rfq } = input;
    if (!rfq) {
      throw new Error('An RFQ is required');
    }
    if (rfq.id) {
      rfq = (await new GetCardCommand(this.commandContext).execute({
        cardId: rfq.id,
      })) as Rfq;
    }
    if (rfq.status && rfq.status !== 'draft') {
      throw new Error(
        `Only a draft RFQ can be sent (this one is "${rfq.status}")`,
      );
    }
    if (!(rfq.lineItems ?? []).length) {
      throw new Error('Add at least one requested line before sending');
    }
    if (!(rfq.invitedVendors ?? []).filter(Boolean).length) {
      throw new Error('Invite at least one vendor before sending');
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Rfq,
    }).execute({
      cardId: rfq.id,
      patch: {
        attributes: {
          status: 'sent',
        },
      },
    });

    let vendorCount = (rfq.invitedVendors ?? []).filter(Boolean).length;
    return new SendRfqResult({
      message: `RFQ sent to ${vendorCount} vendor${vendorCount === 1 ? '' : 's'} — record their quotes as they arrive.`,
    });
  }
}
