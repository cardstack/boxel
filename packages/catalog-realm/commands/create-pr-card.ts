import { Command } from '@cardstack/runtime-common';

import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import { JsonField } from 'https://cardstack.com/base/commands/search-card-result';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { FileContentField } from '../fields/file-content';
import { PrCard } from '../pr-card/pr-card';

class CreatePrCardInput extends CardDef {
  @field realm = contains(StringField);
  @field branchName = contains(StringField);
  @field submittedBy = contains(StringField);
  @field prSummary = contains(MarkdownField);
  @field allFileContents = contains(JsonField);
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
    let { realm, branchName, submittedBy, prSummary, allFileContents } = input;

    let rawFiles = Array.isArray(allFileContents) ? allFileContents : [];
    let fileContents = rawFiles.map(
      (file: any) =>
        new FileContentField({
          filename: file.filename ?? file.path ?? '',
          contents: file.contents ?? file.content ?? '',
        }),
    );

    let card = new PrCard({
      branchName,
      submittedBy,
      prSummary,
      submittedAt: new Date(),
      allFileContents: fileContents,
    });

    // Save the PR card to the submission realm
    let savedCard = (await new SaveCardCommand(this.commandContext).execute({
      card,
      realm,
    })) as PrCard;

    return savedCard;
  }
}
