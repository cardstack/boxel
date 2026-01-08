import {
  ensureTrailingSlash,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { createJWT } from '../jwt';

export function buildCreatePrerenderAuth(
  secretSeed: string,
  realmServerURL?: string,
) {
  let normalizedServerURL = realmServerURL
    ? ensureTrailingSlash(realmServerURL)
    : undefined;
  return (userId: string, permissions: RealmPermissions): string => {
    let sessions: { [realm: string]: string } = {};
    for (let [realmURL, realmPermissions] of Object.entries(
      permissions ?? {},
    )) {
      let resolvedRealmServerURL =
        normalizedServerURL ?? ensureTrailingSlash(new URL(realmURL).origin);
      sessions[realmURL] = createJWT(
        {
          user: userId,
          realm: realmURL,
          permissions: realmPermissions,
          sessionRoom: '',
          realmServerURL: resolvedRealmServerURL,
        },
        '1d',
        secretSeed,
      );
    }
    return JSON.stringify(sessions);
  };
}
