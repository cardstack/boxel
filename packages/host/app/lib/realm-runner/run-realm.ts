import {
  rri,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import type NetworkService from '../../services/network';
import type RealmService from '../../services/realm';

interface Services {
  realm: Pick<RealmService, 'realmOf'>;
  network: Pick<NetworkService, 'virtualNetwork'>;
}

// The realm a `run-realm-code` call names (or the open workspace's, which
// can come without a realm root's trailing slash), as the realm service
// knows it. Undefined for one no known realm holds.
export function runRealmOf(
  services: Services,
  realmInput: string,
): RealmIdentifier | undefined {
  let realmId: RealmResourceIdentifier = rri(
    realmInput.endsWith('/') ? realmInput : `${realmInput}/`,
  );
  let realm = services.realm.realmOf(realmId);
  if (realm) {
    return realm;
  }
  try {
    return services.realm.realmOf(
      services.network.virtualNetwork.toURL(realmId),
    );
  } catch {
    // resolves nowhere, so it names no known realm
    return undefined;
  }
}

// The URL a run's paths resolve from: the realm's root, in URL form for a
// realm known by its prefix.
export function runRootURL(services: Services, realm: string): string {
  let { virtualNetwork } = services.network;
  return virtualNetwork.isRegisteredPrefix(realm)
    ? virtualNetwork.toURL(realm).href
    : new URL(realm).href;
}
