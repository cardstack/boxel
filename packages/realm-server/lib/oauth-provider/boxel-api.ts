// What the Boxel API's controllers share (ADR 021 §1.5): reading which kind of
// token a request carries, checking a verified caller against the route its
// router selected, and answering a refusal as RFC 6750 §3.1 says. The
// controllers are `jwtMiddleware`, `multiRealmAuthorization` and, in each
// realm, `Realm`'s request authentication. Each calls the lookup
// (`resolveOAuthAccessToken`) itself, once per request; nothing here does,
// so no route that checks a session token its own way (such as
// `/_download-realm`) can reach it through a shared helper.

import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import {
  admitsRoute,
  isOAuthAccessTokenShaped,
  realmRouteScopes,
  type RealmOAuthResource,
} from '@cardstack/runtime-common/oauth-route-admission';
import {
  resolveOAuthAccessToken,
  resolveOAuthGrant,
  type OAuthCaller,
} from './lookup.ts';
import {
  boxelApiResource,
  oauthIssuer,
  type OAuthResource,
} from './registry.ts';
import { clientIdForLogs } from './client-metadata-document.ts';
import { logCallerRefused } from './events.ts';
import {
  bearerChallenge,
  bearerToken,
  withoutAuthorization,
} from './resource.ts';

const log = logger('boxel:oauth-provider');

export interface BoxelApi {
  dbAdapter: DBAdapter;
  issuer: string;
  resource: OAuthResource;
}

export function boxelApi(
  dbAdapter: DBAdapter,
  { issuer, registry }: { issuer: string; registry: readonly OAuthResource[] },
): BoxelApi {
  return {
    dbAdapter,
    issuer: oauthIssuer(issuer),
    resource: boxelApiResource(registry, issuer),
  };
}

// The kind of credential a request presents. `session` is one of Boxel's
// session JWTs (or anything else in the header that the session path
// judges), and `oauth` a value shaped like an OAuth access token in the
// `Authorization: Bearer` header, which only the lookup may judge. A token in
// the query string, or in a form-encoded body, is `elsewhere`, refused `400`
// without a lookup; `readFormBody: false` is for a controller that has
// already read the body for its own purposes.
export type PresentedCredential =
  | { kind: 'none' }
  | { kind: 'session' }
  | { kind: 'oauth'; token: string }
  | { kind: 'elsewhere' }
  | { kind: 'body-too-large' };

export async function presentedCredential(
  ctxt: Koa.Context,
  { readFormBody = true }: { readFormBody?: boolean } = {},
): Promise<PresentedCredential> {
  if (new URLSearchParams(ctxt.querystring).has('access_token')) {
    return { kind: 'elsewhere' };
  }
  let header = ctxt.get('Authorization');
  let bearer = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header)?.[1];
  if (header && !(bearer && isOAuthAccessTokenShaped(bearer))) {
    return { kind: 'session' };
  }
  if (!readFormBody) {
    return bearer ? { kind: 'oauth', token: bearer } : { kind: 'none' };
  }
  let found = await bearerToken(ctxt);
  if (found.kind === 'header') {
    return { kind: 'oauth', token: found.token };
  }
  return found;
}

// Answers a request whose credential the Boxel API refuses before any lookup:
// a token outside the header, or a form body too large to look through.
export function refusePresentation(
  ctxt: Koa.Context,
  kind: 'elsewhere' | 'body-too-large',
) {
  if (kind === 'elsewhere') {
    log.info(`token refused: not in the header, Boxel API`);
    ctxt.status = 400;
    ctxt.set('WWW-Authenticate', 'Bearer error="invalid_request"');
    ctxt.body = { error: 'invalid_request' };
    return;
  }
  log.info(`request refused: form body too large to read, Boxel API`);
  ctxt.status = 413;
  ctxt.body = { error: 'invalid_request' };
}

// Answers a token the lookup refused, or one on a route no scope maps: `401
// invalid_token`, whatever the reason, which goes to telemetry only.
export function refuseOAuthToken(ctxt: Koa.Context, api: BoxelApi) {
  ctxt.status = 401;
  ctxt.set(
    'WWW-Authenticate',
    bearerChallenge(api.issuer, api.resource, { error: 'invalid_token' }),
  );
  ctxt.body = { error: 'invalid_token' };
}

// The route-map check (§1.3) for a verified caller on a realm-server route,
// matched as the router selected it, after any method override. Answers the
// request and returns false when the caller is refused: `401 invalid_token`
// on a route no scope maps, `403 insufficient_scope` on one the caller's
// scopes don't reach. On admission, the token goes no further than here: the
// `Authorization` header is removed, parsed and raw, so the route can't
// forward or log it.
export function admitOAuthCaller(
  ctxt: Koa.Context,
  api: BoxelApi,
  caller: OAuthCaller,
): boolean {
  let admitted = admitsRoute(api.resource.scopes, caller, {
    method: ctxt.method,
    path: String(ctxt._matchedRoute ?? ''),
  });
  if (!admitted.admitted) {
    if (admitted.scopes.length === 0) {
      logCallerRefused(
        caller,
        clientIdForLogs(caller.clientId),
        'route-not-mapped',
        'Boxel API',
        `token refused: route not mapped, Boxel API, client ${caller.clientId}`,
      );
      refuseOAuthToken(ctxt, api);
      return false;
    }
    logCallerRefused(
      caller,
      clientIdForLogs(caller.clientId),
      'insufficient-scope',
      'Boxel API',
      `token refused: insufficient scope, Boxel API, client ${caller.clientId}`,
    );
    ctxt.status = 403;
    ctxt.set(
      'WWW-Authenticate',
      bearerChallenge(api.issuer, api.resource, {
        error: 'insufficient_scope',
        scope: admitted.scopes,
      }),
    );
    // The body names the scope too, so a caller that only sees the body,
    // such as a command whose tab called a route that spends AI credits, can
    // tell the user which scope to sign in again with.
    ctxt.body = {
      error: 'insufficient_scope',
      scope: admitted.scopes.join(' '),
    };
    return false;
  }
  withoutAuthorization(ctxt.req);
  return true;
}

// What a realm needs to be one of the Boxel API's controllers, since it can't
// read the registry (§1.3): the realm-route part of the map, the challenge it
// answers with, and the lookup to call, once per request.
export function boxelApiForRealms(api: BoxelApi): RealmOAuthResource {
  return {
    resource: api.resource.id,
    scopes: realmRouteScopes(api.resource.scopes),
    challenge: (options) => bearerChallenge(api.issuer, api.resource, options),
    resolve: (token) =>
      resolveOAuthAccessToken(api.dbAdapter, token, api.resource.id),
    refused: (caller, reason) =>
      logCallerRefused(
        caller,
        clientIdForLogs(caller.clientId),
        reason,
        'Boxel API',
        `token refused: ${reason.replaceAll('-', ' ')}, Boxel API realm route, client ${caller.clientId}`,
      ),
    resolveGrant: (tabToken) =>
      resolveOAuthGrant(api.dbAdapter, tabToken, api.resource.id),
  };
}
