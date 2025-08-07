import {
  internalKeyFor,
  identifyCard,
  primitive,
  fieldSerializer,
  type ResolvedCodeRef,
  type Definition,
  type SerializerName,
} from './index';

import { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

// we are only recursing 3 levels deep when we see a card def that we have already encountered,
// we capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
// we do not capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
const RECURSING_DEPTH = 3;

export function getFieldDefinitions(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
  results: Definition['fields'] = {},
  prefix = '',
  visited: string[] = [],
) {
  let cardKey = internalKeyFor(
    identifyCard(cardDef) as ResolvedCodeRef,
    undefined,
  );
  let fields = api.getFields(cardDef, { includeComputeds: true });
  for (let [fieldName, field] of Object.entries(fields)) {
    let fullFieldName = `${prefix ? prefix + '.' : ''}${fieldName}`;
    let isPrimitive = primitive in field.card;
    results[fullFieldName] = {
      type: field.fieldType,
      isPrimitive,
      isComputed: Boolean(field.computeVia),
      fieldOrCard: identifyCard(field.card) as ResolvedCodeRef,
      serializerName:
        fieldSerializer in field.card
          ? (field.card[fieldSerializer] as SerializerName)
          : undefined,
    };
    if (!isPrimitive) {
      if (visited.filter((v) => v === cardKey).length > RECURSING_DEPTH) {
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
