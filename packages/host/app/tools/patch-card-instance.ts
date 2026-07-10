import { service } from '@ember/service';

import type { CommandContext } from '@cardstack/runtime-common';
import {
  type AttributesSchema,
  type CardSchema,
  type ObjectSchema,
  type RelationshipsSchema,
  generateJsonSchemaForCardType,
} from '@cardstack/runtime-common/helpers/ai';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type { CardDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

interface Configuration {
  cardType: typeof CardDef;
}
export default class PatchCardInstanceTool extends HostBaseTool<
  typeof BaseToolModule.PatchCardInput,
  undefined
> {
  @service declare private store: StoreService;
  @service declare private toolService: ToolService;

  description = `Propose a patch to an existing card instance to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making. Do NOT leave out the cardId or patch fields or this tool will not work.`;
  static actionVerb = 'Update Card';

  constructor(
    commandContext: CommandContext,
    private readonly configuration: Configuration,
  ) {
    super(commandContext);
  }

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { PatchCardInput } = commandModule;
    return PatchCardInput;
  }

  requireInputFields = ['cardId', 'patch'];

  protected async run(
    input: BaseToolModule.PatchCardInput,
  ): Promise<undefined> {
    if (!input.cardId || !input.patch) {
      throw new Error(
        "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
      );
    }

    let clientRequestId = this.toolService.trackAiAssistantCardRequest({
      action: 'patch-instance',
      roomId: input.roomId,
      fileUrl: input.cardId.endsWith('.json')
        ? input.cardId
        : `${input.cardId}.json`,
    });
    await this.store.patch(
      input.cardId,
      {
        attributes: input.patch.attributes,
        relationships: input.patch.relationships,
      },
      { doNotWaitForPersist: true, clientRequestId },
    );
  }

  async getInputJsonSchema(
    cardApi: typeof CardAPI,
    mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
  ): Promise<CardSchema> {
    let cardTypeToPatch = this.configuration!.cardType;
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
        required: ['cardId', 'patch'],
      } as AttributesSchema,
      relationships: {
        type: 'object',
        properties: {},
      } as RelationshipsSchema,
    };
    return inputTypeCardSchema;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { PatchCardInstanceTool as PatchCardInstanceCommand };
