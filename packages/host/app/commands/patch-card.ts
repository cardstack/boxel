import { service } from '@ember/service';

import { Command, baseRealm, type PatchData } from '@cardstack/runtime-common';

import {
  RelationshipsSchema,
  Schema,
  generateJsonSchemaForCardType,
} from '@cardstack/runtime-common/helpers/ai';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

type PatchPayload = { card_id: string } & PatchData;

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    (typeof payload === 'object' &&
      payload !== null &&
      'card_id' in payload &&
      'attributes' in payload) ||
    (typeof payload === 'object' &&
      payload !== null &&
      'card_id' in payload &&
      'relationships' in payload)
  );
}

// import type CardService from '../services/card-service';
import OperatorModeStateService from '../services/operator-mode-state-service';

import type LoaderService from '../services/loader-service';

export default class PatchCardCommand extends Command<
  BaseCommandModule.PatchCardInput,
  undefined,
  { cardType: typeof CardDef }
> {
  // @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare loaderService: LoaderService;

  description = `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.`;

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}command`);
    const { PatchCardInput } = commandModule;
    return PatchCardInput;
  }

  protected async run(
    input: BaseCommandModule.PatchCardInput,
  ): Promise<undefined> {
    // await this.cardService.saveModel(this, input.card, input.realm);
    // TODO: delegate to cardService patchCard incoporating OperatorModeStateService#patchCard
    debugger;
    if (!hasPatchData(input.patch)) {
      throw new Error(
        "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
      );
    }
    await this.operatorModeStateService.patchCard.perform(input.cardId, {
      attributes: input.patch.attributes,
      relationships: input.patch.relationships,
    });
  }

  async getInputJsonSchema(
    cardApi: typeof CardAPI,
    mappings: Map<typeof CardAPI.FieldDef, Schema>,
  ): Promise<{
    attributes: Schema;
    relationships: RelationshipsSchema;
  }> {
    let cardTypeToPatch = this.configuration.cardType;
    let cardTypeToPatchSchema = generateJsonSchemaForCardType(
      cardTypeToPatch,
      cardApi,
      mappings,
    );
    const inputTypeSchema = {
      cardId: { type: 'string' },
      patch: {
        type: 'object',
        properties: {
          attributes: cardTypeToPatchSchema.attributes,
        },
      },
    };
    debugger;
    return inputTypeSchema;
  }
}
