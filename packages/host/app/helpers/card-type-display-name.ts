import { CardBase } from 'https://cardstack.com/base/card-api';

export function cardTypeDisplayName(card: CardBase): string {
  return card.constructor.displayName;
}
