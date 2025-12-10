import {
  internalKeyFor,
  identifyCard,
  primitive,
  fieldSerializer,
} from './index';
import type { CodeRef } from './code-ref';
import type { SerializerName } from './serializers';
import type { FieldType } from 'https://cardstack.com/base/card-api';
import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export interface FieldDefinition {
  type: FieldType;
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: CodeRef;
  serializerName?: SerializerName;
}

export interface Definition {
  type: 'card-def' | 'field-def';
  codeRef: CodeRef;
  displayName: string | null;
  fields: {
    [fieldName: string]: FieldDefinition;
  };
}


// we are only recursing 3 levels deep when we see a card def that we have already encountered,
// we capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
// we do not capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
const RECURSING_DEPTH = 3;

function recursingDepth(): number {
  return (globalThis as any).__boxel_definitions_recursing_depth != null
    ? (globalThis as any).__boxel_definitions_recursing_depth
    : RECURSING_DEPTH;
}

export function getFieldDefinitions(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
  results: Definition['fields'] = {},
  prefix = '',
  visited: string[] = [],
) {
  let cardKey = internalKeyFor(identifyCard(cardDef)!, undefined);
  let fields = api.getFields(cardDef, { includeComputeds: true });
  for (let [fieldName, field] of Object.entries(fields)) {
    let fullFieldName = `${prefix ? prefix + '.' : ''}${fieldName}`;
    let isPrimitive = primitive in field.card;
    results[fullFieldName] = {
      type: field.fieldType,
      isPrimitive,
      isComputed: Boolean(field.computeVia),
      fieldOrCard: identifyCard(field.card)!,
      serializerName:
        fieldSerializer in field.card
          ? (field.card[fieldSerializer] as SerializerName)
          : undefined,
    };
    if (!isPrimitive) {
      if (visited.filter((v) => v === cardKey).length > recursingDepth()) {
        return results;
      }
      getFieldDefinitions(api, field.card, results, fullFieldName, [
        ...visited,
        cardKey,
      ]);
    }
  }
  return results;
}
