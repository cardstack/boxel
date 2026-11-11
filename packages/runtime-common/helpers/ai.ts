import { grammarDescription } from '../query-grammar.ts';
import type * as CardAPI from '@cardstack/base/card-api';
import { primitive } from '../constants.ts';
import type { Loader } from '../loader.ts';
import type { CardDef } from '@cardstack/base/card-api';
import type { Tool } from '@cardstack/base/matrix-event';

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
  examples?: any[];
};

type NumberSchema = {
  type: 'number' | 'integer';
  description?: string;
  exclusiveMinimum?: number;
  minimum?: number;
  exclusiveMaximum?: number;
  maximum?: number;
  multipleOf?: number;
  examples?: any[];
};

type StringSchema = {
  type: 'string';
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  const?: string;
  examples?: any[];
};

type BooleanSchema = {
  description?: string;
  type: 'boolean';
  examples?: any[];
};

type EnumSchema = {
  // JSON Schema allows a mix of any types in an enum
  description?: string;
  enum: any[];
  examples?: any[];
};

// A value that may take one of several shapes, such as a type reference
// written as its "<module>#<Name>" shorthand or as { module, name }.
type AnyOfSchema = {
  description?: string;
  anyOf: AttributesSchema[];
};

export type AttributesSchema =
  | AnyOfSchema
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

  let string: typeof import('@cardstack/base/string') = await loader.import(
    '@cardstack/base/string',
  );
  let number: typeof import('@cardstack/base/number') = await loader.import(
    '@cardstack/base/number',
  );
  let biginteger: typeof import('@cardstack/base/big-integer') =
    await loader.import('@cardstack/base/big-integer');
  let date: typeof import('@cardstack/base/date') = await loader.import(
    '@cardstack/base/date',
  );
  let datetime: typeof import('@cardstack/base/datetime') = await loader.import(
    '@cardstack/base/datetime',
  );
  let boolean: typeof import('@cardstack/base/boolean') = await loader.import(
    '@cardstack/base/boolean',
  );
  let codeRef: typeof import('@cardstack/base/code-ref') = await loader.import(
    '@cardstack/base/code-ref',
  );
  let query: typeof import('@cardstack/base/commands/search-card-result') =
    await loader.import('@cardstack/base/commands/search-card-result');

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
  // card-api declares its own NumberField for the fields base cards share
  // (cardInfo.metrics, an image's width and height); it is a number too.
  let cardApi: typeof import('@cardstack/base/card-api') = await loader.import(
    '@cardstack/base/card-api',
  );
  if (cardApi.NumberField && cardApi.NumberField !== NumberField) {
    mappings.set(cardApi.NumberField, {
      type: 'number',
    });
  }
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
  // The query the assistant's search tools take (docs/search.md). The tools
  // validate it with `assertQuery` and send it as an entry wire query
  // (`searchEntryWireQueryFromQuery`), so this describes the spelling that
  // path carries: a type anchor `on` in each clause and the engine's signal
  // sort keys. A top-level `type`, `{ blend }`, `{ expression }`,
  // `{ relevance }`, `exists`/`missing` and `select` do not survive it yet.
  // A type reference, in either spelling: the "<module>#<Name>" shorthand
  // or the code ref { module, name } (type-reference.ts).
  const queryCodeRef = (description: string): AnyOfSchema => ({
    anyOf: [
      {
        type: 'string',
        pattern: '^[^#\\s]+#[A-Za-z_$][A-Za-z0-9_$]*$',
        description:
          'The shorthand "<module>#<Name>", such as "@cardstack/catalog/product#Product", "https://my.realm/product#Product" or "$REALM/product#Product".',
      },
      {
        type: 'object',
        properties: {
          module: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['module', 'name'],
      },
    ],
    description,
  });
  const nestedFilter = (description: string): ObjectSchema => ({
    type: 'object',
    properties: {},
    description,
  });
  mappings.set(QueryField, {
    type: 'object',
    description: grammarDescription('query'),
    properties: {
      filter: {
        type: 'object',
        description: grammarDescription('query', 'filter'),
        properties: {
          type: queryCodeRef(grammarDescription('filter', 'type')),
          on: queryCodeRef(grammarDescription('filter', 'on')),
          any: {
            type: 'array',
            items: nestedFilter('A nested filter.'),
            description: grammarDescription('filter', 'any'),
          },
          every: {
            type: 'array',
            items: nestedFilter('A nested filter.'),
            description: grammarDescription('filter', 'every'),
          },
          not: nestedFilter(grammarDescription('filter', 'not')),
          eq: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'eq'),
          },
          in: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'in'),
          },
          contains: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'contains'),
          },
          range: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'range'),
          },
          matches: {
            type: 'string',
            description: grammarDescription('filter', 'matches'),
          },
          prefix: {
            type: 'boolean',
            description: grammarDescription('filter', 'prefix'),
          },
          typos: {
            type: 'boolean',
            description: grammarDescription('filter', 'typos'),
          },
          scope: {
            enum: ['title'],
            description: grammarDescription('filter', 'scope'),
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: grammarDescription('filter', 'fields'),
          },
          within: {
            type: 'string',
            description: grammarDescription('filter', 'within'),
          },
          near: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'near'),
          },
          pattern: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'pattern'),
          },
          regex: {
            type: 'object',
            properties: {},
            description: grammarDescription('filter', 'regex'),
          },
          linkedFrom: {
            type: 'object',
            properties: {
              card: { type: 'string' },
              field: { type: 'string' },
            },
            required: ['card', 'field'],
            description: grammarDescription('filter', 'linkedFrom'),
          },
        },
      },
      sort: {
        type: 'array',
        description: grammarDescription('query', 'sort'),
        items: {
          type: 'object',
          properties: {
            by: {
              type: 'string',
              description: grammarDescription('sortEntry', 'by'),
            },
            on: queryCodeRef(grammarDescription('sortEntry', 'on')),
            direction: {
              enum: ['asc', 'desc'],
              description: grammarDescription('sortEntry', 'direction'),
            },
            missing: {
              enum: ['first', 'last'],
              description: grammarDescription('sortEntry', 'missing'),
            },
            near: {
              type: 'array',
              items: { type: 'number' },
              description: grammarDescription('sortEntry', 'near'),
            },
            of: {
              type: 'array',
              items: {
                type: 'object',
                properties: {},
                description:
                  "A sort entry (by, on, direction, near), a '_expr' entry, or a boost { by: '_when', when: <filter>, weight }, plus an optional nonzero 'weight' (default 1; negative inverts the signal).",
              },
              description: grammarDescription('sortEntry', 'of'),
            },
            k: {
              type: 'number',
              description: grammarDescription('sortEntry', 'k'),
            },
            weights: {
              type: 'object',
              properties: {},
              description: grammarDescription('sortEntry', 'weights'),
            },
            expr: {
              type: 'string',
              description: grammarDescription('sortEntry', 'expr'),
            },
            expression: {
              type: 'string',
              description: grammarDescription('sortEntry', 'expression'),
            },
            top: {
              type: 'integer',
              description: grammarDescription('sortEntry', 'top'),
            },
            compare: {
              type: 'object',
              properties: {},
              description: grammarDescription('sortEntry', 'compare'),
            },
          },
        },
      },
      collapse: {
        type: 'object',
        properties: {
          by: { type: 'string' },
          on: queryCodeRef(grammarDescription('collapse', 'on')),
          keep: { type: 'integer' },
        },
        required: ['by'],
        description: grammarDescription('query', 'collapse'),
      },
      facets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            by: { type: 'string' },
            size: { type: 'integer' },
            own: { enum: ['ignore'] },
            stats: { type: 'boolean' },
            ranges: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  from: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  to: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                },
              },
            },
            interval: {
              type: 'string',
              enum: ['day', 'week', 'month', 'year'],
            },
            prefix: { type: 'string' },
            missing: { type: 'boolean' },
            order: { enum: ['count', 'value', 'measure'] },
            measure: {
              type: 'object',
              properties: {
                avg: { type: 'string' },
                min: { type: 'string' },
                max: { type: 'string' },
                sum: { type: 'string' },
              },
            },
          },
          required: ['by'],
        },
        description: grammarDescription('query', 'facets'),
      },
      timeZone: {
        type: 'string',
        description: grammarDescription('query', 'timeZone'),
      },
      let: {
        type: 'object',
        properties: {},
        description: grammarDescription('query', 'let'),
      },
      page: {
        type: 'object',
        properties: {
          number: {
            type: 'integer',
            description: grammarDescription('page', 'number'),
          },
          size: {
            type: 'integer',
            description: grammarDescription('page', 'size'),
          },
          total: {
            enum: ['capped', 'exact', 'none'],
            description: grammarDescription('page', 'total'),
          },
        },
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
 * `enumField()` (base/enum.gts) attaches its options to the generated
 * FieldDef subclass as `static configuration = { enum: { options } }`.
 * Surface those as JSON-Schema `enum` values. Options are either rich
 * `{ value, label }` objects or bare primitives; the allowed value is
 * `option.value` for the former, the option itself for the latter.
 *
 * The function form of `configuration` (model-dependent options, e.g. a
 * status list configured per project) cannot be resolved at schema-generation
 * time. When `defaultOptions` is provided, it returns them with
 * `isDynamic: true` so callers can use a non-constraining description hint
 * instead of a hard `enum` — preserving the AI's ability to use custom
 * project values that differ from the defaults.
 */
function getEnumValues(
  def: typeof CardAPI.BaseDef,
): { values: unknown[]; isDynamic: boolean } | undefined {
  let configuration = (def as { configuration?: unknown }).configuration;
  if (typeof configuration === 'function') {
    let defaultOptions = (def as { defaultOptions?: unknown[] }).defaultOptions;
    if (Array.isArray(defaultOptions) && defaultOptions.length > 0) {
      return {
        values: defaultOptions.map((option) =>
          option !== null && typeof option === 'object' && 'value' in option
            ? (option as { value: unknown }).value
            : option,
        ),
        isDynamic: true,
      };
    }
    return undefined;
  }
  if (!configuration || typeof configuration !== 'object') {
    return undefined;
  }
  let options = (configuration as { enum?: { options?: unknown } }).enum
    ?.options;
  if (!Array.isArray(options) || options.length === 0) {
    return undefined;
  }
  return {
    values: options.map((option) =>
      option !== null && typeof option === 'object' && 'value' in option
        ? (option as { value: unknown }).value
        : option,
    ),
    isDynamic: false,
  };
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
    let schema = getPrimitiveType(def, mappings);
    let enumResult = getEnumValues(def);
    if (schema && enumResult) {
      if (enumResult.isDynamic) {
        // Options are resolved at runtime from the model instance, so
        // defaultOptions only represents typical values — use a description
        // hint rather than a hard enum constraint to avoid rejecting valid
        // custom project values.
        let hint = `Typical values: ${enumResult.values.map((v) => JSON.stringify(v)).join(', ')}`;
        return {
          ...schema,
          description: hint,
          examples: enumResult.values,
        } as AttributesSchema;
      }
      return { ...schema, enum: enumResult.values } as AttributesSchema;
    }
    return schema;
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

    let desc = cardApi.getFieldDescription(def, fieldName);
    if (desc) {
      schema.properties[fieldName].description = desc;
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
        description: cardApi.getFieldDescription(def, fName),
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

// The `description` argument every tool call carries is a one-sentence label
// the assistant UI shows on the tool pill. No command reads it, so the host
// does not require it when validating a call: a request that has everything
// the command needs must not fail over a missing label. The tool definitions
// handed to the model still list it as required, and this text tells the
// model what to put there, so the label is rarely missing in practice.
export const TOOL_CALL_DESCRIPTION_SCHEMA = {
  type: 'string',
  description:
    'One short sentence, for the user, saying what this call does and why.',
} as const;

// What the model is told a tool call must include. Deliberately stricter
// than host validation, which requires only `attributes`.
export const TOOL_CALL_REQUIRED_PROPERTIES = ['attributes', 'description'];

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
          description: TOOL_CALL_DESCRIPTION_SCHEMA,
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
        required: TOOL_CALL_REQUIRED_PROPERTIES,
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
