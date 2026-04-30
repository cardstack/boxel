import type { CardDef } from 'https://cardstack.com/base/card-api';

export function idFromCardOrURL(
  cardOrURL: CardDef | URL | string,
): string {
  if (typeof cardOrURL === 'string') return cardOrURL;
  if (cardOrURL instanceof URL) return cardOrURL.href;
  return cardOrURL.id;
}
