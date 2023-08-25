import { BaseDef } from 'https://cardstack.com/base/card-api';

export function cardTypeDisplayName(cardOrField: BaseDef): string {
  return cardOrField.constructor.getDisplayName(cardOrField);
}
