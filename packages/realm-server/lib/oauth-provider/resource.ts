// What an OAuth resource's controller does with a request (ADR 021 §1.3,
// §1.5): reads the token from `Authorization: Bearer` only, looks it up once
// (`lookup.ts`), checks the route against the resource's scopes, and answers
// as RFC 6750 §3.1 says, so a client restarts its flow, or asks for more
// scopes, exactly when it should. Also each resource's protected-resource
// metadata (RFC 9728).
//
// The token never leaves the controller: the verified caller is what goes on
// to the route, as `ctxt.state.oauthCaller`, never a session token's claims.

import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import { resolveOAuthAccessToken, type OAuthCaller } from './lookup.ts';
import type {
  OAuthResource,
  OAuthRoute,
  OAuthRouteMethod,
  OAuthScope,
} from './registry.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_PROTECTED_RESOURCE_PATH =
  '/.well-known/oauth-protected-resource';

// How much of a form-encoded body is read to look for a token in it.
const FORM_BODY_LIMIT_BYTES = 64 * 1024;

// The resource's path below the issuer: empty for a resource identified by
// the issuer itself.
export function resourcePath(resource: OAuthResource): string {
  let path = new URL(resource.id).pathname;
  return path === '/' ? '' : path;
}

// Where a resource's metadata is served (RFC 9728 §3.1): the well-known path
// followed by the resource's own path.
export function protectedResourceMetadataURL(
  issuer: string,
  resource: OAuthResource,
): string {
  return `${issuer}${OAUTH_PROTECTED_RESOURCE_PATH}${resourcePath(resource)}`;
}

// The resource's metadata document: its identifier, the issuer, its scopes
// (RFC 9728 §2), and that a token is sent only in the header.
export function protectedResourceMetadata(
  issuer: string,
  resource: OAuthResource,
) {
  return {
    resource: resource.id,
    resource_name: resource.name,
    authorization_servers: [issuer],
    scopes_supported: resource.scopes.map(({ name }) => name),
    bearer_methods_supported: ['header'],
  };
}

export function protectedResourceMetadataHandler(
  issuer: string,
  resource: OAuthResource,
): (ctxt: Koa.Context) => Promise<void> {
  let body = JSON.stringify(protectedResourceMetadata(issuer, resource));
  return async (ctxt) => {
    ctxt.status = 200;
    ctxt.type = 'application/json';
    ctxt.set('Cache-Control', 'public, max-age=3600');
    ctxt.body = body;
  };
}

// The route a request reached, as its router registered it, after any method
// override (§1.3). A HEAD request reaches the GET route registered for its
// path.
export interface SelectedServerRoute {
  method: string;
  path: string;
}

// The route-map check (§1.3): whether a scope the caller holds admits the
// route its router selected. Besides the resource's scopes it takes only the
// caller and that route, never the request. When the caller is refused,
// `scopes` names the scopes that would admit the route, and is empty when
// none does.
export function admitsRoute(
  scopes: readonly OAuthScope[],
  caller: Pick<OAuthCaller, 'scopes'>,
  route: SelectedServerRoute,
): { admitted: true } | { admitted: false; scopes: string[] } {
  let admitting = scopes
    .filter((scope) =>
      scope.routes.some((mapped) => matchesServerRoute(mapped, route)),
    )
    .map(({ name }) => name);
  if (admitting.some((name) => caller.scopes.includes(name))) {
    return { admitted: true };
  }
  return { admitted: false, scopes: admitting };
}

function matchesServerRoute(
  mapped: OAuthRoute,
  route: SelectedServerRoute,
): boolean {
  if (mapped.on !== 'server' || mapped.path !== route.path) {
    return false;
  }
  let method = route.method.toUpperCase() as OAuthRouteMethod;
  return (
    mapped.method === method || (method === 'HEAD' && mapped.method === 'GET')
  );
}

// The `WWW-Authenticate` challenge (RFC 6750 §3, RFC 9728 §5.1).
export function bearerChallenge(
  issuer: string,
  resource: OAuthResource,
  {
    error,
    scope = resource.scopes.map(({ name }) => name),
  }: { error?: 'invalid_token' | 'insufficient_scope'; scope?: string[] } = {},
): string {
  let params = [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${protectedResourceMetadataURL(issuer, resource)}"`,
    ...(scope.length > 0 ? [`scope="${scope.join(' ')}"`] : []),
  ];
  return `Bearer ${params.join(', ')}`;
}

