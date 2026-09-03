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
import {
  verifyCeremony,
  nextBlockToRequest,
  sortedBlocks,
} from '../signature-block-field';

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
    // ---- Ceremony path (desk spec) ------------------------------------------
    // When the contract carries signature blocks, the request goes out ONE
    // LINE AT A TIME in signing order: the first call (from `approved`) sends
    // line 1; each later call (from `out for signature`) sends the next line
    // whose predecessors have all signed. Order violations are therefore not
    // discouraged but impossible — there is no path that requests line 2
    // while line 1 is open. Authority is re-checked on every call against the
    // Signatory cards as they are NOW.
    let blocks = contract.signatureBlocks ?? [];
    if (blocks.length) {
      if (
        contract.status !== 'approved' &&
        contract.status !== 'out for signature'
      ) {
        throw new Error(
          `Only an approved contract can go out for signature (this one is "${contract.status ?? 'draft'}") — the review pipeline exists so counterparties never see unapproved text`,
        );
      }
      let findings = verifyCeremony(
        blocks,
        contract.value?.amount,
        contract.contractType,
      ).filter((f) => f.level === 'block');
      // Findings about signing itself (unsigned refs, order) cannot apply
      // before anything has been signed; what blocks a REQUEST is authority,
      // naming and structure.
      let authorityFindings = findings.filter(
        (f) =>
          !/out of signing order|no signature reference/i.test(f.message),
      );
      if (authorityFindings.length) {
        throw new Error(
          `Cannot request signature — ${authorityFindings.length} ${
            authorityFindings.length === 1 ? 'line fails' : 'lines fail'
          } the authority check:\n` +
            authorityFindings
              .map((f) =>
                f.order
                  ? `  line ${f.order} (${f.signer}): ${f.message}`
                  : `  ${f.message}`,
              )
              .join('\n'),
        );
      }
      let next = nextBlockToRequest(blocks);
      if (!next) {
        let waiting = sortedBlocks(blocks).find(
          (b) => b.lineStatus === 'requested',
        );
        throw new Error(
          waiting
            ? `Line ${waiting.signingOrder} (${waiting.displayName}) is still out for signature — the next line cannot be requested until it signs.`
            : 'Every signature line is already signed or declined — nothing left to request.',
        );
      }

      let now = new Date();
      let serialised = sortedBlocks(blocks).map((b) => ({
        party: {
          role: b.party?.role ?? null,
          definedTerm: b.party?.definedTerm ?? null,
        },
        signerName: b.signerName ?? null,
        signerTitle: b.signerTitle ?? null,
        signingOrder: b.signingOrder ?? null,
        lineStatus: b === next ? 'requested' : b.lineStatus ?? 'pending',
        requestedAt:
          b === next ? now.toISOString() : b.requestedAt ?? null,
        signedAt: b.signedAt ?? null,
        signatureRef: b.signatureRef ?? null,
      }));

      await new PatchCardInstanceCommand(this.commandContext, {
        cardType: Contract,
      }).execute({
        cardId: contract.id,
        patch: {
          attributes: {
            status: 'out for signature',
            signatureStatus: 'pending',
            signatureRequestedAt:
              contract.signatureRequestedAt ?? calendarDay(now),
            signatureProvider:
              provider?.trim() || contract.signatureProvider || 'unspecified',
            signatureBlocks: serialised,
          },
        },
      });

      return new RequestSignatureResult({
        message: `Line ${next.signingOrder} (${next.displayName}${
          next.entityName ? `, ${next.entityName}` : ''
        }) of "${contract.title ?? 'Contract'}" requested via ${
          provider?.trim() || contract.signatureProvider || 'unspecified provider'
        } — authority checks pass.`,
      });
    }

    // ---- Legacy path (no signature blocks) ------------------------------------
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
