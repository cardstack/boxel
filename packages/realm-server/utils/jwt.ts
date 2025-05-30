import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import {
  JsonWebTokenError,
  sign,
  TokenExpiredError,
  verify,
} from 'jsonwebtoken';

export interface RealmServerTokenClaim {
  user: string;
  sessionRoom: string;
}

export function createJWT(
  claims: RealmServerTokenClaim,
  secretSeed: string,
): string {
  return sign(claims, secretSeed, {
    expiresIn: '7d',
  });
}

export function retrieveTokenClaim(
  authorizationString: string,
  secretSeed: string,
) {
  let tokenString = authorizationString.replace('Bearer ', '');
  try {
    return verify(tokenString, secretSeed) as RealmServerTokenClaim;
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
