import * as Sentry from '@sentry/node';
import Provider, { errors } from 'oidc-provider';
import type { Configuration, KoaContextWithOIDC } from 'oidc-provider';
import { logger } from '@cardstack/runtime-common';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import { OAuthProviderConfigError } from './config.ts';
import type { OAuthProviderConfig } from './config.ts';
import type { OAuthResource, OAuthResourceDefinition } from './registry.ts';
import { buildRegistry, oauthIssuer, registryScopes } from './registry.ts';

export const log = logger('boxel:oauth-provider');

// Every endpoint of the provider is beneath this prefix, which request telemetry
// strips of its query strings and bodies.
export const OAUTH_PROVIDER_PATH_PREFIX = OAUTH_PROVIDER_PATH;
export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server';

// The fields discovery copies from the library's document. That document
// also lists every endpoint it mounts, `jwks_uri`, and OpenID Connect
// metadata. Boxel's provider is not an OpenID provider and signs nothing, and
// an endpoint is listed only once the realm server serves it, so the document
// is cut down to these.
//
// An endpoint's field is never copied from the library: it builds endpoint
// URLs from the request's host and path, not from the issuer, so a request
// with another `Host` would publish endpoints on that host. An endpoint's
// field is set from the issuer and its registered route instead.
//
// `grant_types_supported` is listed because a client that finds it missing
// assumes the implicit grant is supported (RFC 8414 §2). The library derives
// it from `responseTypes`, so it holds only `authorization_code`.
const DISCOVERY_FIELDS = [
  'issuer',
  'response_types_supported',
  'grant_types_supported',
  'code_challenge_methods_supported',
  'scopes_supported',
] as const;

// Starts the provider for a realm server. Its issuer is the server's URL
// (ADR 021 §1.1), so every resource's identifier and every URL it publishes
// are built from that, never from a request.
export function startOAuthProvider({
  serverURL,
  config,
  hasSecureOrigin,
  testOnlyResources,
}: {
  serverURL: URL;
  config: OAuthProviderConfig;
  hasSecureOrigin: boolean;
  testOnlyResources?: readonly OAuthResourceDefinition[];
}): Provider {
  if (!hasSecureOrigin) {
    throw new OAuthProviderConfigError(
      `the OAuth provider needs a secure origin for its pages: this realm server has no secureOriginURL`,
    );
  }
  // Discovery is served at the root, which RFC 8414 allows only for an
  // issuer with no path.
  if (serverURL.pathname !== '/') {
    throw new OAuthProviderConfigError(
      `the OAuth provider's issuer is the realm server's URL, which must have no path: ${serverURL.href}`,
    );
  }
  let issuer = oauthIssuer(serverURL);
  return createOAuthProvider({
    issuer,
    config,
    registry: buildRegistry(issuer, testOnlyResources),
  });
}

export function createOAuthProvider({
  issuer,
  config,
  registry,
}: {
  issuer: string;
  config: OAuthProviderConfig;
  registry: readonly OAuthResource[];
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
    // nothing.
    features: {
      // The library's quick-start login and consent pages, which sign in any
      // account ID typed into them. On by default.
      devInteractions: { enabled: false },
      resourceIndicators: {
        enabled: true,
        // The library's defaults, set so an upgrade can't change them. An
        // authorization request that names no resource is given none, and
        // Boxel's checks before the library decide it. A token request that
        // names none takes the grant's resource, and is refused when the
        // grant holds several (ADR 021 §1.3).
        defaultResource: (
          _ctx: KoaContextWithOIDC,
          _client: unknown,
          oneOf?: readonly string[],
        ) => oneOf,
        useGrantedResource: () => false,
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
      // Off: nothing serves them.
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

  let provider: Provider;
  try {
    provider = new Provider(issuer, configuration);
  } catch (error) {
    // The library's key check throws with the whole key as the error's
    // cause, private parameters included, and a boot error is printed and
    // sent to Sentry in full. Its message names the key by position and the
    // parameter at fault, never a value, so only the message is kept.
    throw new OAuthProviderConfigError(
      `The OAuth provider refused its configuration: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }

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

  // An unexpected error in the library's own handling. The library answers
  // the request itself, so the realm server's error handler never sees it.
  provider.on('server_error', (ctx: KoaContextWithOIDC, error: Error) => {
    log.error('OAuth provider error', error);
    Sentry.withScope((scope) => {
      scope.setSDKProcessingMetadata({ request: ctx.request });
      Sentry.captureException(error);
    });
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
