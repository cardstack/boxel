import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { CompletionSet } from './completion-set';

export class CreateSetInput extends CardDef {
  @field name = contains(StringField);
  @field goal = contains(StringField);
  // Comma-separated product ids — a Command's input schema is a plain CardDef,
  // and `containsMany` on an input card is a heavier ask than this needs; the
  // command itself does the split/resolve.
  @field productIds = contains(StringField);
  // 'own-any' | 'own-all' — see completion-set.gts's own CompletionRuleField.
  @field completionRule = contains(StringField);
  @field isPublic = contains(BooleanField);
}

export class CreateSetResult extends CardDef {
  @field completionSetId = contains(StringField);
  @field targetCount = contains(StringField);
}

// Create Set (CS) — a collector names a completion goal.
//
// MEMBERSHIP IS CURATED, NOT A QUERY. `completion-set.gts`'s own header note
// is explicit: sneaker sets are emergent and personal, so `products` is a
// hand-confirmed `linksToMany`, never a saved filter. This command's whole
// job is resolving the caller's chosen product ids into real links —
// `targetCount` is then a computed field on the card itself, not something
// this command writes.
export default class CreateSetCommand extends Command<
  typeof CreateSetInput,
  typeof CreateSetResult
> {
  static actionVerb = 'Create set';
  description =
    'Create a completion goal from a curated list of products, with a name and a completion rule.';

  async getInputType() {
    return CreateSetInput;
  }

  protected async run(input: CreateSetInput): Promise<CreateSetResult> {
    let name = input.name?.trim();
    if (!name) {
      throw new Error('name is required');
    }
    let ids = (input.productIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new Error('productIds must contain at least one product id');
    }

    let products = await Promise.all(
      ids.map((id) =>
        new GetCardCommand(this.toolContext).execute({ cardId: id }),
      ),
    );

    let set = new CompletionSet();
    set.cardInfo.name = name;
    set.goal = input.goal?.trim() || '';
    set.products = products as any;
    set.completionRule = (input.completionRule?.trim() ||
      'own-any') as CompletionSet['completionRule'];
    set.isPublic = Boolean(input.isPublic);

    // Save into the SOURCE card's own realm. Without `realm`, SaveCard
    // defaults to the base realm and the write 401s — verified live when a
    // ProcessPayment run tried to save its Payment to cardstack.com/base/.
    let realm = (products[0] as any)?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: set,
      realm,
    })) as CompletionSet;

    let result = new CreateSetResult();
    result.completionSetId = saved.id;
    result.targetCount = String(saved.targetCount ?? products.length);
    return result;
  }
}
