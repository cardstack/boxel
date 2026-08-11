import {
  CardDef,
  contains,
  field,
  linksTo,
  serializeCard,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

export class DuplicateInput extends CardDef {
  @field card = linksTo(CardDef, { searchable: true });
  @field realm = contains(StringField);
}

export class DuplicateResult extends CardDef {
  @field card = linksTo(CardDef);
  @field message = contains(StringField);
}

export default class DuplicateCommand extends Command<
  typeof DuplicateInput,
  typeof DuplicateResult
> {
  static actionVerb = 'Duplicate';

  async getInputType() {
    return DuplicateInput;
  }

  protected async run(input: DuplicateInput): Promise<DuplicateResult> {
    let { card, realm } = input;
    if (!card) throw new Error('A card to duplicate is required');
    if (!realm) throw new Error('A realm is required');
    if (card.id) {
      card = (await new GetCardCommand(this.commandContext).execute({
        cardId: card.id,
      })) as CardDef;
    }

    // Computeds are excluded by default, which is what we want: the copy
    // recomputes them from its own data rather than inheriting frozen values.
    let doc = serializeCard(card, { useAbsoluteURL: true });
    let { attributes, relationships } = doc.data as {
      attributes?: Record<string, any>;
      relationships?: Record<string, any>;
    };

    let CardClass = card.constructor as typeof CardDef;
    let copy = (await new SaveCardCommand(this.commandContext).execute({
      card: new (CardClass as any)(),
      realm,
    } as any)) as CardDef;

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: CardClass,
    }).execute({
      cardId: copy.id,
      patch: { attributes, relationships },
    });

    return new DuplicateResult({
      card: copy,
      message: `Duplicated ${card.cardTitle ?? CardClass.displayName}. The copy is unsaved work until you edit it — nothing about the original changed.`,
    });
  }
}
