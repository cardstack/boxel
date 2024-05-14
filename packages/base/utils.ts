import { initSharedState } from 'shared-state';
import { isBaseInstance, type BaseDef } from './base-def';
import { type CardDef } from './card-def';
import { type FieldDef } from './field-def';

export function isCardOrField(card: any): card is CardDef | FieldDef {
  return card && typeof card === 'object' && isBaseInstance in card;
}

export function isCard(card: any): card is CardDef {
  return isCardOrField(card) && !('isFieldDef' in card.constructor);
}

export function isFieldDef(field: any): field is FieldDef {
  return isCardOrField(field) && 'isFieldDef' in field.constructor;
}

// this is not for consumption by the outside world, which should not
// mark a card as being saved outside normal channels
export const isSavedInstance = Symbol.for('__cardstack-is-saved-instance');

export function isSaved(instance: CardDef): boolean {
  return instance[isSavedInstance] === true;
}

export const useIndexBasedKey = Symbol.for('cardstack-use-index-based-key');

const deserializedData = initSharedState(
  'deserializedData',
  () => new WeakMap<BaseDef, Map<string, any>>(),
);

export function getDataBucket<T extends BaseDef>(
  instance: T,
): Map<string, any> {
  let deserialized = deserializedData.get(instance);
  if (!deserialized) {
    deserialized = new Map();
    deserializedData.set(instance, deserialized);
  }
  return deserialized;
}
