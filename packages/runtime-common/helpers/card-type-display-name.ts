import type {
  BaseDef,
  BaseDefConstructor,
  Field,
} from 'https://cardstack.com/base/card-api';

import { getField } from '../code-ref';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  return cardOrField.constructor.getDisplayName(cardOrField);
}

export function cardTypeIcon(cardOrField: BaseDef) {
  if (!cardOrField.constructor) {
    console.warn('cardOrField.constructor is undefined', cardOrField);
  }
  return cardOrField.constructor?.getIconComponent?.(cardOrField);
}

export function getFieldIcon(
  baseDef: Partial<BaseDef> | undefined,
  fieldName: string | undefined,
) {
  if (!baseDef?.constructor || !fieldName) {
    console.warn('baseDef, baseDef.constructor, or fieldName is undefined');
    return;
  }
  const field: Field<BaseDefConstructor> | undefined = getField(
    baseDef.constructor,
    fieldName,
  );
  let fieldInstance = field?.card;
  return fieldInstance?.icon;
}
