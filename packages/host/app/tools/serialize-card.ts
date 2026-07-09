import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class SerializeCardTool extends HostBaseTool<
  typeof BaseToolModule.CardIdCard,
  typeof BaseToolModule.JsonCard
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService;

  static actionVerb = 'Serialize';
  description = 'Serialize a card by id';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CardIdCard } = commandModule;
    return CardIdCard;
  }

  requireInputFields = ['cardId'];

  protected async run(
    input: BaseToolModule.CardIdCard,
  ): Promise<BaseToolModule.JsonCard> {
    let card = await this.store.get(input.cardId);
    if (!card || !('id' in card)) {
      throw new Error(`Card not found for id: ${input.cardId}`);
    }

    let serialized = await this.cardService.serializeCard(card as CardDef, {
      omitQueryFields: true,
    });

    let commandModule = await this.loadToolModule();
    const { JsonCard } = commandModule;
    return new JsonCard({ json: serialized });
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SerializeCardTool as SerializeCardCommand };
