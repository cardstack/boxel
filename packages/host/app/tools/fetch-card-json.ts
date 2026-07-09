import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';

export default class FetchCardJsonTool extends HostBaseTool<
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

  requireInputFields = ['cardIdentifier'];

  protected async run(
    input: BaseCommandModule.FetchCardJsonInput,
  ): Promise<BaseCommandModule.FetchCardJsonResult> {
    let commandModule = await this.loadCommandModule();
    const { FetchCardJsonResult } = commandModule;
    const doc = await this.cardService.fetchJSON(input.cardIdentifier);
    return new FetchCardJsonResult({ document: doc });
  }
}
