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
}

export function createJWT(
  claims: RealmServerTokenClaim,
  secretSeed: string,
): string {
  return sign(claims, secretSeed, {
    expiresIn: SESSION_TOKEN_TTL,
  });
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
