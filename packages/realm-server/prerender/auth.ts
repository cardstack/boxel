import {
  ensureTrailingSlash,
  logger,
  VirtualNetwork,
  type PrerenderAuthOptions,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { createJWT } from '../jwt.ts';

const log = logger('prerenderer');

// `realmServerURL` wins when given. Without it, each token's server URL is the
// origin of its realm's URL. Permission maps key realms by id, which can be a
// prefix-form RRI such as `@cardstack/base/`, so `resolveRealmURL` turns an id
// into the URL its mapping points at. Without a resolver, an empty
// VirtualNetwork resolves ids: it parses a URL-form id and refuses a
// prefix-form one.
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
  let toURL: (realm: string) => URL;
  if (resolveRealmURL) {
    toURL = resolveRealmURL;
  } else {
    let network = new VirtualNetwork();
    toURL = (realm) => network.toURL(realm);
  }
  let serverURLFor = (realm: string): string | undefined => {
    if (normalizedServerURL) {
      return normalizedServerURL;
    }
    try {
      return ensureTrailingSlash(toURL(realm).origin);
    } catch (e: any) {
      log.warn(
        `Not issuing a prerender token for realm ${realm}: cannot determine its realm server URL: ${e?.message ?? e}`,
      );
      return undefined;
    }
  };
  return (
    userId: string,
    permissions: RealmPermissions,
    opts?: PrerenderAuthOptions,
  ): string => {
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
          ...(opts?.realmAuthority ? { realmAuthority: true as const } : {}),
        },
        '1d',
        secretSeed,
      );
    }
    return JSON.stringify(sessions);
  };
}
