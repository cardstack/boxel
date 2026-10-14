import jwt from 'jsonwebtoken';
import type { TokenClaims } from '@cardstack/runtime-common';
import { isOperatorToken } from './utils/operator-token.ts';

export function createJWT(
  claims: TokenClaims,
  expiration: jwt.SignOptions['expiresIn'],
  secret: string,
): string {
  let token = jwt.sign(claims, secret, { expiresIn: expiration });
  return token;
}

export function verifyJWT(
  token: string,
  secret: string,
): TokenClaims & { iat: number; exp: number } {
  // throws TokenExpiredError and JsonWebTokenError
  let claims = jwt.verify(token, secret) as TokenClaims & {
    iat: number;
    exp: number;
  };
  // An operator token authorizes its operator endpoints and nothing else.
  if (isOperatorToken(claims)) {
    throw new jwt.JsonWebTokenError('an operator token is not a realm session');
  }
  return claims;
}
