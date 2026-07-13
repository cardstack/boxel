import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class FetchCardJsonTool extends HostBaseTool<
  typeof BaseToolModule.FetchCardJsonInput,
  typeof BaseToolModule.FetchCardJsonResult
> {
  @service declare private cardService: CardService;

  description = 'Fetch a card as a JSON document by URL';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { FetchCardJsonInput } = commandModule;
    return FetchCardJsonInput;
  }

  requireInputFields = ['cardIdentifier'];

  protected async run(
    input: BaseToolModule.FetchCardJsonInput,
  ): Promise<BaseToolModule.FetchCardJsonResult> {
    let commandModule = await this.loadToolModule();
    const { FetchCardJsonResult } = commandModule;
    const doc = await this.cardService.fetchJSON(input.cardIdentifier);
    return new FetchCardJsonResult({ document: doc });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { FetchCardJsonTool as FetchCardJsonCommand };
