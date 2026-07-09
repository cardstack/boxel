import { getClass } from '@cardstack/runtime-common';

import type { VisitCardsInput } from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import ReadSourceTool from './read-source';
import { SearchCardsByQueryTool } from './search-cards';
import WriteTextFileTool from './write-text-file';

export default class TransformCardsTool extends HostBaseTool<
  typeof VisitCardsInput
> {
  description =
    'Iterate over matching cards and run a command on each that transforms its json';

  static actionVerb = 'Transform';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { VisitCardsInput } = commandModule;
    return VisitCardsInput;
  }

  requireInputFields = ['query', 'commandRef'];

  protected async run(input: VisitCardsInput): Promise<undefined> {
    let { cardIds } = await new SearchCardsByQueryTool(
      this.commandContext,
    ).execute({
      query: input.query,
    });
    let CommandClass = await getClass(
      input.commandRef,
      this.loaderService.loader,
    );
    let visitPromises = cardIds.map(async (cardId: string) => {
      let readSourceCommand = new ReadSourceTool(this.commandContext);
      let { content } = await readSourceCommand.execute({
        path: cardId + '.json',
      });

      let { json } = await new CommandClass(this.commandContext).execute({
        json: JSON.parse(content),
      });

      let updatedContent = JSON.stringify(json, null, 2);
      let writeTextFileCommand = new WriteTextFileTool(this.commandContext);
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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { TransformCardsTool as TransformCardsCommand };
