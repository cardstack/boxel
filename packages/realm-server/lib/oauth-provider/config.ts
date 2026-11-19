import {
  callerLimitFormat,
  parseCallerLimit,
  type CallerLimit,
} from './caller-limit.ts';
import {
  DEFAULT_AUTHORIZATION_LIMIT,
  OAUTH_AUTHORIZATION_RATE_LIMIT_VAR,
} from './authorization.ts';
import {
  DEFAULT_NEW_CLIENT_LIMIT,
  OAUTH_CLIENT_RATE_LIMIT_VAR,
  parseNewClientLimit,
  type NewClientLimit,
} from './new-client-limit.ts';
import {
  DEFAULT_TOKEN_LIMIT,
  OAUTH_TOKEN_RATE_LIMIT_VAR,
  parseTokenLimit,
  tokenLimitFormat,
  type TokenLimit,
} from './token-limit.ts';

// What the OAuth provider needs from its environment. The provider runs only
// where `BOXEL_OAUTH_PROVIDER_ENABLED=true`; anywhere else nothing here is
// read, and the realm server serves none of its routes.

export const OAUTH_PROVIDER_ENABLED_VAR = 'BOXEL_OAUTH_PROVIDER_ENABLED';
export const OAUTH_PROVIDER_CONFIG_VAR = 'BOXEL_OAUTH_CONFIG';

export interface OAuthProviderConfig {
  // Keys the library signs its cookies with. Every replica must hold the same
  // list, and the first signs, so a rotation adds the new key at the front.
  cookieKeys: string[];
  // The library's signing keys. Nothing the provider issues is signed, but
  // without a key set of its own the library loads the development keys it
  // publishes in its package.
  jwks: { keys: Record<string, unknown>[] };
}

export class OAuthProviderConfigError extends Error {
  name = 'OAuthProviderConfigError';
}

// Returns undefined when the provider is off. When it is on, returns its
// configuration, or throws naming what is missing or malformed. A message
// never includes a configured value, since they are secrets.
export function readOAuthProviderConfig(
  env: Record<string, string | undefined>,
  { secureOriginURL }: { secureOriginURL: string | URL | undefined },
): OAuthProviderConfig | undefined {
  if (env[OAUTH_PROVIDER_ENABLED_VAR] !== 'true') {
    return undefined;
  }
  if (!secureOriginURL) {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_ENABLED_VAR} is on, but the realm server has no secureOriginURL: the provider's pages are served on the secure origin`,
    );
  }
  let raw = env[OAUTH_PROVIDER_CONFIG_VAR];
  if (!raw) {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_ENABLED_VAR} is on, but ${OAUTH_PROVIDER_CONFIG_VAR} is not set`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_CONFIG_VAR} is not valid JSON`,
    );
  }
  return parseOAuthProviderConfig(parsed);
}

// The limit on new clients (see `new-client-limit.ts`). Read only when the
// provider is on. Unset, the default; a value that is not a limit stops the
// server rather than leaving registration on a limit nobody chose.
export function readNewClientLimit(
  env: Record<string, string | undefined>,
): NewClientLimit {
  let spec = env[OAUTH_CLIENT_RATE_LIMIT_VAR]?.trim();
  if (!spec) {
    return DEFAULT_NEW_CLIENT_LIMIT;
  }
  let limit = parseNewClientLimit(spec);
  if (!limit) {
    throw new OAuthProviderConfigError(
      `${OAUTH_CLIENT_RATE_LIMIT_VAR} must be ${callerLimitFormat(DEFAULT_NEW_CLIENT_LIMIT)}, not "${spec}"`,
    );
  }
  return limit;
}

export function parseOAuthProviderConfig(value: unknown): OAuthProviderConfig {
  if (!isRecord(value)) {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_CONFIG_VAR} must be a JSON object with cookieKeys and jwks`,
    );
  }
  let { cookieKeys, jwks } = value;
  if (
    !Array.isArray(cookieKeys) ||
    cookieKeys.length === 0 ||
    !cookieKeys.every((key) => typeof key === 'string' && key.length > 0)
  ) {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_CONFIG_VAR}.cookieKeys must be a non-empty list of non-empty strings`,
    );
  }
  if (
    !isRecord(jwks) ||
    !Array.isArray(jwks.keys) ||
    jwks.keys.length === 0 ||
    !jwks.keys.every(isRecord)
  ) {
    throw new OAuthProviderConfigError(
      `${OAUTH_PROVIDER_CONFIG_VAR}.jwks must be a JSON Web Key Set with at least one key`,
    );
  }
  return {
    cookieKeys: [...cookieKeys],
    jwks: { keys: jwks.keys.map((key) => ({ ...key })) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The limit on starting a flow (see `authorization.ts`). Read only when the
// provider is on. Unset, the default; a value that is not a limit stops the
// server.
export function readAuthorizationLimit(
  env: Record<string, string | undefined>,
): CallerLimit {
  let spec = env[OAUTH_AUTHORIZATION_RATE_LIMIT_VAR]?.trim();
  if (!spec) {
    return DEFAULT_AUTHORIZATION_LIMIT;
  }
  let limit = parseCallerLimit(spec, DEFAULT_AUTHORIZATION_LIMIT);
  if (!limit) {
    throw new OAuthProviderConfigError(
      `${OAUTH_AUTHORIZATION_RATE_LIMIT_VAR} must be ${callerLimitFormat(DEFAULT_AUTHORIZATION_LIMIT)}, not "${spec}"`,
    );
  }
  return limit;
}

// The token endpoint's limits (see `token-limit.ts`). Read only when the
// provider is on. Unset, the default; a value that is not a limit stops the
// server.
export function readTokenLimit(
  env: Record<string, string | undefined>,
): TokenLimit {
  let spec = env[OAUTH_TOKEN_RATE_LIMIT_VAR]?.trim();
  if (!spec) {
    return DEFAULT_TOKEN_LIMIT;
  }
  let limit = parseTokenLimit(spec);
  if (!limit) {
    throw new OAuthProviderConfigError(
      `${OAUTH_TOKEN_RATE_LIMIT_VAR} must be ${tokenLimitFormat()}, not "${spec}"`,
    );
  }
  return limit;
}
