import { service } from '@ember/service';

import { Command, baseRealm } from '@cardstack/runtime-common';

import {
  RelationshipsSchema,
  Schema,
  generateJsonSchemaForCardType,
} from '@cardstack/runtime-common/helpers/ai';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

// import type CardService from '../services/card-service';
import type LoaderService from '../services/loader-service';

export default class PatchCardCommand extends Command<
  BaseCommandModule.PatchCardInput,
  undefined,
  { cardType: typeof CardDef }
> {
  // @service private declare cardService: CardService;
  @service private declare loaderService: LoaderService;

  description = `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.`;

  async getInputType() {
    let commandModule = await this.loaderService.loader.import<
      typeof BaseCommandModule
    >(`${baseRealm.url}card-api`);
    const { PatchCardInput } = commandModule;
    return PatchCardInput;
  }

  protected async run(
    _input: BaseCommandModule.PatchCardInput,
  ): Promise<undefined> {
    // await this.cardService.saveModel(this, input.card, input.realm);
    // TODO: delegate to cardService patchCard incoporating OperatorModeStateService#patchCard
    throw new Error('Not implemented');
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
    let inputTypeSchema = generateJsonSchemaForCardType(
      await this.getInputType(),
      cardApi,
      mappings,
    );
    // TODO: merge cardTypeToPatchSchema into inputTypeSchema specifying the schema of the "patch" attribute
    debugger;
    return inputTypeSchema;
  }
}
