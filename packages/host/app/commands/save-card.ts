import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

export default class SaveCardCommand extends Command<
  BaseCommandModule.SaveCardInput,
  undefined
> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}card-api`);
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
