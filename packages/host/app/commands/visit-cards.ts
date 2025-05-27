import { getClass } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { SearchCardsByQueryCommand } from './search-cards';

export default class VisitCardsCommand extends HostBaseCommand<
  typeof BaseCommandModule.VisitCardsInput,
  typeof BaseCommandModule.VisitCardsOutput
> {
  description = 'Iterate over matching cards and run a command on each';

  static actionVerb = 'Visit';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { VisitCardsInput } = commandModule;
    return VisitCardsInput;
  }

  protected async run(
    input: BaseCommandModule.VisitCardsInput,
  ): Promise<BaseCommandModule.VisitCardsOutput> {
    let { cardIds } = await new SearchCardsByQueryCommand(
      this.commandContext,
    ).execute({
      query: input.query,
    });
    let CommandClass = await getClass(
      input.commandRef,
      this.loaderService.loader,
    );
    let visitPromises = cardIds.map((cardId: string) => {
      return new CommandClass(this.commandContext).execute({
        cardId,
      });
    });
    await Promise.allSettled(visitPromises);
    let commandModule = await this.loadCommandModule();
    const { VisitCardsOutput } = commandModule;
    return new VisitCardsOutput({});
  }
}
