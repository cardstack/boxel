import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { primitive } from '../constants';
import { Loader } from '../loader';
import { CardDef } from 'https://cardstack.com/base/card-api';
import type { Tool } from 'https://cardstack.com/base/matrix-event';

type ArraySchema = {
  type: 'array';
  description?: string;
  items: AttributesSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type ObjectSchema = {
  type: 'object';
  description?: string;
  properties: {
    [fieldName: string]: AttributesSchema;
  };
  required?: string[];
};

export type LinksToSchema = {
  type: 'object';
  description?: string;
  properties: {
    links: {
      type: 'object';
      properties: {
        self: { type: 'string' | 'null' };
      };
      required: ['self'];
    };
  };
  required: ['links'];
};

type LinksToManySchema = {
  type: 'array';
  description?: string;
  items: LinksToSchema;
};

export type RelationshipSchema = LinksToSchema | LinksToManySchema;

export type RelationshipsSchema = {
  type: 'object';
  description?: string;
  properties: {
    [fieldName: string]: LinksToSchema | LinksToManySchema;
  };
  required?: string[]; // fieldName array;
};

type DateSchema = {
  type: 'string';
  description?: string;
  format: 'date' | 'date-time';
};

type NumberSchema = {
  type: 'number' | 'integer';
  description?: string;
  exclusiveMinimum?: number;
  minimum?: number;
  exclusiveMaximum?: number;
  maximum?: number;
  multipleOf?: number;
};

type StringSchema = {
  type: 'string';
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  const?: string;
};

type BooleanSchema = {
  description?: string;
  type: 'boolean';
};

type EnumSchema = {
  // JSON Schema allows a mix of any types in an enum
  description?: string;
  enum: any[];
};

export type AttributesSchema =
  | ArraySchema
  | ObjectSchema
  | DateSchema
  | NumberSchema
  | StringSchema
  | EnumSchema
  | BooleanSchema;

export interface CardSchema {
  attributes: AttributesSchema;
  relationships: RelationshipsSchema;
}

/**
 * A map of the most common field definitions to their JSON Schema
 * representations.
 */
export async function basicMappings(loader: Loader) {
  let mappings = new Map<typeof CardAPI.FieldDef, AttributesSchema>();

  let string: typeof import('https://cardstack.com/base/string') =
    await loader.import('https://cardstack.com/base/string');
  let number: typeof import('https://cardstack.com/base/number') =
    await loader.import('https://cardstack.com/base/number');
  let biginteger: typeof import('https://cardstack.com/base/big-integer') =
    await loader.import('https://cardstack.com/base/big-integer');
  let date: typeof import('https://cardstack.com/base/date') =
    await loader.import('https://cardstack.com/base/date');
  let datetime: typeof import('https://cardstack.com/base/datetime') =
    await loader.import('https://cardstack.com/base/datetime');
  let boolean: typeof import('https://cardstack.com/base/boolean') =
    await loader.import('https://cardstack.com/base/boolean');

  const { default: StringField } = string;
  const { default: NumberField } = number;
  const { default: BigIntegerField } = biginteger;
  const { default: DateField } = date;
  const { default: DateTimeField } = datetime;
  const { default: BooleanField } = boolean;
  mappings.set(StringField, {
    type: 'string',
  });
  mappings.set(NumberField, {
    type: 'number',
  });
  mappings.set(BigIntegerField, {
    type: 'string',
    pattern: '^-?[0-9]+$',
  });
  mappings.set(DateField, {
    type: 'string',
    format: 'date',
  });
  mappings.set(DateTimeField, {
    type: 'string',
    format: 'date-time',
  });
  mappings.set(BooleanField, {
    type: 'boolean',
  });
  for (const value of mappings.values()) {
    Object.freeze(value);
  }
  return mappings;
}

function getPrimitiveType(
  def: typeof CardAPI.BaseDef,
  mappings: Map<typeof CardAPI.BaseDef, AttributesSchema>,
) {
  // If we go beyond fieldDefs there are no matching mappings to use
  if (!('isFieldDef' in def) || !def.isFieldDef) {
    return undefined;
  }
  if (mappings.has(def)) {
    return { ...mappings.get(def) } as AttributesSchema;
  } else {
    // Try the parent class, recurse up until we hit a type recognised
    return getPrimitiveType(Object.getPrototypeOf(def), mappings);
  }
}

/**
 *  From a card or field definition, generate a JSON Schema that can be used to
 *  define the shape of a patch call. Fields that cannot be automatically
 *  identified may be omitted from the schema.
 *
 *  This is a subset of JSON Schema.
 *
 * @param def - The field to generate the patch call specification for.
 * @param cardApi - The card API to use to generate the patch call specification
 * @param mappings - A map of field definitions to JSON schema
 * @returns The generated patch call specification as JSON schema
 */
function generateJsonSchemaForContainsFields(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
): AttributesSchema | undefined {
  // If we're looking at a primitive field we can get the schema
  if (primitive in def) {
    return getPrimitiveType(def, mappings);
  }

  // If it's not a primitive, it contains other fields
  // and should be represented by an object
  let schema: ObjectSchema = {
    type: 'object',
    properties: {},
  };

  const { id: _removedIdField, ...fields } = cardApi.getFields(def, {
    usedFieldsOnly: false,
  });

  for (let [fieldName, field] of Object.entries(fields)) {
    // We're generating patch data, so computeds should be skipped
    // We'll be handling relationships separately in `generatePatchCallRelationshipsSpecification`
    if (
      field.computeVia ||
      field.fieldType == 'linksTo' ||
      field.fieldType == 'linksToMany'
    ) {
      continue;
    }

    let fieldSchemaForSingleItem = generateJsonSchemaForContainsFields(
      field.card,
      cardApi,
      mappings,
    ) as AttributesSchema | undefined;
    // This happens when we have no known schema for the field type
    if (fieldSchemaForSingleItem == undefined) {
      continue;
    }

    if (field.fieldType == 'containsMany') {
      schema.properties[fieldName] = {
        type: 'array',
        items: fieldSchemaForSingleItem,
      };
    } else if (field.fieldType == 'contains') {
      schema.properties[fieldName] = fieldSchemaForSingleItem;
    }

    if (field.description) {
      schema.properties[fieldName].description = field.description;
    }
  }
  return schema;
}

type RelationshipFieldInfo = {
  flatFieldName: string;
  fieldType: 'linksTo' | 'linksToMany';
  description?: string;
};

function generateJsonSchemaForLinksToFields(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
): RelationshipsSchema | undefined {
  let relationships: RelationshipFieldInfo[] = generateRelationshipFieldsInfo(
    def,
    cardApi,
  );
  if (!relationships.length) {
    return;
  }
  let schema: RelationshipsSchema = {
    type: 'object',
    properties: {},
  };
  for (let rel of relationships) {
    let relSchema: LinksToSchema = {
      type: 'object',
      properties: {
        links: {
          type: 'object',
          properties: {
            self: { type: 'string' },
          },
          required: ['self'],
        },
      },
      required: ['links'],
    };
    schema.properties[rel.flatFieldName] =
      rel.fieldType === 'linksTo'
        ? relSchema
        : {
            type: 'array',
            items: relSchema,
          };
    schema.required = schema.required || [];
    schema.required.push(rel.flatFieldName);
    if (rel.description) {
      schema.properties[rel.flatFieldName].description = rel.description;
    }
  }
  return schema;
}

function generateRelationshipFieldsInfo(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
  relationships: RelationshipFieldInfo[] = [],
  fieldName?: string,
) {
  const { id: _removedIdField, ...fields } = cardApi.getFields(def, {
    usedFieldsOnly: false,
  });
  for (let [fName, fValue] of Object.entries(fields)) {
    let flatFieldName = fieldName ? `${fieldName}.${fName}` : fName;
    if (fValue.computeVia) {
      continue;
    } else if (
      fValue.fieldType === 'linksTo' ||
      fValue.fieldType === 'linksToMany'
    ) {
      relationships.push({
        flatFieldName,
        fieldType: fValue.fieldType,
        description: fValue.description,
      });
    } else {
      relationships = generateRelationshipFieldsInfo(
        fValue.card,
        cardApi,
        relationships,
        flatFieldName,
      );
    }
  }
  return relationships;
}

/**
 *  From a card definition, generate a JSON Schema that can be used to
 *  define the shape of a patch call. Fields that cannot be automatically
 *  identified may be omitted from the schema.
 *
 *  This is a subset of JSON Schema.
 *
 * @param def - The card to generate the patch call specification for.
 * @param cardApi - The card API to use to generate the patch call specification
 * @param mappings - A map of field definitions to JSON schema
 * @returns The generated patch call specification as JSON schema
 */
export function generateJsonSchemaForCardType(
  def: typeof CardAPI.CardDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
): CardSchema {
  let schema = generateJsonSchemaForContainsFields(def, cardApi, mappings) as
    | AttributesSchema
    | undefined;
  if (schema == undefined) {
    return {
      attributes: {
        type: 'object',
        properties: {},
      },
      relationships: {
        type: 'object',
        properties: {},
        required: [],
      },
    };
  } else {
    let relationships = generateJsonSchemaForLinksToFields(def, cardApi);
    if (
      !relationships ||
      !('required' in relationships) ||
      !(relationships.required?.length ?? 0)
    ) {
      return {
        attributes: schema,
        relationships: { type: 'object', properties: {} },
      };
    }
    return {
      attributes: schema,
      relationships,
    };
  }
}

export function getPatchTool(
  attachedOpenCardId: CardDef['id'],
  patchSpec: any,
): Tool {
  return {
    type: 'function',
    function: {
      name: 'patchCard',
      description: `Propose a patch to an existing card to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.`,
      parameters: {
        type: 'object',
        properties: {
          attributes: {
            cardId: {
              type: 'string',
              const: attachedOpenCardId, // Force the valid card_id to be the id of the card being patched
            },
            description: {
              type: 'string',
            },
            ...patchSpec,
          },
        },
        required: ['attributes', 'description'],
      },
    },
  };
}

const containsFilterProperty = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'title of the card' },
  },
  required: ['title'],
};

