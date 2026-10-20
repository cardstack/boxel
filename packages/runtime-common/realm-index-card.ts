import type { CardDef } from '@cardstack/base/card-api';

import { realmURL } from './constants.ts';
import { RealmPaths, ensureTrailingSlash } from './paths.ts';
import {
  type RealmIdentifier,
  type RealmResourceIdentifier,
  ri,
  rri,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// Whether `cardId` names the `index` card at the root of `realm`.
//
// Without a VirtualNetwork the comparison is same-form: the id and the realm
// must both be URLs or both be in prefix form (`@scope/name/`). A caller that
// holds the realm as a URL and the id as a prefix-form RRI passes the network,
// which folds both onto their canonical RRI form, the form card ids take, before
// the path is compared. The realm is given its trailing slash first, so a
// slashless realm URL still folds onto its prefix.
export function isRealmIndexCardId(
  cardId: RealmResourceIdentifier | undefined,
  realm: RealmIdentifier | URL | undefined,
  virtualNetwork?: VirtualNetwork,
): boolean {
  if (!cardId || !realm) {
    return false;
  }
  try {
    let realmId: string = realm instanceof URL ? realm.href : realm;
    let id: string = cardId;
    if (virtualNetwork) {
      realmId = virtualNetwork.unresolveURL(ensureTrailingSlash(realmId));
      id = virtualNetwork.unresolveURL(id);
    }
    let realmPaths = new RealmPaths(ri(realmId));
    return realmPaths.inRealm(rri(id)) && realmPaths.local(rri(id)) === 'index';
  } catch {
    return false;
  }
}

export function isRealmIndexCard(
  card: CardDef | undefined,
  virtualNetwork?: VirtualNetwork,
): boolean {
  let cardId = typeof card?.id === 'string' ? rri(card.id) : undefined;
  return isRealmIndexCardId(cardId, card?.[realmURL], virtualNetwork);
}
