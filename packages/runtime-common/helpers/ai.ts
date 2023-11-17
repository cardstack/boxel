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
 *
 * @param loader
 * @returns
 */
export async function basicMappings(loader: Loader) {
  let mappings = new Map<typeof CardAPI.FieldDef, Schema>();

  const { default: StringField } = await loader.import(
    'https://cardstack.com/base/string',
  );
  const { default: NumberField } = await loader.import(
    'https://cardstack.com/base/number',
  );
  const { default: DateField } = await loader.import(
    'https://cardstack.com/base/date',
  );
  const { default: DateTimeField } = await loader.import(
    'https://cardstack.com/base/datetime',
  );
  const { default: BooleanField } = await loader.import(
    'https://cardstack.com/base/boolean',
  );
  mappings.set(StringField, {
    type: 'string',
  });
  mappings.set(NumberField, {
    type: 'number',
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
  mappings: Map<typeof CardAPI.FieldDef, Schema>,
) {
  if (!def.isFieldDef) {
    return undefined;
  }
  if (mappings.has(def)) {
    return mappings.get(def);
  } else {
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
 * @param def - The BaseDef to generate the patch call specification for.
 * @param cardApi - The card API to use to generate the patch call specification
 * @param mappings - A map of field definitions to JSON schema
 * @returns The generated patch call specification as JSON schema
 */
export function generatePatchCallSpecification(
  def: typeof CardAPI.BaseDef,
  cardApi: typeof CardAPI,
  mappings: Map<typeof CardAPI.FieldDef, Schema>,
) {
  // An explicit list of types that we will support in the patch call
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
