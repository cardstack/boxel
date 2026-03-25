import { Command, RealmPaths } from '@cardstack/runtime-common';
import {
  CardDef,
  field,
  contains,
  type Theme,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { PrCard } from '../pr-card/pr-card';

const GITHUB_PR_THEME_PATH = 'Theme/github-pr-brand-guide';

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
