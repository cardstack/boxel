import { getClass } from '@cardstack/runtime-common';

import type { VisitCardsInput } from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ReadSourceCommand from './read-source';
import { SearchCardsByQueryCommand } from './search-cards';
import WriteTextFileCommand from './write-text-file';

export default class TransformCardsCommand extends HostBaseCommand<
  typeof VisitCardsInput
> {
  description =
    'Iterate over matching cards and run a command on each that transforms its json';

  static actionVerb = 'Transform';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { VisitCardsInput } = commandModule;
    return VisitCardsInput;
  }

  requireInputFields = ['query', 'commandRef'];

  protected async run(input: VisitCardsInput): Promise<undefined> {
    let { cardIds } = await new SearchCardsByQueryCommand(
      this.commandContext,
    ).execute({
      query: input.query,
    });
    let CommandClass = await getClass(
      input.commandRef,
      this.loaderService.loader,
    );
    let visitPromises = cardIds.map(async (cardId: string) => {
      let readSourceCommand = new ReadSourceCommand(this.commandContext);
      let { content } = await readSourceCommand.execute({
        path: cardId + '.json',
      });

      let { json } = await new CommandClass(this.commandContext).execute({
        json: JSON.parse(content),
      });

      let updatedContent = JSON.stringify(json, null, 2);
      let writeTextFileCommand = new WriteTextFileCommand(this.commandContext);
      return writeTextFileCommand.execute({
        content: updatedContent,
        path: cardId + '.json',
        overwrite: true,
      });
    });
    await Promise.allSettled(visitPromises);

    // In the future, we might want to return some kind of summary card
  }
}
