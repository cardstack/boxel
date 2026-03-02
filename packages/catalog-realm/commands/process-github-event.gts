import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { JsonField } from 'https://cardstack.com/base/commands/search-card-result';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { GithubEventCard } from '../github-event/github-event';

class ProcessGithubEventInput extends CardDef {
  @field eventType = contains(StringField); // from command_filter
  @field submissionRealmUrl = contains(StringField); // from command_filter
  @field payload = contains(JsonField); // full GitHub webhook payload
}

export default class ProcessGithubEventCommand extends Command<
  typeof ProcessGithubEventInput,
  GithubEventCard
> {
  static actionVerb = 'Process GitHub Event';

  async getInputType() {
    return ProcessGithubEventInput;
  }

  protected async run(
    input: ProcessGithubEventInput,
  ): Promise<GithubEventCard> {
    const { eventType, submissionRealmUrl, payload } = input;

    let card = new GithubEventCard({
      eventType,
      payload,
    });

    let savedCard = await new SaveCardCommand(this.commandContext).execute({
      card,
      realm: submissionRealmUrl,
    });

    console.log(
      `[ProcessGithubEvent] created card id=${savedCard.id} eventType=${eventType} action=${payload?.action}`,
    );

    return savedCard;
  }
}
