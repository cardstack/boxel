import type { CardDef } from 'https://cardstack.com/base/card-api';

import { realmURL } from './constants.ts';
import { RealmPaths } from './paths.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export function isRealmIndexCardId(
  cardId: string | undefined,
  realm: string | URL | undefined,
  virtualNetwork: VirtualNetwork,
): boolean {
  if (!cardId || !realm) {
    return false;
  }
  try {
    let realmPaths = new RealmPaths(
      typeof realm === 'string' ? new URL(realm) : realm,
      virtualNetwork,
    );
    let cardURL = virtualNetwork.toURL(cardId);
    return realmPaths.inRealm(cardURL) && realmPaths.local(cardURL) === 'index';
  } catch {
    return false;
  }
}

export function isRealmIndexCard(
  card: CardDef | undefined,
  virtualNetwork: VirtualNetwork,
): boolean {
  let cardId = typeof card?.id === 'string' ? card.id : undefined;
  return isRealmIndexCardId(cardId, card?.[realmURL], virtualNetwork);
}
