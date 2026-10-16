/**
 * The diagnostic session: what an operator renders a live card under to see
 * it as the indexer does. The realm server mints one per realm the card's
 * render reads, on its `_diagnostic-render-token` operator endpoint, and the
 * set goes into the render tab's `boxel-session` map like the indexer's own.
 *
 * Each session reads as the realm owner with realm authority, as the
 * indexer's render does, but it is read-only, and it names the operator who
 * asked for it. It is signed under its own key (`diagnosticSessionSecret`)
 * rather than the bare realm seed, so every verifier of ordinary sessions
 * refuses it on its signature; it is accepted only where a verifier asks for
 * it by name: a realm's read routes, and the federated read endpoints, for
 * the realms it was issued for.
 *
 * Deliberately a leaf module with no imports, so the realm and the realm
 * server can share it without pulling in the runtime-common barrel.
 */

export const DIAGNOSTIC_SESSION_SCOPE = 'diagnostic-render';

// How long a diagnostic session lives. A verifier refuses one whose own
// `iat`/`exp` span more than this, so the bound holds even for a session
// whose expiry was written by someone other than the minting endpoint.
export const DIAGNOSTIC_SESSION_LIFETIME_SEC = 15 * 60;

// How far ahead of a verifier's clock a session's `iat` may be.
export const DIAGNOSTIC_SESSION_CLOCK_SKEW_SEC = 60;

// The channel every mint and every use of a diagnostic session logs on.
export const DIAGNOSTIC_SESSION_LOG_CHANNEL = 'diagnostic-render';

export interface DiagnosticSessionClaim {
  // Shared by every session of one mint, and logged with each use, so the
  // uses join the mint that issued them.
  id: string;
  // The operator's account of who asked and why, as given at the mint. The
  // operator token carries no identity, so nothing verifies a name in it.
  note: string;
  // The card the mint was for.
  card: string;
  // The URLs of every realm the mint issued a session for. A session is
  // accepted by any realm, or for any federated request, within this set.
  realms: string[];
}

/**
 * The signing key for this family: the realm secret seed under a
 * family-specific suffix, never the bare seed.
 */
export function diagnosticSessionSecret(realmSecretSeed: string): string {
  return `${realmSecretSeed}:${DIAGNOSTIC_SESSION_SCOPE}`;
}

/**
 * Whether a token presents itself as a diagnostic session, read from its
 * payload without verifying it. It decides only which key to verify the
 * token against; a token that lies about it fails that verification.
 */
export function presentsAsDiagnosticSession(token: string): boolean {
  let payload = token.split('.')[1];
  if (!payload) {
    return false;
  }
  try {
    let claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as unknown;
    return (
      typeof claims === 'object' && claims !== null && 'diagnostic' in claims
    );
  } catch {
    return false;
  }
}

/**
 * The claim of a verified diagnostic session, when it is well formed, was
 * issued for every one of `realmURLs`, and is within its lifetime as this
 * verifier's clock sees it; otherwise undefined.
 */
export function acceptedDiagnosticClaim(
  claims: { diagnostic?: unknown; iat?: unknown; exp?: unknown },
  realmURLs: string[],
  nowSec = Math.floor(Date.now() / 1000),
): DiagnosticSessionClaim | undefined {
  let { diagnostic, iat, exp } = claims;
  if (
    typeof diagnostic !== 'object' ||
    diagnostic === null ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    exp - iat > DIAGNOSTIC_SESSION_LIFETIME_SEC ||
    iat > nowSec + DIAGNOSTIC_SESSION_CLOCK_SKEW_SEC ||
    exp <= nowSec
  ) {
    return undefined;
  }
  let { id, note, card, realms } = diagnostic as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof note !== 'string' ||
    typeof card !== 'string' ||
    !Array.isArray(realms) ||
    !realms.every((realm) => typeof realm === 'string')
  ) {
    return undefined;
  }
  let issued = new Set(realms.map(withTrailingSlash));
  if (!realmURLs.every((realmURL) => issued.has(withTrailingSlash(realmURL)))) {
    return undefined;
  }
  return { id, note, card, realms };
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
