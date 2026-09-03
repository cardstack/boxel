import {
  CardDef,
  contains,
  containsMany,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';

import { Contract } from '../contract';
import {
  verifyCeremony,
  ceremonyIsClean,
  ceremonyState,
  nextBlockToRequest,
  type CeremonyFinding,
} from '../signature-block-field';

// Verify Signature — re-derives every ceremony check from CURRENT data and
// returns the findings. It writes nothing.
//
// Why a command and not just a computed field: the checks have to run at two
// moments the card cannot see — before Request Signature sends anything, and
// inside Execute Contract immediately before it writes `signed`. A signatory
// deactivated between those two moments must fail the second check even
// though the first passed. So the truth is recomputed on demand, from the
// Signatory cards as they are NOW, never from anything cached on the block.
//
// The checks themselves live in signature-block-field.gts (`verifyCeremony`)
// so the Signature Block View, this command, and the two writers share one
// definition of "in order" and "within authority".

export class VerifySignatureInput extends CardDef {
  @field contract = linksTo(() => Contract, { searchable: true });
}

export class VerifySignatureResult extends CardDef {
  @field clean = contains(BooleanField);
  @field ceremonyState = contains(StringField);
  @field blockingCount = contains(NumberField);
  /** One human sentence per finding, prefixed with the signing order. */
  @field findings = containsMany(StringField);
  /** The line that may go out next, if any — what Request Signature would send. */
  @field nextToRequest = contains(StringField);
  @field message = contains(StringField);
}

export function describeFinding(f: CeremonyFinding): string {
  if (!f.order) return f.message;
  return `Line ${f.order} (${f.signer}): ${f.message}`;
}

export default class VerifySignatureCommand extends Command<
  typeof VerifySignatureInput,
  typeof VerifySignatureResult
> {
  static actionVerb = 'Verify Signatures';
  static displayName = 'Verify Signature';

  async getInputType() {
    return VerifySignatureInput;
  }

  protected async run(
    input: VerifySignatureInput,
  ): Promise<VerifySignatureResult> {
    let { contract } = input;
    if (!contract) {
      throw new Error('A contract is required');
    }
    // Never trust the caller's load state: the blocks' signatories may not be
    // resolved on the instance we were handed.
    if (contract.id) {
      contract = (await new GetCardCommand(this.commandContext).execute({
        cardId: contract.id,
      })) as Contract;
    }

    let blocks = contract.signatureBlocks ?? [];
    let findings = verifyCeremony(
      blocks,
      contract.value?.amount,
      contract.contractType,
    );
    let clean = blocks.length > 0 && ceremonyIsClean(findings);
    let state = ceremonyState(blocks);
    let next = nextBlockToRequest(blocks);
    let blocking = findings.filter((f) => f.level === 'block').length;

    let message = clean
      ? state === 'complete'
        ? `All ${blocks.length} signature lines signed and within authority — "${contract.title ?? 'Contract'}" may be executed.`
        : `Authority checks pass for "${contract.title ?? 'Contract'}"; ceremony ${state}${next ? ` — next to request: line ${next.signingOrder} (${next.displayName})` : ''}.`
      : `${blocking} ${blocking === 1 ? 'check fails' : 'checks fail'} on "${contract.title ?? 'Contract'}" — see findings.`;

    return new VerifySignatureResult({
      clean,
      ceremonyState: state,
      blockingCount: blocking,
      findings: findings.map(describeFinding),
      nextToRequest: next
        ? `${next.signingOrder}. ${next.displayName}`
        : undefined,
      message,
    });
  }
}
