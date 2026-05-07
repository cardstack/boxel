import type { CardDef } from 'https://cardstack.com/base/card-api';

import { realmURL } from './constants';
import { cardIdToURL } from './card-reference-resolver';
import { RealmPaths } from './paths';

export function isRealmIndexCardId(
  cardId: string | undefined,
  realm: string | URL | undefined,
): boolean {
  if (!cardId || !realm) {
    return false;
  }
  try {
    let realmPaths = new RealmPaths(
      typeof realm === 'string' ? new URL(realm) : realm,
    );
    let cardURL = cardIdToURL(cardId);
    return (
      realmPaths.inRealm(cardURL) &&
      realmPaths.local(cardURL) === 'index'
    );
  } catch {
    return false;
  }
}

export function isRealmIndexCard(card: CardDef | undefined): boolean {
  let cardId = typeof card?.id === 'string' ? card.id : undefined;
  return isRealmIndexCardId(cardId, card?.[realmURL]);
}
