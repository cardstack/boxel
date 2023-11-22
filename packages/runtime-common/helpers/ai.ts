import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { primitive } from '../constants';
import { Loader } from '../loader';

type EmptySchema = {};

type ArraySchema = {
  type: 'array';
  items: Schema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

type ObjectSchema = {
  type: 'object';
  properties: {
    [fieldName: string]: Schema;
  };
  required?: string[];
};

type DateSchema = {
  type: 'string';
  format: 'date' | 'date-time';
};

type NumberSchema = {
  type: 'number' | 'integer';
  exclusiveMinimum?: number;
  minimum?: number;
  exclusiveMaximum?: number;
  maximum?: number;
  multipleOf?: number;
};

type StringSchema = {
  type: 'string';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

type BooleanSchema = {
  type: 'boolean';
};

type EnumSchema = {
  // JSON Schema allows a mix of any types in an enum
  enum: any[];
};

type Schema =
  | EmptySchema
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
    return mappings.get(def);
  } else {
    // Try the parent class, recurse up until we hit a type recognised
    return getPrimitiveType(Object.getPrototypeOf(def), mappings);
  }
}

/**
 * From a card definition, generate a JSON Schema that can be used to
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
export function generatePatchCallSpecification(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, Schema>,
) {
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

  const { id: removedIdField, ...fields } = cardApi.getFields(def, {
    usedFieldsOnly: false,
  });

  //
  for (let [fieldName, field] of Object.entries(fields)) {
    // We're generating patch data, so computeds should be skipped
    // as should any linksTo or linksToMany fields
    if (
      field.computeVia ||
      field.fieldType == 'linksTo' ||
      field.fieldType == 'linksToMany'
    ) {
      continue;
    }
    const fieldSchema = generatePatchCallSpecification(
      field.card,
      cardApi,
      mappings,
    );
    // This happens when we have no known schema for the field type
    if (fieldSchema == undefined) {
      continue;
    }
    if (field.fieldType == 'containsMany') {
      schema.properties[fieldName] = {
        type: 'array',
        items: fieldSchema,
      };
    } else if (field.fieldType == 'contains') {
      schema.properties[fieldName] = fieldSchema;
    }
  }
  return schema;
}
