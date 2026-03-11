import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class SaveCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.SaveCardInput,
  typeof CardDef
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
  ): Promise<CardDef> {
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
