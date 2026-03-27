import jwt from 'jsonwebtoken';
import type { TokenClaims } from '@cardstack/runtime-common';

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
  return jwt.verify(token, secret) as TokenClaims & {
    iat: number;
    exp: number;
  };
}
