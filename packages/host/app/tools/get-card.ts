import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';

export default class GetCardTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  typeof CardDef
> {
  @service declare private store: StoreService;

  static actionVerb = 'Get Card';
  description = 'Get a card from the store by its ID';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(input: BaseToolModule.CardIdCard): Promise<CardDef> {
    let card = await this.store.get(input.cardId);
    if (!card || !('id' in card)) {
      throw new Error(`Card not found for id: ${input.cardId}`);
    }
    return card as CardDef;
  }
}
