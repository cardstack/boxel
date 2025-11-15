import { service } from '@ember/service';

import type { CommandContext } from '@cardstack/runtime-common';
import {
  generateJsonSchemaForCardType,
  basicMappings,
} from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import { FieldPathParser } from '../lib/field-path-parser';
import HostBaseCommand from '../lib/host-base-command';

import type { ValidateFieldPathResult } from '../lib/field-path-parser';

import type CardService from '../services/card-service';
import type StoreService from '../services/store';

interface Configuration {
  cardType: typeof CardDef;
}

export default class PatchFieldsCommand extends HostBaseCommand<
  typeof BaseCommandModule.PatchFieldsInput,
  typeof BaseCommandModule.PatchFieldsOutput
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService;

  description = `Update specific fields of a card instance. Supports nested field paths using dot notation (e.g., "address.state") and array indices (e.g., "tags[0]"). Multiple fields can be updated in a single operation. Uses partial success model - valid field updates will be applied even if some fields fail validation.`;

  static actionVerb = 'Update Fields';
  requireInputFields = ['cardId', 'fieldUpdates'];

  constructor(
    commandContext: CommandContext,
    private readonly configuration?: Configuration,
  ) {
    super(commandContext);
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { PatchFieldsInput } = commandModule;
    return PatchFieldsInput;
  }

  // Core implementation methods
  private parseFieldPath(fieldPath: string): string[] {
    return FieldPathParser.parseFieldPath(fieldPath);
  }

  private applyFieldUpdate(
    dataNode: {
      attributes: Record<string, any>;
      relationships: Record<string, any>;
    },
    fieldPath: string[],
    value: any,
    isRelationship: boolean,
  ): void {
    // For attributes, use the helper to set the value in attributes
    FieldPathParser.applyFieldUpdate(
      dataNode,
      fieldPath,
      value,
      isRelationship,
    );
  }

  private async validatedFieldPath(
    fieldPath: string[],
    cardType: typeof CardDef,
  ): Promise<ValidateFieldPathResult> {
    // Load card-api dynamically to get getFields function
    const cardApi = await this.loaderService.loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >('https://cardstack.com/base/card-api');

    return FieldPathParser.validatedFieldPath(
      fieldPath,
      cardType,
      cardApi.getFields,
    );
  }

  protected async run(
    input: BaseCommandModule.PatchFieldsInput,
  ): Promise<BaseCommandModule.PatchFieldsOutput> {
    if (!input.cardId || !input.fieldUpdates) {
      throw new Error(
        "PatchFieldsCommand can't run because it doesn't have all the required fields",
      );
    }

    // Initialize result tracking
    const updatedFields: string[] = [];
    const errors: Record<string, string> = {};

    try {
      // Get the current card instance to merge with our updates
      const currentCard = await this.store.get(input.cardId);
      if (
        !currentCard ||
        typeof currentCard !== 'object' ||
        'status' in currentCard
      ) {
        throw new Error(`Card not found: ${input.cardId}`);
      }

      // Serialize the current card to get its current attributes structure
      const currentDoc = await this.cardService.serializeCard(currentCard);

      // Start with a deep copy of the data node (attributes and relationships)
      const workingData = JSON.parse(JSON.stringify(currentDoc.data));

      let cardType = currentCard.constructor as typeof CardDef;

      // Apply each field update, collecting successes and failures
      const successfulUpdates: string[] = [];
      const fieldErrors: Record<string, string> = {};

      for (const [fieldPath, value] of Object.entries(input.fieldUpdates)) {
        try {
          // Parse the field path
          const parsedPath = this.parseFieldPath(fieldPath);
          // Validate the field path exists on the card type
          let validatedFieldPath = await this.validatedFieldPath(
            parsedPath,
            cardType,
          );
          if (!validatedFieldPath.isValid) {
            throw new Error(
              `Invalid field path: ${fieldPath}. ${validatedFieldPath.reason}`,
            );
          }
          // Apply the update to the correct place
          this.applyFieldUpdate(
            workingData,
            parsedPath,
            value,
            validatedFieldPath.fieldType === 'linksTo' ||
              validatedFieldPath.fieldType === 'linksToMany',
          );

          // Track successful update
          successfulUpdates.push(fieldPath);
        } catch (error: any) {
          // Track error but continue processing other fields
          fieldErrors[fieldPath] = error.message || 'Update failed';
        }
      }

      // Only apply changes if at least some fields were updated successfully
      if (successfulUpdates.length > 0) {
        // Apply the updated data node (attributes and relationships)
        const result = await this.store.patch(
          input.cardId,
          {
            attributes: workingData.attributes,
            relationships: workingData.relationships,
          },
          { doNotWaitForPersist: true },
        );

        if (result && 'errors' in result) {
          // Store operation failed - mark all attempted updates as failed
          successfulUpdates.forEach((fieldPath) => {
            fieldErrors[fieldPath] = (result as any).errors
              .map((e: any) => e.detail || e.title)
              .join(', ');
          });
          updatedFields.push(...[]); // Clear successful updates
        } else {
          // Store operation succeeded - record successful updates
          updatedFields.push(...successfulUpdates);
        }
      }

      // Merge field errors into main errors object
      Object.assign(errors, fieldErrors);

      // Create and return the output
      let commandModule = await this.loadCommandModule();
      const { PatchFieldsOutput } = commandModule;

      return new PatchFieldsOutput({
        success: updatedFields.length > 0,
        updatedFields,
        errors,
      });
    } catch (error: any) {
      console.log('PatchFieldsCommand: Caught error:', error.message);
      // If the whole operation fails, mark all fields as failed
      Object.keys(input.fieldUpdates).forEach((fieldPath) => {
        errors[fieldPath] = error.message || 'Update failed';
      });

      let commandModule = await this.loadCommandModule();
      const { PatchFieldsOutput } = commandModule;

      return new PatchFieldsOutput({
        success: false,
        updatedFields,
        errors,
      });
    }
  }

  async getInputJsonSchema(): Promise<any> {
    // If we have a cardType configured, generate a detailed schema based on that card type
    let configuredCardType = this.configuration?.cardType;
    let loaderForSchema =
      (configuredCardType && Loader.getLoaderFor(configuredCardType)) ??
      this.loaderService.loader;

    if (configuredCardType) {
      const cardApi = await loaderForSchema.import<
        typeof import('https://cardstack.com/base/card-api')
      >('https://cardstack.com/base/card-api');
      const cardFields = cardApi.getFields(configuredCardType, {
        usedLinksToFieldsOnly: false,
      });
      let loaderFromFirstField = Object.values(cardFields)
        .map((field) => Loader.getLoaderFor(field.card))
        .find(Boolean);
      const mappings = await basicMappings(
        loaderFromFirstField ?? loaderForSchema,
      );
      const cardTypeSchema = generateJsonSchemaForCardType(
        configuredCardType,
        cardApi,
        mappings,
      );

      // Create field updates schema based on the card type's attributes
      const fieldUpdatesProperties: Record<string, any> = {};

      // Add all attributes from the card schema as potential field updates
      if (
        cardTypeSchema.attributes &&
        'properties' in cardTypeSchema.attributes &&
        cardTypeSchema.attributes.properties
      ) {
        for (const [fieldName, fieldSchema] of Object.entries(
          cardTypeSchema.attributes.properties,
        )) {
          // Skip card info and internal fields
          if (!['id', 'cardInfo'].includes(fieldName)) {
            fieldUpdatesProperties[fieldName] = fieldSchema;
          }
        }
      }

      return {
        attributes: {
          type: 'object',
          properties: {
            cardId: {
              type: 'string',
              description: 'The ID of the card to update',
            },
            fieldUpdates: {
              type: 'object',
              properties: fieldUpdatesProperties,
              additionalProperties: true, // Allow nested field paths like "address.street"
              description: 'Object containing field paths and their new values',
            },
          },
          required: ['cardId', 'fieldUpdates'],
        },
        relationships: {
          type: 'object',
          properties: {},
        },
      };
    }

    // Fallback to basic schema if no card type is configured
    return {
      attributes: {
        type: 'object',
        properties: {
          cardId: {
            type: 'string',
            description: 'The ID of the card to update',
          },
          fieldUpdates: {
            type: 'object',
            additionalProperties: true, // Allow any field updates for now
            description: 'Object containing field paths and their new values',
          },
        },
        required: ['cardId', 'fieldUpdates'],
      },
      relationships: {
        type: 'object',
        properties: {},
      },
    };
  }
}
