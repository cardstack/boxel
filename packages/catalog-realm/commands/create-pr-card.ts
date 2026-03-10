import { Command, RealmPaths } from '@cardstack/runtime-common';
import {
  CardDef,
  field,
  contains,
  type Theme,
} from 'https://cardstack.com/base/card-api';
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
    let { realm, prNumber, prUrl, prTitle, branchName, submittedBy } = input;
    let catalogRealmUrl = new RealmPaths(new URL('..', import.meta.url)).url;

    let card = new PrCard({
      prNumber,
      prUrl,
      prTitle,
      branchName,
      submittedBy,
      submittedAt: new Date(),
    });

    // Link the GitHub PR brand guide theme from the catalog realm
    let themeCardId = `${catalogRealmUrl}${GITHUB_PR_THEME_PATH}`;
    let theme = await new GetCardCommand(this.commandContext).execute({
      cardId: themeCardId,
    });
    if (theme) {
      card.cardInfo.theme = theme as Theme;
    }

    // Save the PR card to the submission realm
    let savedCard = (await new SaveCardCommand(this.commandContext).execute({
      card,
      realm,
    })) as unknown as PrCard;

    return savedCard;
  }
}
