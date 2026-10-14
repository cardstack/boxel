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
// user, and lives for minutes. Every verifier of user and realm sessions
// refuses a token that carries the claim, so an operator token is good for
// nothing else.

export const OPERATOR_CLAIM = 'operator';

export const OPERATOR_TOKEN_MAX_LIFETIME_SEC = 15 * 60;

export type OperatorScope = 'data-keys';

export interface OperatorTokenClaim {
  operator: OperatorScope;
  iat: number;
  exp: number;
}

export function isOperatorToken(claims: unknown): boolean {
  return (
    typeof claims === 'object' && claims !== null && OPERATOR_CLAIM in claims
  );
}

export function verifyOperatorToken(
  authorization: string,
  secretSeed: string,
  scope: OperatorScope,
): OperatorTokenClaim {
  let bearer = authorization.trim().match(/^bearer\s+(.+)$/i);
  let token = bearer ? bearer[1] : authorization.trim();
  let claims: Record<string, unknown>;
  try {
    claims = verify(token, secretSeed) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof TokenExpiredError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
    }
    if (e instanceof JsonWebTokenError) {
      throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
    }
    throw e;
  }
  let { iat, exp } = claims;
  if (
    claims[OPERATOR_CLAIM] !== scope ||
    'user' in claims ||
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    exp - iat > OPERATOR_TOKEN_MAX_LIFETIME_SEC
  ) {
    throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
  }
  return { operator: scope, iat, exp };
}
