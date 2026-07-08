import type {
  BaseDef,
  BaseDefConstructor,
  Field,
} from 'https://cardstack.com/base/card-api';

import { getField } from '../code-ref.ts';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  // A not-yet-loaded or broken relationship link can surface an undefined
  // model to a card's own template (the linksTo component only renders the
  // broken-link template for specific membership states). Guard like the
  // sibling helpers below so an unguarded `{{cardTypeDisplayName @model}}`
  // renders empty instead of throwing and failing the whole card render.
  if (!cardOrField?.constructor) {
    return '';
  }
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
