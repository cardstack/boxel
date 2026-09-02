import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import UrlField from '@cardstack/base/url';
import { Command, identifyCard } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Contract } from '../contract';
import { ContractVersion } from '../contract-version';
import { Employee } from '../employee';

// Execute Contract — the single writer for the moment a contract comes into
// force: out-for-signature → signed, signatureStatus `signed`, signedAt
// stamped, and a ContractVersion snapshot created so "what did we agree on
// that day" survives every later amendment. Executing IS versioning — the
// two writes belong to one command precisely so they can never disagree.

export class ExecuteContractInput extends CardDef {
  @field contract = linksTo(() => Contract, { searchable: true });
  @field executedBy = linksTo(() => Employee);
  @field executedCopyUrl = contains(UrlField, {
    description: 'Link to the signed PDF, if any',
  });
  @field realm = contains(StringField);
}

export class ExecuteContractResult extends CardDef {
  @field version = linksTo(() => ContractVersion);
  @field message = contains(StringField);
}

function calendarDay(d: Date): string {
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default class ExecuteContractCommand extends Command<
  typeof ExecuteContractInput,
  typeof ExecuteContractResult
> {
  static actionVerb = 'Execute';
  static displayName = 'Execute Contract';

  async getInputType() {
    return ExecuteContractInput;
  }

  protected async run(
    input: ExecuteContractInput,
  ): Promise<ExecuteContractResult> {
    let { contract, executedBy, executedCopyUrl, realm } = input;
    if (!contract) {
      throw new Error('A contract is required');
    }
    if (!realm) {
      throw new Error('A realm is required');
    }
    if (contract.id) {
      contract = (await new GetCardCommand(this.commandContext).execute({
        cardId: contract.id,
      })) as Contract;
    }
    if (contract.status !== 'out for signature') {
      throw new Error(
        `Only a contract that is out for signature can be executed (this one is "${contract.status ?? 'draft'}")`,
      );
    }

    // Next version number: count existing snapshots for this contract.
    let versionNumber = 1;
    let ref = identifyCard(ContractVersion);
    if (ref) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let result = await search.execute({ query: { filter: { type: ref } } });
      let versions = ((result.instances ?? []) as ContractVersion[]).filter(
        (v) => {
          try {
            return v.contract?.id === contract!.id;
          } catch {
            return false;
          }
        },
      );
      versionNumber =
        Math.max(0, ...versions.map((v) => v.versionNumber ?? 0)) + 1;
    }

    let today = calendarDay(new Date());

    let version = (await new SaveCardCommand(this.commandContext).execute({
      card: new ContractVersion({
        contract,
        contractTitle: contract.title,
        versionNumber,
        effectiveDate: new Date(),
        executedBy,
        documentUrl: executedCopyUrl,
        summary:
          versionNumber === 1
            ? 'Original execution'
            : `Re-execution (version ${versionNumber})`,
        valueAtVersion: contract.value,
        endDateAtVersion: contract.endDate,
      }),
      realm,
    } as any)) as ContractVersion;

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Contract,
    }).execute({
      cardId: contract.id,
      patch: {
        attributes: {
          status: 'signed',
          signatureStatus: 'signed',
          signedAt: today,
          ...(executedCopyUrl ? { executedCopyUrl } : {}),
        },
      },
    });

    return new ExecuteContractResult({
      version,
      message: `"${contract.title ?? 'Contract'}" executed — version ${versionNumber} snapshotted.`,
    });
  }
}
