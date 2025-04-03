import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class SaveCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.SaveCardInput
> {
  @service declare private store: StoreService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SaveCardInput } = commandModule;
    return SaveCardInput;
  }

  // Instances that are saved via this method are eligible for garbage
  // collection--meaning that it will be detached from the store. This means you
  // MUST consume the instance IMMEDIATELY! it should not live in the state of
  // the consumer.
  protected async run(
    input: BaseCommandModule.SaveCardInput,
  ): Promise<undefined> {
    await this.store.add(input.card, input.realm);
  }
}
