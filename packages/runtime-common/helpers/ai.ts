import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { primitive } from '../constants';
import type { Loader } from '../loader';
import type { CardDef } from 'https://cardstack.com/base/card-api';
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
  additionalProperties?: boolean;
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
  relationships?: RelationshipsSchema;
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
  let codeRef: typeof import('https://cardstack.com/base/code-ref') =
    await loader.import('https://cardstack.com/base/code-ref');
  let query: typeof import('https://cardstack.com/base/commands/search-card-result') =
    await loader.import(
      'https://cardstack.com/base/commands/search-card-result',
    );

  const { default: StringField } = string;
  const { default: NumberField } = number;
  const { default: BigIntegerField } = biginteger;
  const { default: DateField } = date;
  const { default: DateTimeField } = datetime;
  const { default: BooleanField } = boolean;
  const { default: CodeRef } = codeRef;
  const { JsonField, QueryField } = query;
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
  mappings.set(CodeRef, {
    type: 'object',
    properties: {
      module: { type: 'string' },
      name: { type: 'string' },
    },
  });
  mappings.set(JsonField, {
    type: 'object',
    properties: {},
    additionalProperties: true,
  });
  mappings.set(QueryField, {
    type: 'object',
    description:
      'A query to the card search API, supporting searching on fields and types, with pagination and sorting.',
    properties: {
      filter: {
        type: 'object',
        description:
          "Filter criteria for the query. This object conforms to one of several structures (e.g., CardTypeFilter, EqFilter, AnyFilter). All properties within are optional and depend on the specific filter type. 'on' (a CodeRef) can specify context for field paths. Example properties: 'type' (CodeRef for CardTypeFilter), 'any'/'every' (array of filters), 'not' (a filter to negate), 'eq'/'contains' (object mapping field paths to values), 'range' (object mapping field paths to range constraints like {gt: 5}). Refer to the Query.Filter documentation for complete details.",
        properties: {
          type: {
            type: 'object',
            properties: {
              module: { type: 'string' },
              name: { type: 'string' },
            },
            required: ['module', 'name'],
            description:
              'A CodeRef (module and name) identifying a card type. Used for CardTypeFilter.',
          },
          on: {
            type: 'object',
            properties: {
              module: { type: 'string' },
              name: { type: 'string' },
            },
            required: ['module', 'name'],
            description:
              "A CodeRef (module and name) identifying a card type. Used as context for filters like 'eq', 'contains', 'range', 'any', 'every', 'not'.",
          },
          any: {
            type: 'array',
            items: {
              type: 'object',
              properties: {},
              description:
                'A nested filter object. Refer to Query.Filter documentation.',
            },
            description:
              'An array of filter objects. The condition is true if any filter in the array is true.',
          },
          every: {
            type: 'array',
            items: {
              type: 'object',
              properties: {},
              description:
                'A nested filter object. Refer to Query.Filter documentation.',
            },
            description:
              'An array of filter objects. The condition is true if all filters in the array are true.',
          },
          not: {
            type: 'object',
            properties: {},
            description:
              'A filter object to be negated. Refer to Query.Filter documentation.',
          },
          eq: {
            type: 'object',
            properties: {},
            description:
              "An object where keys are field paths (e.g., 'firstName', 'address.street') and values are the exact criteria to match.",
          },
          contains: {
            type: 'object',
            properties: {},
            description:
              'An object where keys are field paths and values are the criteria to be contained (e.g., for string contains, or array contains element).',
          },
          range: {
            type: 'object',
            properties: {},
            description:
              'An object where keys are field paths. Values are objects specifying range constraints (e.g., { gt: 10, lte: 20 }).',
          },
        },
      },
      sort: {
        type: 'array',
        description:
          'An array of sort expressions. Each expression defines a field to sort by and direction.',
        items: {
          type: 'object',
          properties: {
            by: {
              type: 'string',
              description:
                "Field path to sort by (e.g., 'createdAt', 'author.name').",
            },
            on: {
              type: 'object',
              properties: {
                module: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['module', 'name'],
              description:
                "Optional. A CodeRef (module and name) specifying the card type if 'by' is a field of that card. Required if 'by' is not a general sort field.",
            },
            direction: {
              enum: ['asc', 'desc'],
              description:
                "Sort direction: 'asc' for ascending, 'desc' for descending.",
            },
          },
          required: ['by'],
        },
      },
      page: {
        type: 'object',
        properties: {
          number: { type: 'integer', description: '0-based page number.' },
          size: { type: 'integer', description: 'Number of items per page.' },
          realmVersion: {
            type: 'integer',
            description:
              'Optional. Specifies the realm version for consistent pagination if data can change.',
          },
        },
        required: ['number', 'size'],
      },
    },
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
  options?: {
    require?: string[];
    ignore?: string[];
    strict?: boolean;
  },
): AttributesSchema | undefined {
  let ignoreFields = options?.ignore || [];
  let requiredFields = options?.require || [];
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
    usedLinksToFieldsOnly: false,
  });

  let includedRequiredFields = [];
  for (let [fieldName, field] of Object.entries(fields)) {
    // We're generating patch data, so computeds should be skipped
    // We'll be handling relationships separately in `generatePatchCallRelationshipsSpecification`
    if (
      field.computeVia ||
      field.fieldType == 'linksTo' ||
      field.fieldType == 'linksToMany' ||
      ignoreFields.includes(fieldName)
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
      if (options?.strict) {
        throw new Error(
          `No schema found for field '${fieldName}'. Ensure the field type is defined in the mappings.`,
        );
      }
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
    if (requiredFields.includes(fieldName)) {
      includedRequiredFields.push(fieldName);
    }
  }
  if (includedRequiredFields.length) {
    schema.required = includedRequiredFields;
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
  options?: {
    require?: string[];
    ignore?: string[];
  },
): RelationshipsSchema | undefined {
  let ignoreFields = options?.ignore || [];
  let requireFields = options?.require || [];
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
  let includedRequiredFields = [];
  for (let rel of relationships) {
    if (
      ignoreFields.find((ignoreField) =>
        rel.flatFieldName.startsWith(ignoreField),
      )
    ) {
      continue;
    }
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
    if (requireFields.includes(rel.flatFieldName)) {
      includedRequiredFields.push(rel.flatFieldName);
    }
    if (rel.description) {
      schema.properties[rel.flatFieldName].description = rel.description;
    }
  }
  if (Object.keys(schema.properties).length === 0) {
    return;
  }
  if (includedRequiredFields.length) {
    schema.required = includedRequiredFields;
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
    usedLinksToFieldsOnly: false,
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
 * @param options - Options to control the generation of the schema:
 *   - ignore: An array of field names to ignore during schema generation
 *   - require: An array of field names that will be marked as required in the schema
 *   - strict: If true, the schema generation will throw errors for missing mappings
 * @returns The generated patch call specification as JSON schema
 */
export function generateJsonSchemaForCardType(
  def: typeof CardAPI.CardDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
  options?: {
    require?: string[];
    ignore?: string[];
    strict?: boolean;
  },
): CardSchema {
  let schema = generateJsonSchemaForContainsFields(
    def,
    cardApi,
    mappings,
    options,
  ) as AttributesSchema | undefined;
  if (schema == undefined) {
    return {
      attributes: {
        type: 'object',
        properties: {},
      },
    };
  } else {
    let relationships = generateJsonSchemaForLinksToFields(
      def,
      cardApi,
      options,
    );
    if (!relationships) {
      return {
        attributes: schema,
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
      name: 'patchCardInstance',
      description: `Propose a patch to an existing card instance to change its contents. Any attributes specified will be fully replaced, return the minimum required to make the change. If a relationship field value is removed, set the self property of the specific item to null. When editing a relationship array, display the full array in the patch code. Ensure the description explains what change you are making.`,
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          attributes: {
            type: 'object',
            properties: {
              cardId: {
                type: 'string',
                const: attachedOpenCardId, // Force the valid card_id to be the id of the card being patched
              },
              patch: {
                type: 'object',
                properties: {
                  ...patchSpec,
                },
              },
            },
          },
        },
        required: ['attributes', 'description'],
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

export type ToolChoice =
  | 'none'
  | 'auto'
  | {
      type: 'function';
      function: {
        name: string;
      };
    };
