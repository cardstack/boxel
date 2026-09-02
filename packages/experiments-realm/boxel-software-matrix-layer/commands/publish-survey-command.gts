import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import { Command } from '@cardstack/runtime-common';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import PatchCardInstanceCommand from '@cardstack/boxel-host/commands/patch-card-instance';

import { Survey } from '../survey';

// Publish Survey — the single writer for a survey's publish event. Checks
// the survey is actually publishable (a title and at least one question),
// then stamps `publishedAt` exactly once. Publication is an event fact, not
// a toggle: there is no unpublish here, because responses may already
// reference the published form — retiring a survey is a different, future
// concern with its own semantics.

export class PublishSurveyInput extends CardDef {
  @field survey = linksTo(() => Survey, { searchable: true });
}

export class PublishSurveyResult extends CardDef {
  @field message = contains(StringField);
}

export default class PublishSurveyCommand extends Command<
  typeof PublishSurveyInput,
  typeof PublishSurveyResult
> {
  static actionVerb = 'Publish';
  static displayName = 'Publish Survey';

  async getInputType() {
    return PublishSurveyInput;
  }

  protected async run(input: PublishSurveyInput): Promise<PublishSurveyResult> {
    let { survey } = input;
    if (!survey) {
      throw new Error('A survey is required');
    }
    if (survey.id) {
      survey = (await new GetCardCommand(this.commandContext).execute({
        cardId: survey.id,
      })) as Survey;
    }
    if (survey.publishedAt) {
      throw new Error(
        `"${survey.title ?? 'This survey'}" was already published on ${survey.publishedAt.toLocaleDateString('en-US')}`,
      );
    }
    if (!survey.title?.trim()) {
      throw new Error('Give the survey a title before publishing');
    }
    let questionCount = (survey.questions ?? []).filter(Boolean).length;
    if (!questionCount) {
      throw new Error('Add at least one question before publishing');
    }

    await new PatchCardInstanceCommand(this.commandContext, {
      cardType: Survey,
    }).execute({
      cardId: survey.id,
      patch: {
        attributes: {
          publishedAt: new Date().toISOString(),
        },
      },
    });

    return new PublishSurveyResult({
      message: `"${survey.title}" published with ${questionCount} question${questionCount === 1 ? '' : 's'} — responses can now be collected.`,
    });
  }
}
