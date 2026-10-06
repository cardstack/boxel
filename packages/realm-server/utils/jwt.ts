import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import {
  isSessionRevoked,
  SESSION_TOKEN_TTL,
  type DBAdapter,
} from '@cardstack/runtime-common';
import jsonwebtoken from 'jsonwebtoken';
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
}

export function createJWT(
  claims: RealmServerTokenClaim,
  secretSeed: string,
  expiresIn: jsonwebtoken.SignOptions['expiresIn'] = SESSION_TOKEN_TTL,
): string {
  return sign(claims, secretSeed, { expiresIn });
}

export function retrieveTokenClaim(
  authorizationString: string,
  secretSeed: string,
): RealmServerTokenClaim & { iat: number; exp: number } {
  let tokenString = authorizationString.replace('Bearer ', '');
  try {
    return verify(tokenString, secretSeed) as RealmServerTokenClaim & {
      iat: number;
      exp: number;
    };
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
): Promise<RealmServerTokenClaim & { iat: number; exp: number }> {
  let token = retrieveTokenClaim(authorizationString, secretSeed);
  if (token.delegated) {
    throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
  }
  if (await isSessionRevoked(dbAdapter, token.user, token.iat)) {
    throw new AuthenticationError(AuthenticationErrorMessages.SessionRevoked);
  }
  return token;
}
