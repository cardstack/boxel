import { randomBytes } from 'crypto';
import type Koa from 'koa';
import * as Sentry from '@sentry/node';
import Provider, { errors, interactionPolicy } from 'oidc-provider';
import type {
  AdapterFactory,
  Configuration,
  KoaContextWithOIDC,
} from 'oidc-provider';
import {
  DBRateLimitStore,
  logger,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import { oauthProviderAdapter } from './adapter.ts';
import type { CallerLimit } from './caller-limit.ts';
import {
  authorizationHandler,
  DEFAULT_AUTHORIZATION_LIMIT,
  errorDetailsHandler,
  errorReturnHandler,
  interactionHandler,
  OAUTH_AUTHORIZATION_PATH,
  OAUTH_INTERACTION_PATH,
  renderLibraryError,
} from './authorization.ts';
import { OAuthProviderConfigError } from './config.ts';
import {
  consentDecisionHandler,
  consentDetailsHandler,
  type AccountContactLookup,
} from './consent.ts';
import type { OAuthProviderConfig } from './config.ts';
import { finishHandler, resumeHandler, userExists } from './finish.ts';
import { NON_RENEWING_GRANT_TTL_SECONDS } from './grants.ts';
import {
  DEFAULT_NEW_CLIENT_LIMIT,
  type NewClientLimit,
} from './new-client-limit.ts';
import { boxelHosts } from './redirect-uris.ts';
import { registrationHandler } from './registration.ts';
import type { OAuthResource, OAuthResourceDefinition } from './registry.ts';
import { buildRegistry, oauthIssuer, registryScopes } from './registry.ts';

export const log = logger('boxel:oauth-provider');

// Every endpoint of the provider is beneath this prefix, which request telemetry
// strips of its query strings and bodies.
export const OAUTH_PROVIDER_PATH_PREFIX = OAUTH_PROVIDER_PATH;
export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server';
export const OAUTH_REGISTRATION_PATH = `${OAUTH_PROVIDER_PATH_PREFIX}/reg`;

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
// assumes the implicit grant is supported (RFC 8414 §2). It is set, not
// copied: the library lists `refresh_token` as soon as a client may register
// for it, before the token endpoint serves a refresh.
//
// `token_endpoint_auth_methods_supported` is listed, before the token
// endpoint is, because a client that finds it missing assumes
// `client_secret_basic` (RFC 8414 §2) and registers asking for a secret,
// which registration refuses. The library lists `none`, from
// `clientAuthMethods`.
//
// `authorization_response_iss_parameter_supported` says the provider sends
// `iss` with every authorization response (RFC 9207), which lets a client
// tell which server answered it.
const DISCOVERY_FIELDS = [
  'issuer',
  'response_types_supported',
  'code_challenge_methods_supported',
  'token_endpoint_auth_methods_supported',
  'authorization_response_iss_parameter_supported',
] as const;
const GRANT_TYPES_SERVED = ['authorization_code'];

// How long the library keeps a flow's interaction, and its own session: long
// enough for a person to sign in and consent, and no longer. The session never
// outlives a flow: Boxel drops it at the start of each (ADR 021 §1.7).
const INTERACTION_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 10 * 60;
// How long an authorization code lasts: long enough for an app to exchange
// it straight away.
const AUTHORIZATION_CODE_TTL_SECONDS = 60;

// The running provider: the library, and Boxel's handling of the requests that
// run before or beside the library's: registration, the start of a flow, the
// interaction route that hands a flow to the secure origin, the error page's
// details and "Return", a flow's consent, the route that finishes it, and the
// resume route the library continues it on.
export interface OAuthProviderService {
  provider: Provider;
  handleRegistration: Koa.Middleware;
  handleAuthorization: Koa.Middleware;
  handleInteraction: Koa.Middleware;
  handleFinish: Koa.Middleware;
  handleResume: Koa.Middleware;
  handleErrorDetails: Koa.Middleware;
  handleErrorReturn: Koa.Middleware;
  // Consent's details and decision. They verify the secure window's session
  // and look up its account, which the realm server's routes supply.
  consentHandlers(deps: ConsentRouteDeps): {
    handleConsentDetails: Koa.Middleware;
    handleConsentDecision: Koa.Middleware;
  };
}

export interface ConsentRouteDeps {
  realmSecretSeed: string;
  accountContact: AccountContactLookup;
}

// Starts the provider for a realm server. Its issuer is the server's URL
// (ADR 021 §1.1), so every resource's identifier and every URL it publishes
// are built from that, never from a request. The hosts a client may not
// redirect to come from the server's own settings: its URL, the secure
// origin, the app origins listed for the secure origin, and the domains users
// publish sites on.
export function startOAuthProvider({
  serverURL,
  config,
  dbAdapter,
  secureOriginURL,
  appOrigins = [],
  publishedDomains = [],
  newClientLimit = DEFAULT_NEW_CLIENT_LIMIT,
  authorizationLimit = DEFAULT_AUTHORIZATION_LIMIT,
  rateLimitStore = new DBRateLimitStore(dbAdapter),
  testOnlyResources,
}: {
  serverURL: URL;
  config: OAuthProviderConfig;
  dbAdapter: DBAdapter;
  secureOriginURL: URL | undefined;
  appOrigins?: readonly string[];
  publishedDomains?: readonly string[];
  newClientLimit?: NewClientLimit;
  authorizationLimit?: CallerLimit;
  rateLimitStore?: RateLimitStore;
  testOnlyResources?: readonly OAuthResourceDefinition[];
}): OAuthProviderService {
  if (!secureOriginURL) {
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
  let registry = buildRegistry(issuer, testOnlyResources);
  let provider = createOAuthProvider({
    issuer,
    config,
    registry,
    adapter: oauthProviderAdapter(dbAdapter, {
      interactionResumeURL: (id) =>
        `${issuer}${OAUTH_AUTHORIZATION_PATH}/${id}`,
    }),
    renderError: renderLibraryError({ dbAdapter, secureOriginURL }),
    accountExists: (accountId) => userExists(dbAdapter, accountId),
  });
  // Boxel's own apps, listed in code. None is listed yet.
  let preRegistered: ReadonlySet<string> = new Set();
  return {
    provider,
    handleAuthorization: authorizationHandler({
      provider,
      registry,
      preRegistered,
      dbAdapter,
      rateLimitStore,
      limit: authorizationLimit,
      secureOriginURL,
    }),
    handleInteraction: interactionHandler({ secureOriginURL }),
    handleFinish: finishHandler({ provider, dbAdapter, secureOriginURL }),
    handleResume: resumeHandler({ provider }),
    handleErrorDetails: errorDetailsHandler({
      provider,
      dbAdapter,
      secureOriginURL,
      preRegistered,
    }),
    handleErrorReturn: errorReturnHandler({
      provider,
      dbAdapter,
      secureOriginURL,
    }),
    consentHandlers: ({ realmSecretSeed, accountContact }) => {
      let deps = {
        provider,
        registry,
        preRegistered,
        dbAdapter,
        secureOriginURL,
        realmSecretSeed,
        accountContact,
      };
      return {
        handleConsentDetails: consentDetailsHandler(deps),
        handleConsentDecision: consentDecisionHandler(deps),
      };
    },
    handleRegistration: registrationHandler({
      hosts: boxelHosts({
        serverURL,
        secureOriginURL,
        appOrigins,
        publishedDomains,
      }),
      scopes: registryScopes(registry),
      rateLimitStore,
      newClientLimit,
    }),
  };
}

export function createOAuthProvider({
  issuer,
  config,
  registry,
  adapter,
  renderError,
  accountExists = async () => false,
}: {
  issuer: string;
  config: OAuthProviderConfig;
  registry: readonly OAuthResource[];
  adapter: AdapterFactory;
  renderError?: Configuration['renderError'];
  // Whether a user ID (`users.id`) names a user. A flow signs in only as
  // the user who decided it, by that ID.
  accountExists?: (accountId: string) => Promise<boolean>;
}): Provider {
  let scopes = registryScopes(registry);
  let configuration: Configuration = {
    adapter,
    cookies: { keys: config.cookieKeys },
    jwks: config.jwks as Configuration['jwks'],
    responseTypes: ['code'],
    // Every client is public (ADR 021 §1.4): it proves itself by its
    // redirect URI and PKCE, never a secret.
    clientAuthMethods: ['none'],
    // What a client that leaves a field out is registered with. Boxel also
    // writes `token_endpoint_auth_method` into every registration itself,
    // since the library decides whether to issue a secret before these apply.
    clientDefaults: {
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      id_token_signed_response_alg: 'RS256',
    },
    // Set, rather than left to the library's default, so a client may
    // register for the refresh grant; the library allows the grant only once
    // this is set or `offline_access` is a scope. Refresh tokens follow the
    // renewal choice a grant records, which the token endpoint reads once it
    // is served, so none is issued yet.
    issueRefreshToken: async () => false,
    // The account a flow signs in as: a user's internal ID. The library
    // reads nothing about the user: the provider issues no ID tokens and
    // answers no `userinfo`.
    findAccount: async (_ctx: KoaContextWithOIDC, accountId: string) =>
      (await accountExists(accountId))
        ? { accountId, claims: async () => ({ sub: accountId }) }
        : undefined,
    // Only the grant the flow's finish created, never one the library's
    // session remembers for the client: each consent is its own grant
    // (ADR 021 §1.3).
    loadExistingGrant: async (ctx: KoaContextWithOIDC) => {
      let grantId = ctx.oidc.result?.consent?.grantId;
      return typeof grantId === 'string'
        ? await ctx.oidc.provider.Grant.find(grantId)
        : undefined;
    },
    // A code or token is never tied to the library's session, which lasts
    // only through one flow: its grant's expiry and state govern it.
    expiresWithSession: async () => false,
    // The library accepts only S256 challenges; this makes one required of
    // every client, not just public ones.
    pkce: { required: () => true },
    scopes,
    ttl: {
      Interaction: INTERACTION_TTL_SECONDS,
      Session: SESSION_TTL_SECONDS,
      AuthorizationCode: AUTHORIZATION_CODE_TTL_SECONDS,
      // Boxel creates every grant with the expiry its consent chose
      // (`grants.ts`), and the library never saves one. Set all the same, to
      // the shorter of the two, so nothing the library might save outlives
      // a consent that didn't ask to renew.
      Grant: NON_RENEWING_GRANT_TTL_SECONDS,
    },
    interactions: {
      // A realm-server route, so the library's interaction cookie is set for
      // the path the flow finishes beneath (ADR 021 §1.7). Built from the
      // issuer, never the request.
      url: (_ctx: KoaContextWithOIDC, interaction: { uid: string }) =>
        `${issuer}${OAUTH_INTERACTION_PATH}/${interaction.uid}`,
      policy: alwaysPromptingPolicy(),
    },
    ...(renderError ? { renderError } : {}),
    routes: {
      authorization: OAUTH_AUTHORIZATION_PATH,
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
      // Dynamic client registration, open to any caller (ADR 021 §1.4) and
      // checked by Boxel before the library sees it (`registration.ts`).
      registration: {
        enabled: true,
        // Open: a client needs no token issued ahead of time to register.
        initialAccessToken: false,
        policies: undefined,
        // A registration can't be read, changed or deleted afterwards, so
        // there is no token to do it with. On by default.
        issueRegistrationAccessToken: false,
        idFactory: () => randomBytes(24).toString('base64url'),
        // No client is ever issued a secret. Should the library ask for one
        // all the same, the registration is refused rather than a secret
        // stored.
        secretFactory: () => {
          throw new Error('the OAuth provider issues no client secrets');
        },
      },
      // Off: nothing serves them.
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
  // In production TLS ends at the load balancer, so the library would take
  // every request for plain HTTP: its cookies would lack `Secure`. It reads
  // the scheme from `X-Forwarded-Proto` instead, which `serve.ts` sets from
  // the issuer before every request, and which nothing else reads from the
  // caller.
  provider.proxy = true;

  // Runs around the library's own routing: after it builds the discovery
  // document, publish only the fields Boxel serves, with the registry's
  // scopes in place of the library's list (which always adds `openid`), and
  // each endpoint built from the issuer.
  provider.use(async (ctx, next) => {
    await next();
    if (ctx.oidc?.route === 'discovery' && isRecord(ctx.body)) {
      let body: Record<string, unknown> = ctx.body;
      let document: Record<string, unknown> = {};
      for (let field of DISCOVERY_FIELDS) {
        document[field] = body[field];
      }
      document.grant_types_supported = GRANT_TYPES_SERVED;
      document.scopes_supported = scopes;
      document.authorization_endpoint = `${issuer}${OAUTH_AUTHORIZATION_PATH}`;
      document.registration_endpoint = `${issuer}${OAUTH_REGISTRATION_PATH}`;
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

// The library's interaction policy, with sign-in and consent asked for on
// every flow that starts (ADR 021 §1.7). The library's own checks would also
// ask for them, since Boxel drops its session cookie and each consent makes a
// new grant; this keeps a flow from skipping either should that change. A
// resumed flow is left to the library's checks, which see the decision.
//
// The library's check that every OpenID scope asked for was granted
// (`op_scopes_missing`) is removed. The library counts every scope in its
// `scopes` setting as an OpenID scope, and the registry's scopes are there so
// a registration may name them. Each of them belongs to a resource, so the
// check that every resource scope asked for was granted (`rs_scopes_missing`)
// covers it, and a grant holds scopes only by resource: none for the whole
// provider, which a token naming no resource would carry.
function alwaysPromptingPolicy() {
  let { base, Check } = interactionPolicy;
  let policy = base();
  policy.get('consent')!.checks.remove('op_scopes_missing');
  for (let name of ['login', 'consent']) {
    policy
      .get(name)!
      .checks.add(
        new Check(
          'boxel_every_flow',
          'Boxel asks on every flow',
          (ctx: KoaContextWithOIDC) =>
            ctx.oidc.route === 'authorization'
              ? Check.REQUEST_PROMPT
              : Check.NO_NEED_TO_PROMPT,
        ),
      );
  }
  return policy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
