/**
 * The tab token: what a prerender tab holds in place of the user's sessions
 * when an OAuth app (ADR 021) starts the work the tab does, a command or a
 * capture. The tab runs code the caller chose, so anything the tab holds can
 * reach the caller. A tab token reaches no further than the OAuth token
 * behind it (ADR 021 §1.5):
 *
 * - It names the user and the OAuth grant it was minted for, never the OAuth
 *   token or its hash, so it can't be used at the token or revocation
 *   endpoints or linked back to the token.
 * - Wherever it is accepted, the grant is looked up on every call, as an
 *   access token's is, and the verified caller is the same `oauthCaller` an
 *   access token gives: the same route map, scope ceiling and policy guard
 *   apply, and the user's own permissions still decide. Disconnecting the app
 *   ends it on its next call.
 * - It expires when the work it was minted for would be given up on.
 * - It is signed under its own key (`oauthTabTokenSecret`), so every verifier
 *   of ordinary sessions, and of run tokens, refuses it on its signature.
 *
 * One token is minted per realm the work may reach, carrying the realm and
 * the permissions the host reads from a session's claims to decide what it
 * offers; a realm reads the user's permissions fresh and never trusts that
 * claim. A capture's tokens allow reading only, whatever the grant allows.
 *
 * Deliberately a leaf module with no imports, so the realm, the realm server
 * and the worker can share it without pulling in the runtime-common barrel.
 */

export const OAUTH_TAB_TOKEN_SCOPE = 'oauth-tab';

// The work a tab token was minted for.
export type OAuthTabPurpose = 'run-command' | 'capture';

export interface OAuthTabTokenClaim {
  // The OAuth grant's id, which every call checks.
  grant: string;
  // The access token's scopes when the work started. A call admits only the
  // ones its grant still approves.
  scopes: string[];
  purpose: OAuthTabPurpose;
}

// What a verified tab token says.
export interface OAuthTabTokenContext {
  // The Matrix user id of the grant's user.
  user: string;
  // The realm this token was minted for.
  realm: string;
  realmServerURL: string;
  grantId: string;
  scopes: string[];
  purpose: OAuthTabPurpose;
  iat: number;
  exp: number;
}

// Mints the tab's sessions: one tab token per realm in `permissions`, as a
// JSON map of realm URL to token, the shape the tab reads its sessions in.
// Each token's `permissions` claim is the user's permissions there, held to
// `permissionCeiling` (what the scopes allow, held to the purpose's), and is
// only what the host reads to decide what it offers.
export type CreateOAuthTabAuth = (args: {
  userId: string;
  permissions: Record<string, string[]>;
  grantId: string;
  scopes: readonly string[];
  purpose: OAuthTabPurpose;
  permissionCeiling: 'read' | 'write';
}) => string;

/**
 * The signing key for this family: the realm secret seed under a
 * family-specific suffix, never the bare seed.
 */
export function oauthTabTokenSecret(realmSecretSeed: string): string {
  return `${realmSecretSeed}:${OAUTH_TAB_TOKEN_SCOPE}`;
}

function payloadOf(token: string): Record<string, unknown> | undefined {
  let payload = token.split('.')[1];
  if (!payload) {
    return undefined;
  }
  try {
    let claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as unknown;
    return typeof claims === 'object' && claims !== null
      ? (claims as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a token presents itself as a tab token, read from its payload
 * without verifying it. It decides only which key to verify the token
 * against; a token that lies about it fails that verification.
 */
export function presentsAsOAuthTabToken(token: string): boolean {
  let claims = payloadOf(token);
  return claims !== undefined && 'oauthTab' in claims;
}

/**
 * The tab token a request's `Authorization` header carries, with or without
 * its `Bearer` prefix, as the realm reads any other session; otherwise
 * undefined. The host's fetch sends a realm's session bare, so a tab token
 * reaches a realm that way.
 */
export function oauthTabTokenOf(
  authorization: string | null | undefined,
): string | undefined {
  if (!authorization) {
    return undefined;
  }
  let token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : authorization.trim();
  return presentsAsOAuthTabToken(token) ? token : undefined;
}

/**
 * The context of a verified tab token when its claims are well formed;
 * otherwise undefined. The signature and expiry are the verifier's to check
 * before this, and the grant is the caller's to check after.
 */
export function oauthTabTokenContext(claims: {
  user?: unknown;
  realm?: unknown;
  realmServerURL?: unknown;
  oauthTab?: unknown;
  iat?: unknown;
  exp?: unknown;
}): OAuthTabTokenContext | undefined {
  let { user, realm, realmServerURL, oauthTab, iat, exp } = claims;
  if (
    typeof user !== 'string' ||
    !user ||
    typeof realm !== 'string' ||
    !realm ||
    typeof realmServerURL !== 'string' ||
    !realmServerURL ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    typeof oauthTab !== 'object' ||
    oauthTab === null
  ) {
    return undefined;
  }
  let { grant, scopes, purpose } = oauthTab as Record<string, unknown>;
  if (
    typeof grant !== 'string' ||
    !grant ||
    !Array.isArray(scopes) ||
    !scopes.every((scope) => typeof scope === 'string' && scope) ||
    (purpose !== 'run-command' && purpose !== 'capture')
  ) {
    return undefined;
  }
  return {
    user,
    realm,
    realmServerURL,
    grantId: grant,
    scopes: scopes as string[],
    purpose,
    iat,
    exp,
  };
}

// The most a tab token's purpose lets it do in a realm, over and above its
// scopes: a capture only reads.
export function oauthTabPurposeCeiling(
  purpose: OAuthTabPurpose,
): 'read' | 'write' {
  return purpose === 'capture' ? 'read' : 'write';
}

// The realm permission ceiling a tab token's caller gets: the scopes' ceiling,
// held to its purpose's.
export function oauthTabPermissionCeiling(
  scopeCeiling: 'read' | 'write' | undefined,
  purpose: OAuthTabPurpose,
): 'read' | 'write' | undefined {
  if (!scopeCeiling) {
    return undefined;
  }
  return oauthTabPurposeCeiling(purpose) === 'read' ? 'read' : scopeCeiling;
}
