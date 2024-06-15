import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { primitive } from '../constants';
import { Loader } from '../loader';

type ArraySchema = {
  type: 'array';
  description?: string;
  items: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type ObjectSchema = {
  type: 'object';
  description?: string;
  properties: {
    [fieldName: string]: Schema;
  };
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
  required: string[]; // fieldName array;
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

export type Schema =
  | ArraySchema
  | ObjectSchema
  | DateSchema
  | NumberSchema
  | StringSchema
  | EnumSchema
  | BooleanSchema;

/**
 * A map of the most common field definitions to their JSON Schema
 * representations.
 */
export async function basicMappings(loader: Loader) {
  let mappings = new Map<typeof CardAPI.FieldDef, Schema>();

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
  mappings: Map<typeof CardAPI.BaseDef, Schema>,
) {
  // If we go beyond fieldDefs there are no matching mappings to use
  if (!('isFieldDef' in def) || !def.isFieldDef) {
    return undefined;
  }
  if (mappings.has(def)) {
    return { ...mappings.get(def) } as Schema;
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
function generatePatchCallSpecification(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, Schema>,
): Schema | undefined {
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

    let fieldSchemaForSingleItem = generatePatchCallSpecification(
      field.card,
      cardApi,
      mappings,
    ) as Schema | undefined;
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

function generatePatchCallRelationshipsSpecification(
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
    required: [],
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
    let flatFieldName = fieldName ? `${fieldName}\.${fName}` : fName;
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
export function generateCardPatchCallSpecification(
  def: typeof CardAPI.CardDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, Schema>,
):
  | { attributes: Schema }
  | { attributes: Schema; relationships: RelationshipsSchema } {
  let schema = generatePatchCallSpecification(def, cardApi, mappings) as
    | Schema
    | undefined;
  if (schema == undefined) {
    return {
      attributes: {
        type: 'object',
        properties: {},
      },
    };
  } else {
    let relationships = generatePatchCallRelationshipsSpecification(
      def,
      cardApi,
    );
    if (
      !relationships ||
      !('required' in relationships) ||
      !relationships.required.length
    ) {
      return { attributes: schema };
    }
    return {
      attributes: schema,
      relationships,
    };
  }
}
