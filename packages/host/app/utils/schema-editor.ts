import { type Type } from '@cardstack/host/resources/card-type';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

export function isOwnField(card: typeof BaseDef, fieldName: string): boolean {
  return Object.keys(Object.getOwnPropertyDescriptors(card.prototype)).includes(
    fieldName,
  );
}

export function calculateTotalOwnFields(
  card: typeof BaseDef,
  cardType: Type,
): number {
  return cardType.fields.filter((field) => isOwnField(card, field.name)).length;
}
