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

import { Contract } from '../contract';

// Request Signature — the single writer for the approved → out-for-signature
// transition. Follows the contract's own transition map: only an `approved`
// contract may go out, because sending an unapproved draft to a counterparty
// is the mistake the whole review pipeline exists to prevent. Stamps
// signatureStatus `pending`, the request date, and which provider carries
// it. Single-persona: no e-signature integration — this records that the
// request went out, so the pipeline can hold the contract accountable.

export class RequestSignatureInput extends CardDef {
  @field contract = linksTo(() => Contract, { searchable: true });
  @field provider = contains(StringField, {
    description: 'e.g. DocuSign, Dropbox Sign, wet ink',
  });
}

export class RequestSignatureResult extends CardDef {
  @field message = contains(StringField);
}

function calendarDay(d: Date): string {
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default class RequestSignatureCommand extends Command<
  typeof RequestSignatureInput,
  typeof RequestSignatureResult
> {
  static actionVerb = 'Request Signature';
  static displayName = 'Request Signature';

  async getInputType() {
    return RequestSignatureInput;
  }

  protected async run(
    input: RequestSignatureInput,
  ): Promise<RequestSignatureResult> {
    let { contract, provider } = input;
    if (!contract) {
      throw new Error('A contract is required');
    }
    if (contract.id) {
      contract = (await new GetCardCommand(this.commandContext).execute({
        cardId: contract.id,
      })) as Contract;
    }
    if (contract.status !== 'approved') {
      throw new Error(
        `Only an approved contract can go out for signature (this one is "${contract.status ?? 'draft'}") — the review pipeline exists so counterparties never see unapproved text`,
      );
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Contract,
    }).execute({
      cardId: contract.id,
      patch: {
        attributes: {
          status: 'out for signature',
          signatureStatus: 'pending',
          signatureRequestedAt: calendarDay(new Date()),
          signatureProvider: provider?.trim() || 'unspecified',
        },
      },
    });

    return new RequestSignatureResult({
      message: `"${contract.title ?? 'Contract'}" sent for signature via ${provider?.trim() || 'unspecified provider'}.`,
    });
  }
}
