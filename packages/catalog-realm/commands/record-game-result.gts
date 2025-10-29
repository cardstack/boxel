import {
  CardDef,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import { GameResult } from '../game-result/game-result';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import {
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

class RecordGameResultInput extends CardDef {
  @field card = linksTo(CardDef);
  @field realm = contains(StringField);
}

export default class RecordGameResultCommand extends Command<
  typeof RecordGameResultInput,
  undefined
> {
  static actionVerb = 'Record Game Result';

  async getInputType() {
    return RecordGameResultInput;
  }

  protected async run(input: RecordGameResultInput): Promise<undefined> {
    const { card, realm } = input;

    if (!card) {
      throw new Error('Game Result is required');
    }

    let ref = (card as GameResult).ref as ResolvedCodeRef;

    if (!ref || !isResolvedCodeRef(ref)) {
      throw new Error('Game Result ref is required');
    }
    if (!realm) {
      throw new Error('Realm is required');
    }

    try {
      await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      });
    } catch (error: any) {
      throw new Error(`❌ Failed to record game result: ${error.message}`);
    }
  }
}
