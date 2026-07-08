import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import type { RealmClient } from '@cardstack/runtime-common/realm-client';
import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from './profile-manager.ts';
import { SeedAuthenticator, mintRealmServerToken } from './seed-auth.ts';

// A realm-server endpoint is a single underscore-prefixed segment directly
// under the server root (`_publish-realm`, `_unpublish-realm`, …). A per-realm
// endpoint like `<realm>/_readiness-check` carries a realm path before the
// segment — and a realm shares the realm server's origin, so a bare
// `startsWith(realmServerURL)` prefix can't tell the two apart.
function isRealmServerEndpoint(url: string, realmServerURL: string): boolean {
  if (!url.startsWith(realmServerURL)) {
    return false;
  }
  let rest = url.slice(realmServerURL.length);
  return /^_[^/?#]+\/?(?:[?#].*)?$/.test(rest);
}

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
export interface SeedRealmClientConfig {
  realmSecretSeed: string;
  /** Realm-server origin (trailing slash), e.g. `https://host/`. */
  realmServerURL: string;
  /**
   * Matrix user id to put in the realm-server token. Owner-gated admin
   * endpoints (realm publish) require the realm owner, so callers pass the
   * source realm's owner.
   */
  asUser: string;
}

function isSeedConfig(
  arg: ProfileManager | SeedRealmClientConfig,
): arg is SeedRealmClientConfig {
  return (arg as SeedRealmClientConfig).realmSecretSeed !== undefined;
}

export function buildCliRealmClient(
  auth: ProfileManager | SeedRealmClientConfig = getProfileManager(),
): RealmClient {
  // Seed mode: mint an owner-scoped realm-server token locally for realm-server
  // endpoints, and use a seed-minted realm token for per-realm endpoints — no
  // Matrix profile required.
  if (isSeedConfig(auth)) {
    let realmServerURL = ensureTrailingSlash(auth.realmServerURL);
    let serverToken = mintRealmServerToken(auth.realmSecretSeed, auth.asUser);
    let seedAuth = new SeedAuthenticator({ seed: auth.realmSecretSeed });
    return {
      realmServerURL,
      config: { spaceDomain: '', siteDomain: '' },
      authedFetch: async (url, init) => {
        if (isRealmServerEndpoint(url, realmServerURL)) {
          let headers = new Headers(init?.headers);
          headers.set('Authorization', serverToken);
          return fetch(url, { ...init, headers });
        }
        // Per-realm endpoint (e.g. readiness on the published realm).
        return seedAuth.authedRealmFetch(url, init);
      },
    };
  }

  let profileManager = auth;
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
      if (isRealmServerEndpoint(url, realmServerURL)) {
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
