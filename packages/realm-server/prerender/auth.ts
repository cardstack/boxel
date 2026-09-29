import {
  ensureTrailingSlash,
  isUrlLike,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { createJWT } from '../jwt.ts';

// `realmServerURL` wins when given. Without it, each token's server URL is the
// origin of its realm's URL. Permission maps key realms by id, which can be a
// prefix-form RRI such as `@cardstack/base/`, so `resolveRealmURL` turns an id
// into the URL its mapping points at; a URL-form id is parsed directly.
export function buildCreatePrerenderAuth(
  secretSeed: string,
  realmServerURL?: string,
  resolveRealmURL?: (realm: string) => URL,
) {
  let normalizedServerURL = realmServerURL
    ? ensureTrailingSlash(realmServerURL)
    : undefined;
  let serverURLFor = (realm: string): string => {
    if (normalizedServerURL) {
      return normalizedServerURL;
    }
    let url: URL;
    if (resolveRealmURL) {
      url = resolveRealmURL(realm);
    } else if (isUrlLike(realm)) {
      url = new URL(realm);
    } else {
      throw new Error(
        `Cannot determine the realm server URL for realm ${realm}: it is not a URL, and no realm server URL or realm resolver was given`,
      );
    }
    return ensureTrailingSlash(url.origin);
  };
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
          realmServerURL: serverURLFor(realmURL),
        },
        '1d',
        secretSeed,
      );
    }
    return JSON.stringify(sessions);
  };
}
