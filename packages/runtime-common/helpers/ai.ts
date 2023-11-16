import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { primitive } from '../constants';

type EmptySchema = {};

type ArraySchema = {
  type: 'array';
  items: Schema;
};

type ObjectSchema = {
  type: 'object';
  properties: {
    [fieldName: string]: Schema;
  };
};

type DateSchema = {
  type: 'string';
  format: 'date' | 'date-time';
};

type PrimitiveSchema = {
  type: 'string' | 'number' | 'boolean';
};

type Schema =
  | EmptySchema
  | ArraySchema
  | ObjectSchema
  | DateSchema
  | PrimitiveSchema;

function getPrimitiveType(def: typeof CardAPI.BaseDef) {
  console.log("Getting primitive type for", def);
  if (!def.isFieldDef) {
    return undefined
  }
  switch (def.name) {
    case 'NumberField':
      return { type: 'number' };
    case 'StringField':
      return { type: 'string' };
    case 'BooleanField':
      return { type: 'boolean' };
    case 'DateField':
      return { type: 'string', format: 'date' };
    case 'DateTimeField':
      return { type: 'string', format: 'date-time' };
    default:
      return getPrimitiveType(Object.getPrototypeOf(def));
    // Any case not explicitly known about should be skipped
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
 * @returns The generated patch call specification as JSON schema
 */
export function generatePatchCallSpecification<T extends typeof CardAPI.BaseDef>(
  def: T,
  cardApi: typeof CardAPI,
) {
  console.log("Looking at", def);
  // An explicit list of types that we will support in the patch call
  if (primitive in def) {
    return getPrimitiveType(def);
  }

  // If it's not a primitive, it contains other fields
  // and should be represented by an object
  let schema: ObjectSchema = {
    type: 'object',
    properties: {},
  };

  let { id: removedIdField, ...fields } = cardApi.getFields(def, {
    usedFieldsOnly: false,
  });

  //
  for (let [fieldName, field] of Object.entries(fields)) {
    // We're generating patch data, so computeds should be skipped
    if (field.computeVia || field.fieldType == "linksTo" || field.fieldType == 'linksToMany') {
      continue;
    }
    console.log("Dropping into field", field, field.card);
    let fieldSchema = generatePatchCallSpecification(field.card, cardApi);
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
