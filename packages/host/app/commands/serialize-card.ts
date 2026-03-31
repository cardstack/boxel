import { service } from '@ember/service';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseCommandModule from '@cardstack/base/command';

export default class SerializeCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CardIdCard,
  typeof BaseCommandModule.JsonCard
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService;

  static actionVerb = 'Serialize';
  description = 'Serialize a card by id';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseCommandModule.CardIdCard,
  ): Promise<BaseCommandModule.JsonCard> {
    let card = await this.store.get(input.cardId);
    if (!card || !('id' in card)) {
      throw new Error(`Card not found for id: ${input.cardId}`);
    }

    let serialized = await this.cardService.serializeCard(card as CardDef, {
      omitQueryFields: true,
    });

    let commandModule = await this.loadCommandModule();
    const { JsonCard } = commandModule;
    return new JsonCard({ json: serialized });
  }
}
