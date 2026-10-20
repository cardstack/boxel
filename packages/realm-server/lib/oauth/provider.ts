import type Koa from 'koa';
import { timingSafeEqual } from 'node:crypto';
import { userRealmSession } from './realm-proxy.ts';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { SignInLimiter } from '../sign-in-limiter.ts';
import Provider, {
  errors,
  type ClientMetadata,
  type Configuration,
} from 'oidc-provider';
import {
  fetchRealmPermissions,
  isSessionRevoked,
  type DBAdapter,
} from '@cardstack/runtime-common';
import RealmPermissionChecker from '@cardstack/runtime-common/realm-permission-checker';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { retrieveUserSessionClaim } from '../../utils/jwt.ts';
import { isSecureSession } from '../secure-session.ts';
import { secureOriginHeaders } from '../secure-origin.ts';
import {
  oauthAdapter,
  oauthId,
  readOAuthGrant,
  revokeOAuthGrant,
  saveOAuthGrant,
} from './store.ts';

export const BOXEL_OAUTH_SCOPES = [
  'boxel:read',
  'boxel:choices',
  'boxel:write',
] as const;
export interface BoxelOAuthResource {
  resource: string;
  name: string;
  realms: string[];
  // Explicit remote public realms; checked anonymously against their own _info.
  publicRealms?: string[];
  // Realms on this Boxel installation, eligible for delegated API access.
  delegatedRealms?: string[];
  // Resource servers introspect only tokens whose audience names them.
  introspectionClientId: string;
  introspectionClientSecret: string;
}
export interface BoxelOAuthConfig {
  resources: BoxelOAuthResource[];
  cookieKeys: string[];
  jwks: NonNullable<Configuration['jwks']>;
  allowedUsers?: string[];
}
interface Deps {
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
  realmSecretSeed: string;
  matrixClient: MatrixClient;
  realmSession?: typeof userRealmSession;
  realmFetch?: typeof fetch;
}

export function boxelOAuthConfigFromEnv(
  env = process.env,
): BoxelOAuthConfig | undefined {
  if (!env.BOXEL_OAUTH_CONFIG) {
    return undefined;
  }
  let config = JSON.parse(env.BOXEL_OAUTH_CONFIG) as BoxelOAuthConfig;
  validateOAuthConfig(config);
  return config;
}
export function validateOAuthConfig(config: BoxelOAuthConfig) {
  if (
    !config.cookieKeys?.length ||
    config.cookieKeys.some(
      (key) => typeof key !== 'string' || key.length < 32,
    ) ||
    !config.jwks?.keys?.length ||
    !config.resources?.length
  ) {
    throw new Error(
      'Boxel OAuth needs persistent cookie keys, a private JWKS and registered resources',
    );
  }
  let seen = new Set<string>();
  for (let resource of config.resources) {
    let url = new URL(resource.resource);
    if (
      url.protocol !== 'https:' ||
      url.hash ||
      url.username ||
      url.password ||
      url.search ||
      !resource.name ||
      !resource.introspectionClientId ||
      typeof resource.introspectionClientSecret !== 'string' ||
      resource.introspectionClientSecret.length < 32 ||
      !resource.realms?.length ||
      seen.has(url.href)
    ) {
      throw new Error('Invalid Boxel OAuth resource');
    }
    seen.add(url.href);
    if (
      resource.delegatedRealms?.some(
        (realm) =>
          !resource.realms.includes(realm) ||
          resource.publicRealms?.includes(realm),
      )
    ) {
      throw new Error('Delegated realms must be selected local realms');
    }
    if (
      resource.publicRealms?.some((realm) => !resource.realms.includes(realm))
    ) {
      throw new Error('Public realms must be selected resource realms');
    }
    resource.realms = resource.realms.map((realm) => {
      let parsed = new URL(realm);
      if (
        parsed.protocol !== 'https:' ||
        parsed.hash ||
        parsed.search ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error('Invalid Boxel OAuth realm');
      }
      return parsed.href.replace(/\/?$/, '/');
    });
  }
}