type BearerToken =
  | { kind: 'none' }
  | { kind: 'header'; token: string }
  // A token outside the header, which is refused without a lookup.
  | { kind: 'elsewhere' };

// Reads the request's bearer token from `Authorization: Bearer` only. A token
// in the query string, or in a form-encoded body (RFC 6750 §2.2, §2.3), is
// `elsewhere`, even beside one in the header. A form-encoded body is read
// here to look for one, and isn't left for the route: no OAuth resource's
// route takes one.
export async function bearerToken(ctxt: Koa.Context): Promise<BearerToken> {
  if (new URLSearchParams(ctxt.querystring).has('access_token')) {
    return { kind: 'elsewhere' };
  }
  if (ctxt.is('application/x-www-form-urlencoded')) {
    let body = await readBody(ctxt, FORM_BODY_LIMIT_BYTES);
    if (body === undefined || new URLSearchParams(body).has('access_token')) {
      return { kind: 'elsewhere' };
    }
  }
  let header = ctxt.get('Authorization');
  let match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  if (!match) {
    return { kind: 'none' };
  }
  return { kind: 'header', token: match[1] };
}

async function readBody(
  ctxt: Koa.Context,
  limit: number,
): Promise<string | undefined> {
  let chunks: Buffer[] = [];
  let size = 0;
  for await (let chunk of ctxt.req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface OAuthResourceControllerDeps {
  dbAdapter: DBAdapter;
  issuer: string;
  resource: OAuthResource;
}

// The resource's controller, for a route its scopes map (§1.3, §1.5). It
// answers, as §12 of the provider's design says:
//
// - a token outside the header: `400 invalid_request`, without a lookup;
// - no token: `401`, with the challenge naming the resource's metadata;
// - a token the lookup refuses, or a route no scope maps: `401
//   invalid_token`;
// - a valid token without a scope the route needs: `403
//   insufficient_scope`, never a `401`, since a client that got one would
//   run the flow again for the same scopes.
//
// The refusal's reason goes to telemetry, never into the response.
export function oauthResourceController({
  dbAdapter,
  issuer,
  resource,
}: OAuthResourceControllerDeps): Koa.Middleware {
  return async (ctxt, next) => {
    let found = await bearerToken(ctxt);
    if (found.kind === 'elsewhere') {
      log.info(`token refused: not in the header, resource ${resource.id}`);
      ctxt.status = 400;
      ctxt.set('WWW-Authenticate', 'Bearer error="invalid_request"');
      ctxt.body = { error: 'invalid_request' };
      return;
    }
    if (found.kind === 'none') {
      ctxt.status = 401;
      ctxt.set('WWW-Authenticate', bearerChallenge(issuer, resource));
      ctxt.body = { error: 'unauthorized' };
      return;
    }
    let result = await resolveOAuthAccessToken(
      dbAdapter,
      found.token,
      resource.id,
    );
    if (!result.ok) {
      refuseToken(ctxt, issuer, resource);
      return;
    }
    let { caller } = result;
    let admitted = admitsRoute(resource.scopes, caller, {
      method: ctxt.method,
      path: String(ctxt._matchedRoute ?? ''),
    });
    if (!admitted.admitted) {
      if (admitted.scopes.length === 0) {
        log.info(
          `token refused: route not mapped, resource ${resource.id}, client ${caller.clientId}`,
        );
        refuseToken(ctxt, issuer, resource);
        return;
      }
      log.info(
        `token refused: insufficient scope, resource ${resource.id}, client ${caller.clientId}`,
      );
      ctxt.status = 403;
      ctxt.set(
        'WWW-Authenticate',
        bearerChallenge(issuer, resource, {
          error: 'insufficient_scope',
          scope: admitted.scopes,
        }),
      );
      ctxt.body = { error: 'insufficient_scope' };
      return;
    }
    ctxt.state.oauthCaller = caller;
    await next();
  };
}

function refuseToken(
  ctxt: Koa.Context,
  issuer: string,
  resource: OAuthResource,
) {
  ctxt.status = 401;
  ctxt.set(
    'WWW-Authenticate',
    bearerChallenge(issuer, resource, { error: 'invalid_token' }),
  );
  ctxt.body = { error: 'invalid_token' };
}
