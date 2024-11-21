import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';

export default class SaveCardCommand extends HostBaseCommand<
  BaseCommandModule.SaveCardInput,
  undefined
> {
  @service private declare cardService: CardService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SaveCardInput } = commandModule;
    return SaveCardInput;
  }

  protected async run(
    input: BaseCommandModule.SaveCardInput,
  ): Promise<undefined> {
    // TODO: handle case where card is already saved and a different input.realm is provided
    await this.cardService.saveModel(this, input.card, input.realm);
  }
}
