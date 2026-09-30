import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import { SESSION_TOKEN_TTL } from '@cardstack/runtime-common';
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
  // session on one realm, the `realm` beside it, minted for a user it reads
  // on behalf of. It authenticates for that realm and no other.
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
