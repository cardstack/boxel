import { BaseDef } from 'https://cardstack.com/base/card-api';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  return cardOrField.constructor.getDisplayName(cardOrField);
}

export function cardTypeIcon(cardOrField: BaseDef) {
  if (!cardOrField.constructor) {
    console.warn('cardOrField.constructor is undefined', cardOrField);
  }
  return cardOrField.constructor?.getIconComponent?.(cardOrField);
}
