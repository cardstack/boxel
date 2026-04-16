import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';

export default class FetchCardJsonCommand extends HostBaseCommand<
  typeof BaseCommandModule.FetchCardJsonInput,
  typeof BaseCommandModule.FetchCardJsonResult
> {
  @service declare private cardService: CardService;

  description = 'Fetch a card as a JSON document by URL';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { FetchCardJsonInput } = commandModule;
    return FetchCardJsonInput;
  }

  requireInputFields = ['url'];

  protected async run(
    input: BaseCommandModule.FetchCardJsonInput,
  ): Promise<BaseCommandModule.FetchCardJsonResult> {
    let commandModule = await this.loadCommandModule();
    const { FetchCardJsonResult } = commandModule;
    const doc = await this.cardService.fetchJSON(input.url);
    return new FetchCardJsonResult({ document: doc });
  }
}
