import jwt from 'jsonwebtoken';
import {
  ensureTrailingSlash,
  logger,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  oauthTabTokenContext,
  oauthTabTokenSecret,
  type CreateOAuthTabAuth,
  type OAuthTabTokenContext,
} from '@cardstack/runtime-common/oauth-tab-token';
import { resolvePrerenderManagerRequestTimeoutMs } from '../prerender/prerender-constants.ts';
import { assertNoSecureSessionClaim } from '../utils/jwt.ts';

// Minting and verifying the tab token (`runtime-common/oauth-tab-token.ts`):
// what a prerender tab holds in place of the user's sessions when an OAuth
// app starts the command or capture it runs. The signature says only that
// this server minted it, so whoever accepts one also checks its grant, on
// every call (`resolveOAuthGrant`).

const log = logger('boxel:oauth-provider');

// How long a tab token lasts: one prerender request's time limit, which the
// work it was minted for is given up on after, plus a minute for the request
// to wait for a tab and be retried. A retry that starts later than that runs
// with an expired token and fails, rather than the token outliving the work.
export function oauthTabTokenLifetimeSeconds(): number {
  return Math.ceil(resolvePrerenderManagerRequestTimeoutMs() / 1000) + 60;
}

// Builds the `CreateOAuthTabAuth` a process mints tab tokens with, under its
// secret seed. As `buildCreatePrerenderAuth` does, each token names the
// server its realm is served from: `realmServerURL` when given, otherwise the
// origin of the realm's URL, which `resolveRealmURL` gives for a realm named
// by a prefix. A realm whose server can't be determined gets no token.
export function buildCreateOAuthTabAuth(
  realmSecretSeed: string,
  {
    realmServerURL,
    resolveRealmURL,
    lifetimeSeconds = oauthTabTokenLifetimeSeconds,
  }: {
    realmServerURL?: string;
    resolveRealmURL?: (realm: string) => URL;
    lifetimeSeconds?: () => number;
  } = {},
): CreateOAuthTabAuth {
  let normalizedServerURL = realmServerURL
    ? ensureTrailingSlash(realmServerURL)
    : undefined;
  let network = resolveRealmURL ? undefined : new VirtualNetwork();
  let toURL = resolveRealmURL ?? ((realm: string) => network!.toURL(realm));
  let serverURLFor = (realm: string): string | undefined => {
    if (normalizedServerURL) {
      return normalizedServerURL;
    }
    try {
      return ensureTrailingSlash(toURL(realm).origin);
    } catch (e: any) {
      log.warn(
        `Not issuing a tab token for realm ${realm}: cannot determine its realm server URL: ${e?.message ?? e}`,
      );
      return undefined;
    }
  };
  return ({
    userId,
    permissions,
    grantId,
    scopes,
    purpose,
    permissionCeiling,
  }) => {
    let now = Math.floor(Date.now() / 1000);
    let exp = now + lifetimeSeconds();
    let sessions: Record<string, string> = {};
    for (let [realmURL, realmPermissions] of Object.entries(permissions)) {
      let server = serverURLFor(realmURL);
      if (!server) {
        continue;
      }
      let claims = {
        user: userId,
        realm: realmURL,
        // Only what the host reads to decide what it offers. A realm reads
        // the user's permissions fresh on every call, held to the scopes.
        permissions: heldTo(realmPermissions, permissionCeiling),
        sessionRoom: '',
        realmServerURL: server,
        oauthTab: { grant: grantId, scopes: [...scopes], purpose },
        iat: now,
        exp,
      };
      assertNoSecureSessionClaim(claims);
      sessions[realmURL] = jwt.sign(
        claims,
        oauthTabTokenSecret(realmSecretSeed),
      );
    }
    return JSON.stringify(sessions);
  };
}

// A realm's permissions as a tab token's claim gives them: read, and write
// only where the ceiling allows it. Nothing administers.
function heldTo(permissions: string[], ceiling: 'read' | 'write'): string[] {
  return permissions.filter(
    (permission) =>
      permission === 'read' || (permission === 'write' && ceiling === 'write'),
  );
}

export type OAuthTabTokenVerification =
  | { ok: true; context: OAuthTabTokenContext }
  | { ok: false; reason: 'expired' | 'invalid' };

// What a tab token says, when it verifies under the tab-token key, within its
// expiry, and is well formed. The caller checks its grant before acting on it.
export function verifyOAuthTabToken(
  token: string,
  realmSecretSeed: string,
): OAuthTabTokenVerification {
  let claims: jwt.JwtPayload | string;
  try {
    claims = jwt.verify(token, oauthTabTokenSecret(realmSecretSeed));
  } catch (e: any) {
    return {
      ok: false,
      reason: e?.name === 'TokenExpiredError' ? 'expired' : 'invalid',
    };
  }
  if (typeof claims !== 'object') {
    return { ok: false, reason: 'invalid' };
  }
  let context = oauthTabTokenContext(claims);
  return context ? { ok: true, context } : { ok: false, reason: 'invalid' };
}
