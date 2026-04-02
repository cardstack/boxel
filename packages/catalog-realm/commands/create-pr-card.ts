import { Command } from '@cardstack/runtime-common';
import { CardDef, field, contains } from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { PrCard } from '../pr-card/pr-card';

class CreatePrCardInput extends CardDef {
  @field realm = contains(StringField);
  @field prNumber = contains(NumberField);
  @field prUrl = contains(StringField);
  @field prTitle = contains(StringField);
  @field branchName = contains(StringField);
  @field prSummary = contains(MarkdownField);
  @field submittedBy = contains(StringField);
}

export default class CreatePrCardCommand extends Command<
  typeof CreatePrCardInput,
  typeof PrCard
> {
  static actionVerb = 'Create PR Card';

  async getInputType() {
    return CreatePrCardInput;
  }

  protected async run(input: CreatePrCardInput): Promise<PrCard> {
    let {
      realm,
      prNumber,
      prUrl,
      prTitle,
      branchName,
      prSummary,
      submittedBy,
    } = input;

    let card = new PrCard({
      prNumber,
      prUrl,
      prTitle,
      branchName,
      prSummary,
      submittedBy,
      submittedAt: new Date(),
    });

    // Save the PR card to the submission realm
    let savedCard = (await new SaveCardCommand(this.commandContext).execute({
      card,
      realm,
    })) as PrCard;

    return savedCard;
  }
}