const eqCardTypeFilterProperty = {
  type: 'object',
  properties: {
    _cardType: {
      type: 'string',
      description: 'name of the card type',
    },
  },
  required: ['_cardType'],
};

export function getSearchTool() {
  return {
    type: 'function',
    function: {
      name: 'searchCard',
      description:
        'Propose a query to search for a card instance filtered by type. \
  If a card was shared with you, always prioritise search based upon the card that was last shared. \
  If you do not have information on card module and name, do the search using the `_cardType` attribute.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          filter: {
            type: 'object',
            properties: {
              contains: containsFilterProperty,
              eq: eqCardTypeFilterProperty,
            },
          },
        },
        required: ['filter', 'description'],
      },
    },
  };
}

export function getGenerateAppModuleTool(attachedOpenCardId: string) {
  return {
    type: 'function',
    function: {
      name: 'generateAppModule',
      description: `Propose a post request to generate a new app module. Insert the module code in the 'moduleCode' property of the payload and the title for the module in the 'appTitle' property. Ensure the description explains what change you are making.`,
      parameters: {
        type: 'object',
        properties: {
          attached_card_id: {
            type: 'string',
            const: attachedOpenCardId,
          },
          description: {
            type: 'string',
          },
          appTitle: {
            type: 'string',
          },
          moduleCode: {
            type: 'string',
          },
        },
        required: ['attached_card_id', 'description', 'appTitle', 'moduleCode'],
      },
    },
  };
}

export interface FunctionToolCall {
  id: string;
  name: string;
  arguments: { [key: string]: any };
  type: 'function';
}
