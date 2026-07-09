import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class GetCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  typeof CardDef
> {
  @service declare private store: StoreService;

  static actionVerb = 'Get Card';
  description = 'Get a card from the store by its ID';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseCommandModule.CardIdCard): Promise<CardDef> {
    let card = await this.store.get(input.cardId);
    if (!card || !('id' in card)) {
      throw new Error(`Card not found for id: ${input.cardId}`);
    }
    return card as CardDef;
  }
}
