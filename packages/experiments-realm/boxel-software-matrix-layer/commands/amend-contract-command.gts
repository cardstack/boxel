import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import TextAreaField from '@cardstack/base/text-area';
import MarkdownField from '@cardstack/base/markdown';
import { Command, identifyCard } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Contract } from '../contract';
import { Amendment } from '../amendment';

// Amend Contract — the single writer for creating a numbered Amendment
// against a signed contract. Amendment numbers are allocated here (max
// existing + 1) so two drafts can never claim "Amendment No. 2" at once.
// The amendment starts as a DRAFT: the changed text still travels the same
// review-and-execute road as any contract paper — this command creates the
// paper, it does not enact it.

export class AmendContractInput extends CardDef {
  @field contract = linksTo(() => Contract, { searchable: true });
  @field changesSummary = contains(TextAreaField);
  @field changedTerms = contains(MarkdownField);
  @field realm = contains(StringField);
}

export class AmendContractResult extends CardDef {
  @field amendment = linksTo(() => Amendment);
  @field message = contains(StringField);
}

export default class AmendContractCommand extends Command<
  typeof AmendContractInput,
  typeof AmendContractResult
> {
  static actionVerb = 'Amend';
  static displayName = 'Amend Contract';

  async getInputType() {
    return AmendContractInput;
  }

  protected async run(input: AmendContractInput): Promise<AmendContractResult> {
    let { contract, changesSummary, changedTerms, realm } = input;
    if (!contract) {
      throw new Error('A contract is required');
    }
    if (!realm) {
      throw new Error('A realm is required');
    }
    if (!changesSummary?.trim()) {
      throw new Error(
        'Summarize the changes — an amendment without a summary is unreviewable',
      );
    }
    if (contract.id) {
      contract = (await new GetCardCommand(this.commandContext).execute({
        cardId: contract.id,
      })) as Contract;
    }
    if (contract.status !== 'signed') {
      throw new Error(
        `Only a signed contract can be amended (this one is "${contract.status ?? 'draft'}") — before signature, just edit the draft`,
      );
    }

    // Allocate the next amendment number for THIS contract.
    let amendmentNumber = 1;
    let ref = identifyCard(Amendment);
    if (ref) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let result = await search.execute({ query: { filter: { type: ref } } });
      let priors = ((result.instances ?? []) as Amendment[]).filter((a) => {
        try {
          return a.contract?.id === contract!.id;
        } catch {
          return false;
        }
      });
      amendmentNumber =
        Math.max(0, ...priors.map((a) => a.amendmentNumber ?? 0)) + 1;
    }

    let amendment = (await new SaveCardCommand(this.commandContext).execute({
      card: new Amendment({
        contract,
        amendmentNumber,
        changesSummary,
        changedTerms,
        status: 'draft',
      }),
      realm,
    } as any)) as Amendment;

    return new AmendContractResult({
      amendment,
      message: `Amendment No. ${amendmentNumber} drafted against "${contract.title ?? 'contract'}" — route it through review and execution like any contract paper.`,
    });
  }
}
