import { service } from '@ember/service';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class StoreAddTool extends HostBaseTool<
  typeof BaseToolModule.StoreAddInput,
  typeof CardDef
> {
  @service declare private store: StoreService;

  description = 'Add a card document to the store';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { StoreAddInput } = commandModule;
    return StoreAddInput;
  }

  requireInputFields = ['document'];

  protected async run(input: BaseToolModule.StoreAddInput): Promise<CardDef> {
    const result = await this.store.add(
      input.document as LooseSingleCardDocument,
      input.realm ? { realm: input.realm } : undefined,
    );
    return result as CardDef;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { StoreAddTool as StoreAddCommand };
