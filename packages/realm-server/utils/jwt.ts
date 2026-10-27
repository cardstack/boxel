import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import {
  diagnosticSessionSecret,
  isSessionRevoked,
  SESSION_TOKEN_TTL,
  type DBAdapter,
  type DiagnosticSessionClaim,
} from '@cardstack/runtime-common';
import jsonwebtoken from 'jsonwebtoken';
import { isOperatorToken } from './operator-token.ts';
const { JsonWebTokenError, sign, TokenExpiredError, verify } = jsonwebtoken;

export interface RealmServerTokenClaim {
  user: string;
  sessionRoom: string;
  // Carried by a realm-authority session (`TokenClaims.realmAuthority`), which
  // the federated endpoints accept for the `user` claim both token families
  // share.
  realmAuthority?: true;
  // Carried by a delegated session (`TokenClaims.delegated`): a read-only
  // session minted for a user on the one realm named by `realm`, which it reads
  // on that user's behalf.
  delegated?: boolean;
  realm?: string;
  // Carried by a diagnostic session (`TokenClaims.diagnostic`), which is
  // signed under its own key: only `retrieveDiagnosticSessionClaim` verifies
  // one, so every route that reads a session with `retrieveTokenClaim` refuses
  // it on its signature.
  diagnostic?: DiagnosticSessionClaim;
  // Carried only by a session signed in on the secure origin: the id of its
  // `secure_sessions` row. Minting a key write ticket requires it, and honours
  // it only while that row exists. `createSecureSessionJWT` is the one place
  // it is put in a token.
  secureSession?: string;
}

export const SECURE_SESSION_CLAIM = 'secureSession';

// Refuses claims that carry the secure-session claim, so a token can only get
// it from `createSecureSessionJWT`. Every other path that mints a token calls
// this.
export function assertNoSecureSessionClaim(claims: object): void {
  if (Object.hasOwn(claims, SECURE_SESSION_CLAIM)) {
    throw new Error(
      `the ${SECURE_SESSION_CLAIM} claim is minted only for a session signed in on the secure origin`,
    );
  }
}

export function createJWT(
  claims: RealmServerTokenClaim,
  secretSeed: string,
  expiresIn: jsonwebtoken.SignOptions['expiresIn'] = SESSION_TOKEN_TTL,
): string {
  assertNoSecureSessionClaim(claims);
  return sign(claims, secretSeed, { expiresIn });
}

// A session signed in on the secure origin, naming its `secure_sessions` row.
// Only `lib/secure-session.ts` calls this, once the user has re-authenticated
// to Matrix and the row is written.
export function createSecureSessionJWT(
  claims: { user: string; sessionRoom: string; secureSession: string },
  secretSeed: string,
  expiresInSeconds: number,
): string {
  return sign(claims, secretSeed, { expiresIn: expiresInSeconds });
}

// `expiredWithinSeconds` accepts a token that expired no longer ago than
// that: for a route whose only effect is to end something, which an app whose
// token refresh fired late must still be able to ask for, and for the secure
// window's renewal, where the `secure_sessions` row the token names, not the
// token's own expiry, says whether the session stands.
export function retrieveTokenClaim(
  authorizationString: string,
  secretSeed: string,
  { expiredWithinSeconds }: { expiredWithinSeconds?: number } = {},
): RealmServerTokenClaim & { iat: number; exp: number } {
  let tokenString = authorizationString.replace('Bearer ', '');
  try {
    let claims = verify(tokenString, secretSeed, {
      clockTolerance: expiredWithinSeconds,
    }) as RealmServerTokenClaim & {
      iat: number;
      exp: number;
    };
    // An operator token authorizes its operator endpoints and nothing else.
    if (isOperatorToken(claims)) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
    }
    return claims;
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
    }

    if (e instanceof JsonWebTokenError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
    }
    throw e;
  }
}

// Verifies a diagnostic session, for the federated read endpoints that accept
// one for the realms it was issued for. The caller still checks the claim
// against the realms the request names (`acceptedDiagnosticClaim`).
export function retrieveDiagnosticSessionClaim(
  authorizationString: string,
  secretSeed: string,
): RealmServerTokenClaim & { iat: number; exp: number } {
  return retrieveTokenClaim(
    authorizationString,
    diagnosticSessionSecret(secretSeed),
  );
}

// Verifies a session that a realm-server route acts on as its user in full:
// its signature and expiry, that it was issued after any revocation of the
// user's sessions, and that it is not a delegated session. A delegated session
// reads one realm, read-only, on its user's behalf, through that realm's own
// endpoints, so it is refused here as a token that does not belong, as a realm
// refuses one naming another realm.
export async function retrieveUserSessionClaim(
  authorizationString: string,
  secretSeed: string,
  dbAdapter: DBAdapter,
  opts: { expiredWithinSeconds?: number } = {},
): Promise<RealmServerTokenClaim & { iat: number; exp: number }> {
  let token = retrieveTokenClaim(authorizationString, secretSeed, opts);
  if (token.delegated) {
    throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
  }
  if (await isSessionRevoked(dbAdapter, token.user, token.iat)) {
    throw new AuthenticationError(AuthenticationErrorMessages.SessionRevoked);
  }
  return token;
}
