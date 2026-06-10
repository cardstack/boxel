import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import type { RealmClient } from '@cardstack/runtime-common/realm-client';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from './profile-manager.ts';

// Strips a trailing `_<endpoint>` segment (e.g. `_readiness-check`) to recover
// the realm URL an endpoint belongs to, so the per-realm token can be fetched.
function realmURLForEndpoint(url: string): string {
  let parsed = new URL(url);
  let segments = parsed.pathname.split('/');
  if (segments[segments.length - 1].startsWith('_')) {
    segments[segments.length - 1] = '';
    parsed.pathname = segments.join('/');
  }
  return parsed.href;
}

// Builds the `RealmClient` the shared realm operations consume from the CLI's
// `ProfileManager`. `authedFetch` routes by URL: realm-server endpoints go
// through `authedRealmServerFetch` (realm-server JWT, with its own 401-refresh),
// while per-realm endpoints carry that realm's token — fetched lazily and
// cached, and omitted when unavailable since published realms are public-read.
export function buildCliRealmClient(
  profileManager: ProfileManager = getProfileManager(),
): RealmClient {
  let active = profileManager.getActiveProfile();
  if (!active) {
    throw new Error(NO_ACTIVE_PROFILE_ERROR);
  }
  let realmServerURL = ensureTrailingSlash(active.profile.realmServerUrl);
  let realmTokenCache = new Map<string, string | undefined>();

  async function realmTokenFor(realmURL: string): Promise<string | undefined> {
    if (realmTokenCache.has(realmURL)) {
      return realmTokenCache.get(realmURL);
    }
    let token: string | undefined;
    try {
      let serverToken = await profileManager.getOrRefreshServerToken();
      token = await profileManager.fetchAndStoreRealmToken(
        realmURL,
        serverToken,
      );
    } catch {
      // Published realms are permission-public-read; fall through to poll
      // without an Authorization header.
      token = undefined;
    }
    realmTokenCache.set(realmURL, token);
    return token;
  }

  return {
    realmServerURL,
    // Target resolution (which reads these) isn't wired into the CLI yet; the
    // publish/unpublish/readiness operations the CLI uses don't read config.
    config: { spaceDomain: '', siteDomain: '' },
    authedFetch: async (url, init) => {
      if (url.startsWith(realmServerURL)) {
        return profileManager.authedRealmServerFetch(url, init);
      }
      let token = await realmTokenFor(realmURLForEndpoint(url));
      let headers = new Headers(init?.headers);
      if (token) {
        headers.set('Authorization', token);
      }
      return fetch(url, { ...init, headers });
    },
  };
}
