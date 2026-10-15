import jsonwebtoken from 'jsonwebtoken';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
const { JsonWebTokenError, TokenExpiredError, verify } = jsonwebtoken;

// An operator token authorizes one family of operator endpoints. Whoever holds
// the realm secret seed signs it locally (the `boxel realm-server` commands
// do); the server never mints one, so no session, however privileged, can
// stand in for it. It names its family in the `operator` claim, carries no
// user, and lives for minutes. Its audience (`aud`) is the origin of the realm
// server it was signed for, so a token sent to the wrong host, or captured on
// the way, is refused by every other server sharing the seed. Every verifier of
// user and realm sessions refuses a token that carries the claim, so an
// operator token is good for nothing else.

export const OPERATOR_CLAIM = 'operator';

export const OPERATOR_TOKEN_MAX_LIFETIME_SEC = 15 * 60;

// How far ahead of the server's clock a signer's clock may run.
export const OPERATOR_TOKEN_CLOCK_SKEW_SEC = 60;

export type OperatorScope = 'data-keys' | 'system-keys';

export interface OperatorTokenClaim {
  operator: OperatorScope;
  aud: string;
  iat: number;
  exp: number;
}

export function isOperatorToken(claims: unknown): boolean {
  return (
    typeof claims === 'object' && claims !== null && OPERATOR_CLAIM in claims
  );
}

// `audience` is the origin of this server's URL; a token naming any other
// audience, or none, is refused.
export function verifyOperatorToken(
  authorization: string,
  secretSeed: string,
  scope: OperatorScope,
  audience: string,
): OperatorTokenClaim {
  let bearer = authorization.trim().match(/^bearer\s+(.+)$/i);
  let token = bearer ? bearer[1] : authorization.trim();
  let claims: Record<string, unknown>;
  try {
    claims = verify(token, secretSeed, { audience }) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
    }
    if (e instanceof JsonWebTokenError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
    }
    throw e;
  }
  // The lifetime is bounded against the server's clock, not only against the
  // token's own `iat`, so a token dated in the future is no longer-lived than
  // one dated now.
  let { iat, exp, aud } = claims;
  let now = Math.floor(Date.now() / 1000);
  if (
    claims[OPERATOR_CLAIM] !== scope ||
    'user' in claims ||
    aud !== audience ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    iat > now + OPERATOR_TOKEN_CLOCK_SKEW_SEC ||
    exp - iat > OPERATOR_TOKEN_MAX_LIFETIME_SEC ||
    exp > now + OPERATOR_TOKEN_MAX_LIFETIME_SEC + OPERATOR_TOKEN_CLOCK_SKEW_SEC
  ) {
    throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
  }
  return { operator: scope, aud: audience, iat, exp };
}
