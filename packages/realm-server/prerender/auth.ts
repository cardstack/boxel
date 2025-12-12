import type { RealmPermissions } from '@cardstack/runtime-common';
import { createJWT } from '../jwt';

export function buildCreatePrerenderAuth(secretSeed: string) {
  return (userId: string, permissions: RealmPermissions): string => {
    let sessions: { [realm: string]: string } = {};
    for (let [realmURL, realmPermissions] of Object.entries(
      permissions ?? {},
    )) {
      sessions[realmURL] = createJWT(
        {
          user: userId,
          realm: realmURL,
          permissions: realmPermissions,
          sessionRoom: '',
        },
        '1d',
        secretSeed,
      );
    }
    return JSON.stringify(sessions);
  };
}
