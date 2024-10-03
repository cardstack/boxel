import { BaseDef } from 'https://cardstack.com/base/card-api';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  return cardOrField.constructor.getDisplayName(cardOrField);
}

export function cardTypeIcon(cardOrField: BaseDef) {
  return cardOrField.constructor.getIconComponent(cardOrField);
}
