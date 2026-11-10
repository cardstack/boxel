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
