import Provider, { errors } from 'oidc-provider';
import type { Configuration, KoaContextWithOIDC } from 'oidc-provider';
import { logger } from '@cardstack/runtime-common';
import type { OAuthProviderConfig } from './config.ts';
import type { OAuthResource } from './registry.ts';
import { registryScopes } from './registry.ts';

export const log = logger('boxel:oauth-provider');

export const OAUTH_PROVIDER_PATH_PREFIX = '/_oauth-provider';
export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server';

// The fields discovery publishes. The library's document also lists every
// endpoint it mounts, `jwks_uri`, and OpenID Connect metadata. Boxel's
// provider is not an OpenID provider and signs nothing, and an endpoint is
// listed only once the realm server serves it, so the document is cut down
// to these. Each change that serves an endpoint adds its fields here.
const DISCOVERY_FIELDS = [
  'issuer',
  'response_types_supported',
  'code_challenge_methods_supported',
  'scopes_supported',
] as const;

export function createOAuthProvider({
  issuer,
  config,
  registry,
}: {
  issuer: string;
  config: OAuthProviderConfig;
  registry: OAuthResource[];
}): Provider {
  let scopes = registryScopes(registry);
  let configuration: Configuration = {
    cookies: { keys: config.cookieKeys },
    jwks: config.jwks as Configuration['jwks'],
    responseTypes: ['code'],
    // The library accepts only S256 challenges; this makes one required of
    // every client, not just public ones.
    pkce: { required: () => true },
    scopes,
    routes: {
      authorization: `${OAUTH_PROVIDER_PATH_PREFIX}/auth`,
      backchannel_authentication: `${OAUTH_PROVIDER_PATH_PREFIX}/backchannel`,
      challenge: `${OAUTH_PROVIDER_PATH_PREFIX}/challenge`,
      code_verification: `${OAUTH_PROVIDER_PATH_PREFIX}/device`,
      credential: `${OAUTH_PROVIDER_PATH_PREFIX}/credential`,
      device_authorization: `${OAUTH_PROVIDER_PATH_PREFIX}/device/auth`,
      end_session: `${OAUTH_PROVIDER_PATH_PREFIX}/session/end`,
      introspection: `${OAUTH_PROVIDER_PATH_PREFIX}/token/introspection`,
      jwks: `${OAUTH_PROVIDER_PATH_PREFIX}/jwks`,
      pushed_authorization_request: `${OAUTH_PROVIDER_PATH_PREFIX}/request`,
      registration: `${OAUTH_PROVIDER_PATH_PREFIX}/reg`,
      revocation: `${OAUTH_PROVIDER_PATH_PREFIX}/token/revocation`,
      token: `${OAUTH_PROVIDER_PATH_PREFIX}/token`,
      userinfo: `${OAUTH_PROVIDER_PATH_PREFIX}/me`,
    },
    // Every feature is set here, including those whose default is the
    // setting wanted, so a library upgrade that changes a default changes
    // nothing. Features a later change turns on say so.
    features: {
      // The library's quick-start login and consent pages, which sign in any
      // account ID typed into them. On by default.
      devInteractions: { enabled: false },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo: (
          _ctx: KoaContextWithOIDC,
          resourceIndicator: string,
        ) => {
          let resource = registry.find(({ id }) => id === resourceIndicator);
          if (!resource) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: resource.scopes.map(({ name }) => name).join(' '),
            audience: resource.id,
            accessTokenFormat: 'opaque',
          };
        },
      },
      // Off until the changes that serve them.
      registration: { enabled: false },
      clientIdMetadataDocument: { enabled: false },
      deviceFlow: { enabled: false },
      revocation: { enabled: false },
      // No ID tokens or OpenID claims: the provider is not an OpenID provider.
      userinfo: { enabled: false },
      jwtUserinfo: { enabled: false },
      claimsParameter: { enabled: false },
      // A second way to start a flow, which Boxel's checks before the
      // library would never see. On by default.
      pushedAuthorizationRequests: { enabled: false },
      // The provider keeps no login to log out of. On by default.
      rpInitiatedLogout: { enabled: false },
      backchannelLogout: { enabled: false },
      // A DPoP-bound token is presented as `DPoP`, which no resource accepts.
      // On by default.
      dPoP: { enabled: false },
      // Not needed.
      introspection: { enabled: false },
      jwtIntrospection: { enabled: false },
      clientCredentials: { enabled: false },
      ciba: { enabled: false },
      mTLS: { enabled: false },
      attestClientAuth: { enabled: false },
      encryption: { enabled: false },
      fapi: { enabled: false },
      jwtResponseModes: { enabled: false },
      registrationManagement: { enabled: false },
      richAuthorizationRequests: { enabled: false },
      requestObjects: { enabled: false },
      rpMetadataChoices: { enabled: false },
      webMessageResponseMode: { enabled: false },
      externalSigningSupport: { enabled: false },
      openid4vci: { enabled: false },
    },
  };

  let provider = new Provider(issuer, configuration);

  // Runs around the library's own routing: after it builds the discovery
  // document, publish only the fields Boxel serves, with the registry's
  // scopes in place of the library's list (which always adds `openid`).
  provider.use(async (ctx, next) => {
    await next();
    if (ctx.oidc?.route === 'discovery' && isRecord(ctx.body)) {
      let body: Record<string, unknown> = ctx.body;
      let document: Record<string, unknown> = {};
      for (let field of DISCOVERY_FIELDS) {
        document[field] = body[field];
      }
      document.scopes_supported = scopes;
      ctx.body = document;
    }
  });

  provider.on('server_error', (_ctx: unknown, error: Error) => {
    log.error(`OAuth provider error: ${error.name}: ${error.message}`);
  });

  log.info(
    `OAuth provider on: issuer ${issuer}, resources ${registry
      .map(({ id }) => id)
      .join(', ')}`,
  );
  return provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
