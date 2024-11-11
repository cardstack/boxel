import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import type * as CardAPIModule from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

export default class ReloadCardCommand extends Command<CardDef, undefined> {
  @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;

  async getInputType() {
    let cardApiModule = await this.loaderService.loader.import<
      typeof CardAPIModule
    >(`${baseRealm.url}card-api`);
    const { CardDef } = cardApiModule;
    return CardDef;
  }

  protected async run(input: CardDef): Promise<undefined> {
    // TODO: handle case where card is already saved and a different input.realm is provided
    await this.cardService.reloadCard(input);
  }
}
