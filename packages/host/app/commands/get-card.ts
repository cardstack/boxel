import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import { type CardDef } from 'https://cardstack.com/base/card-api';

import HostBaseCommand from '../lib/host-base-command';
import type StoreService from '../services/store';

export default class GetCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.GetCardInput,
  CardDef
> {
  @service declare private store: StoreService;

  static actionVerb = 'Get Card';
  static description = 'Get a card from the store by its ID';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GetCardInput } = commandModule;
    return GetCardInput;
  }

  protected async run(input: BaseCommandModule.GetCardInput): Promise<CardDef> {
    let card = await this.store.get(input.cardId);
    if (!card || !('id' in card)) {
      // a CardErrorJSONAPI does not have an id property
      throw new Error(`Card not found for id: ${input.cardId}`);
    }
    return card;
  }
}
