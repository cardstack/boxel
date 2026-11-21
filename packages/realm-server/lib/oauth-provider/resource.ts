// What an OAuth resource's controller does with a request (ADR 021 §1.3,
// §1.5): reads the token from `Authorization: Bearer` only, looks it up once
// (`lookup.ts`), checks the route against the resource's scopes, and answers
// as RFC 6750 §3.1 says, so a client restarts its flow, or asks for more
// scopes, exactly when it should. Also each resource's protected-resource
// metadata (RFC 9728).
//
// The token never leaves the controller: it removes the `Authorization`
// header, parsed and raw, before the route runs, and the verified caller is what goes on to
// the route, as `ctxt.state.oauthCaller`, never a session token's claims.

import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import { resolveOAuthAccessToken } from './lookup.ts';
import type { OAuthResource } from './registry.ts';
import { admitsRoute } from '@cardstack/runtime-common/oauth-route-admission';

// The route-map check is shared with the realm, so it lives in runtime-common
// (ADR 021 §1.3).
export {
  admitsRoute,
  type SelectedServerRoute,
} from '@cardstack/runtime-common/oauth-route-admission';

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
  | { kind: 'elsewhere' }
  // A form-encoded body too large to look through for a token.
  | { kind: 'body-too-large' };

// Reads the request's bearer token from `Authorization: Bearer` only. A token
// in the query string, or in a form-encoded body (RFC 6750 §2.2, §2.3), is
// `elsewhere`, even beside one in the header. A form-encoded body is read
// here to look for one, and isn't left for the route: no OAuth resource's
// route takes one. One over `FORM_BODY_LIMIT_BYTES` is refused unread.
//
// A form body is recognized by its `Content-Type` alone. `ctxt.is()` also
// asks for a `Content-Length` or `Transfer-Encoding`, and an HTTP/2 request
// may send neither, so it would miss a body sent that way. `request.type`
// keeps any whitespace before the `;` that starts the parameters, which RFC
// 9110 allows, so it is trimmed.
export async function bearerToken(ctxt: Koa.Context): Promise<BearerToken> {
  if (new URLSearchParams(ctxt.querystring).has('access_token')) {
    return { kind: 'elsewhere' };
  }
  if (
    ctxt.request.type.trim().toLowerCase() ===
    'application/x-www-form-urlencoded'
  ) {
    let body = await readBody(ctxt, FORM_BODY_LIMIT_BYTES);
    if (body === undefined) {
      return { kind: 'body-too-large' };
    }
    if (new URLSearchParams(body).has('access_token')) {
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
// answers as RFC 6750 §3.1 and ADR 021 §1.5 say:
//
// - a token outside the header: `400 invalid_request`, without a lookup;
// - a form-encoded body too large to look through: `413`, without a lookup;
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
    if (found.kind === 'body-too-large') {
      log.info(
        `request refused: form body over ${FORM_BODY_LIMIT_BYTES} bytes, resource ${resource.id}`,
      );
      ctxt.status = 413;
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
    // The token stops here: the route sees the verified caller, and no
    // header, parsed or raw, it could forward or log.
    withoutAuthorization(ctxt.req);
    ctxt.state.oauthCaller = caller;
    await next();
  };
}

// Removes the `Authorization` header from the request: from its parsed
// headers, and from its raw headers, which list each name and value in turn.
export function withoutAuthorization(req: Koa.Context['req']) {
  delete req.headers.authorization;
  let raw = req.rawHeaders;
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    if (raw[i].toLowerCase() === 'authorization') {
      raw.splice(i, 2);
    }
  }
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
