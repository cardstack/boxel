import {
  ensureTrailingSlash,
  logger,
  renderSessionSecret,
  VirtualNetwork,
  type PrerenderAuthOptions,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { INCREMENTAL_INDEX_JOB_TIMEOUT_SEC } from '@cardstack/runtime-common/jobs/indexing';
import { FROM_SCRATCH_JOB_TIMEOUT_SEC } from '@cardstack/runtime-common/tasks/indexer';
import { createJWT } from '../jwt.ts';

const log = logger('prerenderer');

// `realmServerURL` wins when given. Without it, each token's server URL is the
// origin of its realm's URL. Permission maps key realms by id, which can be a
// prefix-form RRI such as `@cardstack/base/`, so `resolveRealmURL` turns an id
// into the URL its mapping points at. Without a resolver, an empty
// VirtualNetwork resolves ids: it parses a URL-form id and refuses a
// prefix-form one.
//
// With `realmAuthority`, each token is a render session
// (`runtime-common/render-session.ts`): read-only, signed under its own key,
// and good for as long as the longest job that renders under it. Without it,
// each is an ordinary session for the user, as the realm's own sign-in would
// hand them.
//
// A realm whose URL cannot be determined gets no token and a warning. The
// permission map includes every public realm, so one unmapped id (a stale
// public row, or a realm the worker was not given a mapping for) would
// otherwise fail every render, not only renders that touch that realm.
export function buildCreatePrerenderAuth(
  secretSeed: string,
  realmServerURL?: string,
  resolveRealmURL?: (realm: string) => URL,
  {
    renderSessionLifetimeSeconds:
      lifetimeSeconds = renderSessionLifetimeSeconds,
  }: { renderSessionLifetimeSeconds?: () => number } = {},
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
      let claims = {
        user: userId,
        realm: realmURL,
        // Only what the host reads to decide what it shows. A realm judges a
        // render session by the user's read alone.
        permissions: realmPermissions,
        sessionRoom: '',
        realmServerURL: resolvedRealmServerURL,
      };
      sessions[realmURL] = opts?.realmAuthority
        ? createJWT(
            {
              ...claims,
              realmAuthority: true,
              renderSession: { scope: 'owner-read-set' },
            },
            lifetimeSeconds(),
            renderSessionSecret(secretSeed),
          )
        : createJWT(claims, '1d', secretSeed);
    }
    return JSON.stringify(sessions);
  };
}

// How long a render session lasts: the longest an indexing or HTML render job
// may run before it is given up on, which every job that mints one renders
// within, plus five minutes for the job to start rendering. A job retried
// after that mints its sessions again.
export function renderSessionLifetimeSeconds(): number {
  return (
    Math.max(FROM_SCRATCH_JOB_TIMEOUT_SEC, INCREMENTAL_INDEX_JOB_TIMEOUT_SEC) +
    5 * 60
  );
}
