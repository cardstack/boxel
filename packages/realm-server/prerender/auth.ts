import {
  ensureTrailingSlash,
  isUrlLike,
  logger,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { createJWT } from '../jwt.ts';

const log = logger('prerenderer');

// `realmServerURL` wins when given. Without it, each token's server URL is the
// origin of its realm's URL. Permission maps key realms by id, which can be a
// prefix-form RRI such as `@cardstack/base/`, so `resolveRealmURL` turns an id
// into the URL its mapping points at; a URL-form id is parsed directly.
//
// A realm whose URL cannot be determined gets no token and a warning. The
// permission map includes every public realm, so one unmapped id (a stale
// public row, or a realm the worker was not given a mapping for) would
// otherwise fail every render, not only renders that touch that realm.
export function buildCreatePrerenderAuth(
  secretSeed: string,
  realmServerURL?: string,
  resolveRealmURL?: (realm: string) => URL,
) {
  let normalizedServerURL = realmServerURL
    ? ensureTrailingSlash(realmServerURL)
    : undefined;
  let serverURLFor = (realm: string): string | undefined => {
    if (normalizedServerURL) {
      return normalizedServerURL;
    }
    try {
      if (resolveRealmURL) {
        return ensureTrailingSlash(resolveRealmURL(realm).origin);
      }
      if (isUrlLike(realm)) {
        return ensureTrailingSlash(new URL(realm).origin);
      }
    } catch (e: any) {
      log.warn(
        `Not issuing a prerender token for realm ${realm}: cannot determine its realm server URL: ${e?.message ?? e}`,
      );
      return undefined;
    }
    log.warn(
      `Not issuing a prerender token for realm ${realm}: it is not a URL, and no realm server URL or realm resolver was given`,
    );
    return undefined;
  };
  return (userId: string, permissions: RealmPermissions): string => {
    let sessions: { [realm: string]: string } = {};
    for (let [realmURL, realmPermissions] of Object.entries(
      permissions ?? {},
    )) {
      let resolvedRealmServerURL = serverURLFor(realmURL);
      if (!resolvedRealmServerURL) {
        continue;
      }
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
