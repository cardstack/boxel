import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class SaveCardTool extends HostBaseTool<
  typeof BaseToolModule.SaveCardInput,
  typeof CardDef
> {
  @service declare private store: StoreService;

  static actionVerb = 'Save';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SaveCardInput } = commandModule;
    return SaveCardInput;
  }

  requireInputFields = ['card'];

  // Instances that are saved via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(input: BaseToolModule.SaveCardInput): Promise<CardDef> {
    let result = await this.store.add(input.card, {
      realm: input.realm,
      localDir: input.localDir,
    });
    if (!isCardInstance(result)) {
      throw new Error(`Failed to save card: ${JSON.stringify(result)}`);
    }
    return result;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SaveCardTool as SaveCardCommand };
