import Service, { service } from '@ember/service';
import OperatorModeStateService from './operator-mode-state-service';
import { getRealmSession } from '@cardstack/host/resources/realm-session';
import LoaderService from './loader-service';
import {
  Schema,
  basicMappings,
  generateCardPatchCallSpecification,
} from '@cardstack/runtime-common/helpers/ai';
import CardService from './card-service';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import interactPrompt from '../lib/prompts/interact/system-with-editable-cards.txt';
import interactPromptNoFunctions from '../lib/prompts/interact/system-without-editable-cards.txt';

type FunctionDef = {
  name: string;
  description: string;
  parameters: Schema;
};

export default class AiService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

  public async aiContext(attachedCards: CardDef[] = []) {
    let functions: FunctionDef[] = [];
    let attachedCardIds = attachedCards.map((c) => c.id);
    let systemPrompt = '';

    let attachedOpenCardIds = this.operatorModeStateService
      .topMostStackItems()
      .filter((stackItem) => attachedCardIds.includes(stackItem.card.id)) // Filter out any open cards that are not attached
      .map((stackItem) => stackItem.card.id);

    if (this.operatorModeStateService.state.submode == 'interact') {
      let attachedOpenCards = attachedCards.filter((c) =>
        attachedOpenCardIds.includes(c.id),
      );
      functions = await this.getPatchFunctions(attachedOpenCards);
      if (functions.length == 0) {
        systemPrompt = interactPromptNoFunctions;
      } else {
        systemPrompt = interactPrompt;
      }
    }

    return {
      openCardIds: attachedOpenCardIds,
      systemPrompt: systemPrompt,
      functions,
    };
  }

  private async getPatchFunctions(attachedOpenCards: CardDef[] = []) {
    let functions: FunctionDef[] = [];
    let mappings = await basicMappings(this.loaderService.loader);
    let cardAPI = await this.cardService.getAPI(this.loaderService.loader);
    // Generate function calls for patching currently open cards permitted for modification
    for (let attachedOpenCard of attachedOpenCards) {
      let patchSpec = generateCardPatchCallSpecification(
        attachedOpenCard.constructor as typeof CardDef,
        cardAPI,
        mappings,
      );
      let realmSession = getRealmSession(this, {
        card: () => attachedOpenCard,
      });
      await realmSession.loaded;
      if (realmSession.canWrite) {
        functions.push({
          name: 'patchCard',
          description: `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. Ensure the description explains what change you are making`,
          parameters: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
              },
              card_id: {
                type: 'string',
                const: attachedOpenCard.id, // Force the valid card_id to be the id of the card being patched
              },
              attributes: patchSpec,
            },
            required: ['card_id', 'attributes', 'description'],
          },
        });
      }
    }

    return functions;
  }
}
