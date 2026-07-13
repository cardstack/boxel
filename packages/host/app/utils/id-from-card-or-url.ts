import { rri, type RealmResourceIdentifier } from '@cardstack/runtime-common';

import type { CardDef } from '@cardstack/base/card-api';

export function idFromCardOrURL(
  cardOrURL: CardDef | URL | string,
): RealmResourceIdentifier {
  if (typeof cardOrURL === 'string') return rri(cardOrURL);
  if (cardOrURL instanceof URL) return rri(cardOrURL.href);
  return rri(cardOrURL.id);
}
