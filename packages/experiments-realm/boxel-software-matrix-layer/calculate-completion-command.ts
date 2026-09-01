import { Command, identifyCard } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SearchCardsByQueryCommand from '@cardstack/boxel-host/commands/search-cards';
import type { CompletionSet } from './completion-set';
import { computeCompletion } from './completion-set';
import { CollectionItem } from './collection-item';

export class CalculateCompletionInput extends CardDef {
  @field completionSetId = contains(StringField);
}

export class CalculateCompletionResult extends CardDef {
  @field completionSetId = contains(StringField);
  @field ownedCount = contains(NumberField);
  @field targetCount = contains(NumberField);
  @field percent = contains(NumberField);
}

// Calculate Completion (CC) — the app's own reverse query, wrapped as a
// callable command so an assistant or a "refresh" affordance can ask for the
// number without duplicating `completion-set.gts`'s isolated view logic.
//
// READ-ONLY BY DESIGN. `CompletionSet` deliberately stores no `progress`
// field — see the header note in `completion-set.gts`: the numerator is a
// rollup over CollectionItems and storing it guarantees drift the moment a
// pair is bought or sold. This command computes and returns the same number
// the isolated view shows; it never patches the set.
//
// There is exactly ONE implementation of the arithmetic — `computeCompletion`
// in `completion-set.gts` — imported here, not re-derived. The app, this
// command, and any future consumer all call the same function.
export default class CalculateCompletionCommand extends Command<
  typeof CalculateCompletionInput,
  typeof CalculateCompletionResult
> {
  static actionVerb = 'Calculate completion';
  description =
    'Compute a completion set’s owned/target counts and percentage from the current collection, without storing the result.';

  async getInputType() {
    return CalculateCompletionInput;
  }

  protected async run(
    input: CalculateCompletionInput,
  ): Promise<CalculateCompletionResult> {
    let completionSetId = input.completionSetId?.trim();
    if (!completionSetId) {
      throw new Error('completionSetId is required');
    }

    let set = (await new GetCardCommand(this.toolContext).execute({
      cardId: completionSetId,
    })) as CompletionSet;
    if (!set) {
      throw new Error(`CompletionSet not found: ${completionSetId}`);
    }

    let setProductIds = (set.products ?? []).map((p) => p?.id);

    let itemRef = identifyCard(CollectionItem);
    let items = itemRef
      ? await new SearchCardsByQueryCommand(this.toolContext).execute({
          query: { filter: { type: itemRef } },
        })
      : undefined;

    let ownedProductIds = ((items?.instances ?? []) as CollectionItem[])
      .map((i) => i?.item?.id)
      .filter((id): id is string => Boolean(id));

    let computed = computeCompletion(setProductIds, ownedProductIds);

    let result = new CalculateCompletionResult();
    result.completionSetId = completionSetId;
    result.ownedCount = computed.ownedCount;
    result.targetCount = computed.targetCount;
    result.percent = computed.percent;
    return result;
  }
}