export function createBoxelOAuthProvider(config: BoxelOAuthConfig, deps: Deps) {
  validateOAuthConfig(config);
  let { dbAdapter: db, secureOriginURL, realmSecretSeed, matrixClient } = deps;
  let issuer = secureOriginURL.origin;
  let resourceFor = (resource: unknown) =>
    config.resources.find((r) => r.resource === resource);
  let userAllowed = (user: string) =>
    !config.allowedUsers || config.allowedUsers.includes(user);
  async function canWrite(user: string, realm: string) {
    let checker = new RealmPermissionChecker(
      await fetchRealmPermissions(db, new URL(realm)),
      matrixClient,
    );
    return await checker.can(user, 'write');
  }
  let realmSessions = new Map<string, { token: string; until: number }>();
  async function canRead(user: string, realm: string) {
    if (
      config.resources.some((resource) =>
        resource.publicRealms?.includes(realm),
      )
    ) {
      let response = await fetch(new URL('_info', realm), {
        headers: { Accept: 'application/vnd.api+json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return false;
      }
      let reader = response.body?.getReader();
      if (!reader) {
        return false;
      }
      let text = '',
        size = 0,
        decoder = new TextDecoder();
      try {
        for (;;) {
          let { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            return false;
          }
          size += value.byteLength;
          if (size > 65536) {
            return false;
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel();
      }
      let info = JSON.parse(text);
      return (
        info?.data?.id === realm &&
        info?.data?.attributes?.visibility === 'public'
      );
    }
    let checker = new RealmPermissionChecker(
      await fetchRealmPermissions(db, new URL(realm)),
      matrixClient,
    );
    return await checker.can(user, 'read');
  }
  async function effectiveGrant(
    id: string | undefined,
    user: string | undefined,
  ) {
    if (!id || !user || !userAllowed(user)) {
      return undefined;
    }
    let grant = await readOAuthGrant(db, oauthId(id));
    if (
      !grant ||
      grant.revoked ||
      grant.user !== user ||
      (grant.renewableUntil !== undefined &&
        grant.renewableUntil <= Math.floor(Date.now() / 1000)) ||
      !resourceFor(grant.resource) ||
      (await isSessionRevoked(db, user, grant.issuedAt))
    ) {
      return undefined;
    }
    let resource = resourceFor(grant.resource)!;
    let realms = [];
    for (let realm of grant.realms) {
      if (resource.realms.includes(realm) && (await canRead(user, realm))) {
        realms.push(realm);
      }
    }
    return realms.length ? { ...grant, realms } : undefined;
  }
  let clients: ClientMetadata[] = config.resources.map((r) => ({
    client_id: r.introspectionClientId,
    client_secret: r.introspectionClientSecret,
    token_endpoint_auth_method: 'client_secret_basic',
    grant_types: [],
    response_types: [],
    redirect_uris: [],
  }));
  let provider: Provider = new Provider(issuer, {
    adapter: oauthAdapter(db),
    clients,
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      long: { secure: true, sameSite: 'lax', httpOnly: true },
      short: { secure: true, sameSite: 'lax', httpOnly: true },
    },
    responseTypes: ['code'],
    scopes: ['openid', 'offline_access'],
    discovery: {
      scopes_supported: ['openid', 'offline_access', ...BOXEL_OAUTH_SCOPES],
    },
    pkce: { required: () => true },
    rotateRefreshToken: true,
    // OAuth clients may omit OIDC offline_access. A separate, explicit secure
    // consent can approve renewal without adding a scope the client omitted.
    issueRefreshToken: async (_ctx, client, source) => {
      let grant = await effectiveGrant(source.grantId, source.accountId);
      return Boolean(
        client.grantTypeAllowed('refresh_token') &&
        grant?.clientId === client.clientId &&
        grant.renewableUntil,
      );
    },
    expiresWithSession: async (_ctx, source) => {
      let grant = await effectiveGrant(source.grantId, source.accountId);
      return !grant?.renewableUntil;
    },
    ttl: {
      AccessToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 3600,
      Grant: 30 * 86400,
      RefreshToken: 30 * 86400,
    },
    interactions: {
      url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}`,
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
      revocation: { enabled: true },
      introspection: {
        enabled: true,
        allowedPolicy: async (ctx, client, token) => {
          let resource = config.resources.find(
            (r) => r.introspectionClientId === client.clientId,
          );
          if (
            !resource ||
            token.kind !== 'AccessToken' ||
            token.aud !== resource.resource
          ) {
            return false;
          }
          let grant = await effectiveGrant(token.grantId, token.accountId);
          if (
            !grant ||
            grant.resource !== resource.resource ||
            grant.clientId !== token.clientId
          ) {
            return false;
          }
          ctx.state.boxelRealms = grant.realms;
          ctx.state.boxelDelegatedRealms = grant.realms.filter((realm) =>
            resource.delegatedRealms?.includes(realm),
          );
          ctx.state.boxelWriteRealms = [];
          if (
            String(token.scope ?? '')
              .split(' ')
              .includes('boxel:write')
          ) {
            for (let realm of ctx.state.boxelDelegatedRealms) {
              if (await canWrite(grant.user, realm))
                ctx.state.boxelWriteRealms.push(realm);
            }
          }
          return true;
        },
      },
      resourceIndicators: {
        enabled: true,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (!resourceFor(resource)) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: BOXEL_OAUTH_SCOPES.join(' '),
            audience: resource,
            accessTokenTTL: 300,
            accessTokenFormat: 'opaque',
          };
        },
      },
    },
    routes: {
      authorization: '/oauth/authorize',
      token: '/oauth/token',
      registration: '/oauth/register',
      revocation: '/oauth/revoke',
      introspection: '/oauth/introspect',
      jwks: '/oauth/jwks',
      userinfo: '/oauth/userinfo',
      end_session: '/oauth/logout',
    },
    // A new authorization always gets a visible consent screen. Only the
    // grant just approved in this interaction can satisfy that screen.
    loadExistingGrant: async (ctx) => {
      let id = ctx.oidc.result?.consent?.grantId;
      return id ? await provider.Grant.find(id) : undefined;
    },
    findAccount: async (_ctx, user, token) => {
      if (
        !userAllowed(user) ||
        (token && !(await effectiveGrant(token.grantId, user)))
      ) {
        return undefined;
      }
      return { accountId: user, claims: async () => ({ sub: user }) };
    },
    renderError: async (ctx) => {
      ctx.type = 'text/plain';
      ctx.body =
        'Boxel authorization could not be completed. Start again from your client.';
    },
  });
  // TLS is terminated by Boxel's configured ingress. Host/issuer remain fixed
  // by the secure-origin gate; forwarded headers never select an issuer.
  provider.proxy = true;
  provider.use(async (ctx, next) => {
    await next();
    // Boxel scopes belong to a resource, not OIDC userinfo. oidc-provider
    // otherwise advertises only its global OIDC scopes in discovery.
    if (
      ctx.oidc.route === 'discovery' &&
      ctx.body &&
      typeof ctx.body === 'object'
    ) {
      Object.assign(ctx.body, {
        scopes_supported: ['openid', 'offline_access', ...BOXEL_OAUTH_SCOPES],
      });
    }
    if (
      ctx.oidc.route === 'introspection' &&
      ctx.body &&
      typeof ctx.body === 'object' &&
      'active' in ctx.body &&
      ctx.body.active
    ) {
      Object.assign(ctx.body, {
        boxel_realms: ctx.state.boxelRealms,
        boxel_delegated_realms: ctx.state.boxelDelegatedRealms,
        boxel_write_realms: ctx.state.boxelWriteRealms,
        iss: issuer,
      });
    }
  });
  let callback = provider.callback();
  let registrations = new SignInLimiter({
    windowMs: 60000,
    perAccount: 60,
    perAddress: 10,
  });

  async function secureUser(ctx: Koa.Context) {
    if (
      (ctx.method !== 'GET' || ctx.get('Origin')) &&
      ctx.get('Origin') !== issuer
    ) {
      ctx.throw(403, 'Use the Boxel secure window');
    }
    let token;
    try {
      token = await retrieveUserSessionClaim(
        ctx.get('Authorization'),
        realmSecretSeed,
        db,
      );
    } catch (error) {
      if (error instanceof AuthenticationError) {
        ctx.throw(401);
      }
      throw error;
    }
    if (!userAllowed(token.user) || !(await isSecureSession(db, token))) {
      ctx.throw(403, 'Sign in on the Boxel secure origin');
    }
    return token.user;
  }
  async function body(ctx: Koa.Context) {
    if (!ctx.is('application/json')) {
      ctx.throw(415);
    }
    let chunks = [],
      size = 0;
    for await (let chunk of ctx.req) {
      size += chunk.length;
      if (size > (ctx.path === '/oauth/realm-fetch' ? 65536 : 8192)) {
        ctx.throw(413);
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString()) as Record<
        string,
        unknown
      >;
    } catch {
      ctx.throw(400, 'Invalid JSON');
    }
  }

  // Called only within the secure-origin gate, before any card/realm routing.
  async function handle(ctx: Koa.Context): Promise<boolean> {
    if (ctx.path === '/oauth/realm-fetch') {
      if (ctx.method !== 'POST') ctx.throw(405);
      let header = ctx.get('Authorization');
      let resource = config.resources.find((entry) => {
        let expected = Buffer.from(
          `Basic ${Buffer.from(`${encodeURIComponent(entry.introspectionClientId)}:${encodeURIComponent(entry.introspectionClientSecret)}`).toString('base64')}`,
        );
        let supplied = Buffer.from(header);
        return (
          expected.length === supplied.length &&
          timingSafeEqual(expected, supplied)
        );
      });
      if (!resource) ctx.throw(401);
      let access = await provider.AccessToken.find(
        ctx.get('X-Boxel-Subject-Token'),
      );
      let grant =
        access && (await effectiveGrant(access.grantId, access.accountId));
      if (
        !access ||
        !grant ||
        access.isExpired ||
        access.aud !== resource.resource ||
        grant.resource !== resource.resource ||
        access.clientId !== grant.clientId
      )
        ctx.throw(401);
      let input = await body(ctx);
      let target: URL;
      try {
        target = new URL(String(input.url));
      } catch {
        ctx.throw(400);
      }
      let realm = resource.delegatedRealms?.find(
        (root) => target.href.startsWith(root) && grant.realms.includes(root),
      );
      if (
        !realm ||
        target.username ||
        target.password ||
        target.hash ||
        target.search ||
        target.protocol !== 'https:'
      )
        ctx.throw(403);
      let method = input.method ?? 'GET';
      let scopes = String(access.scope ?? '').split(' ');
      if (!scopes.includes('boxel:read')) ctx.throw(403);
      // Module loads may deliberately omit Accept. Defaulting to card JSON
      // makes the realm resolve executable modules as nonexistent cards.
      let headers = new Headers();
      if (
        input.headers &&
        typeof input.headers === 'object' &&
        !Array.isArray(input.headers)
      ) {
        for (let [name, value] of Object.entries(input.headers)) {
          if (
            [
              'accept',
              'content-type',
              'if-match',
              'x-http-method-override',
            ].includes(name.toLowerCase()) &&
            typeof value === 'string'
          )
            headers.set(name, value);
        }
      }
      let query =
        method === 'POST' &&
        headers.get('x-http-method-override')?.toUpperCase() === 'QUERY' &&
        target.href === new URL('_search', realm).href;
      if (method === 'PATCH') {
        if (
          !scopes.includes('boxel:write') ||
          !(await canWrite(grant.user, realm))
        )
          ctx.throw(403);
        if (
          !headers.get('if-match') ||
          /[,*]/.test(headers.get('if-match')!) ||
          headers.get('if-match')!.startsWith('W/')
        )
          ctx.throw(428, 'A card version is required');
      } else if (!['GET', 'HEAD'].includes(String(method)) && !query)
        ctx.throw(405);
      let key = `${grant.user}|${realm}`,
        cached = realmSessions.get(key);
      if (!cached || cached.until <= Date.now()) {
        if (realmSessions.size >= 64)
          realmSessions.delete(realmSessions.keys().next().value!);
        cached = {
          token: await (deps.realmSession ?? userRealmSession)(
            grant.user,
            realm,
          ),
          until: Date.now() + 60000,
        };
        realmSessions.set(key, cached);
      }
      headers.set('Authorization', cached.token);
      let response = await (deps.realmFetch ?? fetch)(target, {
        method: String(method),
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        ...(method === 'PATCH' || query
          ? { body: typeof input.body === 'string' ? input.body : '' }
          : {}),
      });
      ctx.status = response.status;
      // Transfer proxies may weaken ETag when compressing this response.
      // Preserve the origin's exact conditional-write validator separately.
      let cardVersion = response.headers.get('etag');
      if (cardVersion) ctx.set('X-Boxel-Card-Version', cardVersion);
      for (let name of [
        'content-type',
        'etag',
        'last-modified',
        'x-boxel-realm-url',
        'x-boxel-realm-public-readable',
      ]) {
        let value = response.headers.get(name);
        if (value) ctx.set(name, value);
      }
      let chunks: Uint8Array[] = [],
        size = 0;
      if (response.body) {
        let reader = response.body.getReader();
        try {
          for (;;) {
            let { done, value } = await reader.read();
            if (done) break;
            if (!value) ctx.throw(502);
            size += value.length;
            if (size > 4 * 1024 * 1024) ctx.throw(502);
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
      }
      ctx.set('Cache-Control', 'no-store');
      ctx.body = Buffer.concat(chunks);
      return true;
    }
    if (
      ctx.path === '/oauth/register' &&
      ctx.method === 'POST' &&
      !registrations.allow('register', ctx.ip)
    ) {
      ctx.throw(429);
    }
    let interactionPath = /^\/oauth\/interaction\/[A-Za-z0-9_-]{1,128}$/;
    if (interactionPath.test(ctx.path)) {
      let details = await provider.interactionDetails(ctx.req, ctx.res);
      if (ctx.method === 'GET' && !ctx.accepts('html')) {
        let client = await provider.Client.find(
          String(details.params.client_id),
        );
        let resource = resourceFor(details.params.resource);
        if (!resource) {
          ctx.throw(400, 'Select one registered Boxel resource');
        }
        ctx.body = {
          prompt: details.prompt.name,
          clientName: client?.clientName ?? 'Unnamed application',
          clientId: details.params.client_id,
          redirectHost: new URL(String(details.params.redirect_uri)).host,
          resource: resource.resource,
          resourceName: resource.name,
          realms: resource.realms,
          canRefresh: client?.grantTypeAllowed('refresh_token') === true,
          scopes: String(details.params.scope ?? '')
            .split(' ')
            .filter(Boolean),
        };
        return true;
      }
      if (ctx.method === 'GET') {
        return false;
      } // existing secure shell serves the UI
      if (ctx.method !== 'POST') {
        ctx.throw(405);
      }
      let user = await secureUser(ctx);
      let input = await body(ctx);
      let result;
      if (input.decision === 'deny') {
        result = {
          error: 'access_denied',
          error_description: 'The user declined access',
        };
      } else if (input.decision !== 'allow') {
        ctx.throw(400);
      } else if (details.prompt.name === 'login') {
        result = { login: { accountId: user, remember: false } };
      } else if (details.prompt.name === 'consent') {
        if (details.session?.accountId !== user) {
          ctx.throw(403, 'Sign in with the same Boxel account');
        }
        let resource = resourceFor(details.params.resource);
        if (
          !resource ||
          !Array.isArray(input.realms) ||
          !input.realms.length ||
          input.realms.some(
            (realm) =>
              typeof realm !== 'string' || !resource.realms.includes(realm),
          )
        ) {
          ctx.throw(400, 'Select approved realms');
        }
        let realms = [...new Set(input.realms as string[])];
        for (let realm of realms) {
          if (!(await canRead(user, realm))) {
            ctx.throw(403, 'Realm access was removed');
          }
        }
        let scopes = String(details.params.scope ?? '')
          .split(' ')
          .filter(Boolean);
        if (
          scopes.some(
            (scope) =>
              !['openid', 'offline_access', ...BOXEL_OAUTH_SCOPES].includes(
                scope,
              ),
          )
        ) {
          ctx.throw(400, 'Unsupported scope');
        }
        let client = await provider.Client.find(
          String(details.params.client_id),
        );
        if (
          input.remember !== undefined &&
          typeof input.remember !== 'boolean'
        ) {
          ctx.throw(400, 'Invalid renewal consent');
        }
        let renewable =
          input.remember === true || scopes.includes('offline_access');
        if (renewable && !client?.grantTypeAllowed('refresh_token')) {
          ctx.throw(400, 'This client does not support automatic renewal');
        }
        let issuedAt = Math.floor(Date.now() / 1000);
        let grant = new provider.Grant({
          accountId: user,
          clientId: String(details.params.client_id),
        });
        grant.addOIDCScope(
          scopes.filter((s) => s === 'openid' || s === 'offline_access'),
        );
        grant.addResourceScope(
          resource.resource,
          scopes.filter((s) =>
            BOXEL_OAUTH_SCOPES.includes(
              s as (typeof BOXEL_OAUTH_SCOPES)[number],
            ),
          ),
        );
        let id = await grant.save();
        await saveOAuthGrant(db, {
          id: oauthId(id),
          user,
          clientId: String(details.params.client_id),
          resource: resource.resource,
          realms,
          scopes,
          issuedAt,
          ...(renewable ? { renewableUntil: issuedAt + 30 * 86400 } : {}),
        });
        result = { consent: { grantId: id } };
      } else {
        ctx.throw(400, 'Unsupported interaction');
      }
      let redirectTo = await provider.interactionResult(
        ctx.req,
        ctx.res,
        result,
        { mergeWithLastSubmission: details.prompt.name !== 'login' },
      );
      // Fetch receives the next same-origin URL; no secure session is ever
      // put in a URL, form, OAuth token, or returned to the OAuth client.
      ctx.body = { redirectTo };
      return true;
    }
    if (ctx.path === '/oauth/grants') {
      let user = await secureUser(ctx);
      if (ctx.method === 'GET') {
        let rows = await db.execute(
          `SELECT id FROM oauth_grants WHERE user_id=$1 AND revoked_at IS NULL ORDER BY issued_at DESC`,
          { bind: [user], redactBindings: true },
        );
        let grants = await Promise.all(
          rows.map((row) => readOAuthGrant(db, String(row.id))),
        );
        ctx.body = grants
          .filter((grant) => grant?.user === user)
          .map((grant) => ({
            id: grant!.id,
            client_id: grant!.clientId,
            resource: grant!.resource,
            realms: grant!.realms,
            scopes: grant!.scopes,
            issued_at: grant!.issuedAt,
            renewable_until: grant!.renewableUntil,
          }));
      } else if (ctx.method === 'DELETE') {
        let input = await body(ctx);
        if (typeof input.id !== 'string') {
          ctx.throw(400);
        }
        let grant = await readOAuthGrant(db, input.id);
        if (!grant || grant.user !== user) {
          ctx.throw(404);
        }
        await revokeOAuthGrant(db, grant.id);
        ctx.status = 204;
      } else {
        ctx.throw(405);
      }
      return true;
    }
    if (
      !ctx.path.startsWith('/oauth/') &&
      ![
        '/.well-known/openid-configuration',
        '/.well-known/oauth-authorization-server',
      ].includes(ctx.path)
    ) {
      return false;
    }
    ctx.respond = false;
    // Both handlers use Node's request/response, preserving provider cookies.
    for (let [name, value] of Object.entries(secureOriginHeaders())) {
      ctx.res.setHeader(name, value);
    }
    await callback(ctx.req, ctx.res);
    return true;
  }
  return { provider, handle };
}
