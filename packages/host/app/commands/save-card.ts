import { service } from '@ember/service';

import {
  isCardErrorJSONAPI,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class SaveCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.SaveCardInput,
  typeof BaseCommandModule.SaveCardResult
> {
  @service declare private store: StoreService;

  static actionVerb = 'Save';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SaveCardInput } = commandModule;
    return SaveCardInput;
  }

  requireInputFields = ['card'];

  // Instances that are saved via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseCommandModule.SaveCardInput,
  ): Promise<BaseCommandModule.SaveCardResult> {
    let savedCard = await this.store.add(cardInput, {
      realm: input.realm,
      localDir: input.localDir,
    });

    if (isCardErrorJSONAPI(savedCard)) {
      throw new Error(
        savedCard.message ?? 'Failed to save card due to server error',
      );
    }

    let commandModule = await this.loadCommandModule();
    const { SaveCardResult } = commandModule;

    return new SaveCardResult({
      card: savedCard,
    });
  }
}
