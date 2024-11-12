import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import {
  type AttributesSchema,
  type CardSchema,
  type ObjectSchema,
  type RelationshipsSchema,
  generateJsonSchemaForCardType,
} from '@cardstack/runtime-common/helpers/ai';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import OperatorModeStateService from '../services/operator-mode-state-service';

import type LoaderService from '../services/loader-service';

export default class PatchCardCommand extends Command<
  BaseCommandModule.PatchCardInput,
  undefined,
  { cardType: typeof CardDef }
> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare loaderService: LoaderService;

  description = `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making. Do NOT leave out the cardId or patch fields or this tool will not work.`;

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}command`);
    const { PatchCardInput } = commandModule;
    // Can we define one on the fly?
    return PatchCardInput;
  }

  protected async run(
    input: BaseCommandModule.PatchCardInput,
  ): Promise<undefined> {
    console.log('input', input);
    if (!input.cardId || !input.patch) {
      console.log(input.cardId, input.patch);
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
    mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
  ): Promise<CardSchema> {
    let cardTypeToPatch = this.configuration.cardType;
    let cardTypeToPatchSchema = generateJsonSchemaForCardType(
      cardTypeToPatch,
      cardApi,
      mappings,
    );
    const inputTypeCardSchema = {
      attributes: {
        type: 'object',
        properties: {
          cardId: { type: 'string' },
          patch: {
            type: 'object',
            properties: {
              attributes: cardTypeToPatchSchema.attributes,
              relationships: cardTypeToPatchSchema.relationships,
            },
          } as ObjectSchema,
        },
      } as AttributesSchema,
      relationships: {
        type: 'object',
        properties: {},
      } as RelationshipsSchema,
    };
    console.log('inputTypeCardSchema', inputTypeCardSchema);
    //debugger;
    return inputTypeCardSchema;
  }
}
