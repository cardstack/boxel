// How a flow starts, and how it fails (ADR 021 §1.7, §1.8).
//
// An app sends the user's browser to the authorization endpoint. Boxel checks
// the request before the library sees it, so a request Boxel refuses never
// reaches the library and is never redirected to an address the app chose:
// with open registration, that would let anyone use Boxel's domain to send a
// browser to their own site (RFC 9700 §4.11.2). A refusal, and an error the
// library can't send back to a valid client (an unknown client, or a redirect
// URI the client didn't register), is stored under a short-lived reference,
// and the browser goes to the secure origin's error page with it. The page
// reads the error by its reference, and its "Return" link goes through the
// realm server, which sends the browser to the redirect URI it stored, once.
// The secure origin never handles a redirect address itself.
//
// A request that passes goes to the library, which starts an interaction and
// sends the browser to the interaction route, which hands it to the secure
// origin's authorize page.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import type { KoaContextWithOIDC } from 'oidc-provider';
import {
  CLIENT_IP_HEADER,
  logger,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import {
  CallerLimitAlert,
  takeFromCallerLimit,
  type CallerLimit,
} from './caller-limit.ts';
import { appName, type AppName } from './app-name.ts';
import {
  findAuthorizationError,
  storeAuthorizationError,
  takeAuthorizationError,
  type AuthorizationErrorRecord,
  type AuthorizationRefusalReason,
} from './objects.ts';
import type { OAuthResource } from './registry.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_AUTHORIZATION_PATH = `${OAUTH_PROVIDER_PATH}/auth`;
export const OAUTH_INTERACTION_PATH = `${OAUTH_PROVIDER_PATH}/interaction`;
export const OAUTH_ERROR_PATH = `${OAUTH_PROVIDER_PATH}/error`;

export const OAUTH_AUTHORIZATION_RATE_LIMIT_VAR =
  'BOXEL_OAUTH_AUTHORIZATION_RATE_LIMIT';

// A caller limit (`caller-limit.ts`) on starting a flow. Every request
// counts, refused or not, and an admitted one may write an interaction or an
// error reference, each kept ten minutes, so the overall bucket also bounds
// how many of those are stored at once.
export const DEFAULT_AUTHORIZATION_LIMIT: CallerLimit = Object.freeze({
  perAddress: Object.freeze({ requests: 30, windowSeconds: 600 }),
  perNetwork: Object.freeze({ requests: 150, windowSeconds: 600 }),
  overall: Object.freeze({ requests: 2000, windowSeconds: 600 }),
  alertAfter: 1000,
});

// The error page's states that need nothing stored: a request that is over
// the limit, which must write nothing, and a reference that is spent, expired
// or was never issued. A reference is a long random value, so it is never one
// of these.
export const FIXED_ERROR_PAGES = Object.freeze({
  expired: 'expired',
  rateLimited: 'rate_limited',
});

type Query = Record<string, string | string[] | undefined>;

interface Refusal {
  error: string;
  reason: AuthorizationRefusalReason;
}

// The parts of the library's client that Boxel's own routes read.
export interface LibraryClient {
  clientId: string;
  clientName?: string;
  grantTypes?: readonly string[];
  redirectUriAllowed(value: string): boolean;
}

// The URL of the secure origin's authorize page, which shows a flow's consent
// and its errors.
export function authorizePageURL(secureOriginURL: URL): URL {
  return new URL(`${secureOriginURL.href.replace(/\/*$/, '/')}authorize`);
}

export function errorPageURL(secureOriginURL: URL, error: string): string {
  let url = authorizePageURL(secureOriginURL);
  url.searchParams.set('error', error);
  return url.href;
}

// Sends the browser on, top level. The URL it leaves carries an interaction
// ID or an error reference, which no other site may read from the referrer.
export function navigate(ctxt: Koa.Context, location: string) {
  ctxt.set('Referrer-Policy', 'no-referrer');
  ctxt.set('Cache-Control', 'no-store');
  ctxt.status = 303;
  ctxt.redirect(location);
  ctxt.status = 303;
}

// The client a flow names, or undefined when there is none the library can
// load.
export async function findClient(
  provider: Provider,
  clientId: unknown,
): Promise<LibraryClient | undefined> {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    return undefined;
  }
  try {
    return (await provider.Client.find(clientId)) as LibraryClient | undefined;
  } catch {
    // A stored client the library can no longer load is no client.
    return undefined;
  }
}

// Stands for a parameter that may appear once but appeared more often.
const REPEATED = Symbol('repeated');

// One value of a parameter that may appear once. Undefined when it is
// missing; `REPEATED` when it appears more than once.
function single(
  query: Query,
  name: string,
): string | undefined | typeof REPEATED {
  let value = query[name];
  if (Array.isArray(value)) {
    return REPEATED;
  }
  return value;
}

function many(query: Query, name: string): string[] {
  let value = query[name];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isAllowedAt(
  resource: OAuthResource,
  clientId: string,
  preRegistered: ReadonlySet<string>,
): boolean {
  return resource.clients === 'open' || preRegistered.has(clientId);
}

// Boxel's checks on a request, after the rate limit and with the session
// cookie already dropped: its shape, its resources, whether the client may use
// them, and its scopes (ADR 021 §1.3, §1.4). Answers the resources the
// request is for, or why it is refused. A request from a client the library
// doesn't know is handed on, since the library refuses it itself.
export function checkAuthorizationRequest(
  query: Query,
  {
    client,
    registry,
    preRegistered,
  }: {
    client: LibraryClient | undefined;
    registry: readonly OAuthResource[];
    preRegistered: ReadonlySet<string>;
  },
):
  | { refused: false; resources: OAuthResource[]; fromScopes: boolean }
  | { refused: false; unknownClient: true }
  | ({ refused: true } & Refusal) {
  // Shape.
  let responseType = single(query, 'response_type');
  let challenge = single(query, 'code_challenge');
  let challengeMethod = single(query, 'code_challenge_method');
  let prompt = single(query, 'prompt');
  let scopeParam = single(query, 'scope');
  // A repeated redirect URI or state is refused here too, rather than left to
  // the library: which copy a check reads and which one a redirect uses must
  // never differ.
  if (
    responseType === REPEATED ||
    challenge === REPEATED ||
    challengeMethod === REPEATED ||
    prompt === REPEATED ||
    scopeParam === REPEATED ||
    single(query, 'redirect_uri') === REPEATED ||
    single(query, 'state') === REPEATED
  ) {
    return refuse('invalid_request', 'malformed');
  }
  if (responseType !== 'code') {
    return refuse('unsupported_response_type', 'unsupported-response-type');
  }
  if (!challenge || challengeMethod !== 'S256') {
    return refuse('invalid_request', 'pkce-required');
  }
  // Consent is shown on every flow, so a flow that may not show anything can
  // never finish.
  if (prompt?.split(' ').includes('none')) {
    return refuse('invalid_request', 'prompt-none');
  }

  if (!client) {
    return { refused: false, unknownClient: true };
  }
  let scopes = (scopeParam ?? '').split(' ').filter(Boolean);
  if (scopes.includes('openid')) {
    return refuse('invalid_scope', 'openid');
  }

  // Resources.
  let named = many(query, 'resource');
  let resources: OAuthResource[] = [];
  let fromScopes = false;
  if (named.length > 0) {
    for (let id of new Set(named)) {
      let resource = registry.find((entry) => entry.id === id);
      if (!resource) {
        return refuse('invalid_target', 'unknown-resource');
      }
      resources.push(resource);
    }
  } else {
    // A client that names no resource is given the one it is allowed at
    // whose scopes cover what it asks for.
    let candidates = registry.filter(
      (resource) =>
        isAllowedAt(resource, client.clientId, preRegistered) &&
        scopes.length > 0 &&
        scopes.every((scope) =>
          resource.scopes.some(({ name }) => name === scope),
        ),
    );
    if (candidates.length !== 1) {
      let offered = new Set(
        registry.flatMap((resource) => resource.scopes.map(({ name }) => name)),
      );
      return scopes.some((scope) => !offered.has(scope))
        ? refuse('invalid_scope', 'unknown-scope')
        : refuse('invalid_target', 'no-resource-for-scopes');
    }
    resources = candidates;
    fromScopes = true;
  }

  // Client.
  if (
    resources.some(
      (resource) => !isAllowedAt(resource, client.clientId, preRegistered),
    )
  ) {
    return refuse('invalid_target', 'client-not-allowed');
  }

  // Scopes.
  if (
    scopes.some(
      (scope) =>
        !resources.some((resource) =>
          resource.scopes.some(({ name }) => name === scope),
        ),
    )
  ) {
    return refuse('invalid_scope', 'unknown-scope');
  }
  if (
    resources.some(
      (resource) => !resource.scopes.some(({ name }) => scopes.includes(name)),
    )
  ) {
    return refuse('invalid_scope', 'missing-scope');
  }
  return { refused: false, resources, fromScopes };
}

function refuse(
  error: string,
  reason: AuthorizationRefusalReason,
): { refused: true } & Refusal {
  return { refused: true, error, reason };
}

// The handler for `GET` on the authorization endpoint. `next` hands the
// request to the library.
export function authorizationHandler({
  provider,
  registry,
  preRegistered,
  dbAdapter,
  rateLimitStore,
  limit,
  secureOriginURL,
}: {
  provider: Provider;
  registry: readonly OAuthResource[];
  preRegistered: ReadonlySet<string>;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
  limit: CallerLimit;
  secureOriginURL: URL;
}): Koa.Middleware {
  let alert = new CallerLimitAlert(
    limit,
    ({ overall, alertAfter }) =>
      `more than ${alertAfter} OAuth flows started within ${overall.windowSeconds} seconds; ` +
      `starting one is refused for everyone at ${overall.requests}`,
  );
  let sessionCookies = sessionCookieNames(provider);
  return async function handleAuthorization(ctxt, next) {
    // 1. The limit, before anything is written.
    let address = ctxt.req.headers[CLIENT_IP_HEADER];
    let admitted = await takeFromCallerLimit(
      rateLimitStore,
      'oauth-authorization',
      typeof address === 'string' ? address : undefined,
      limit,
    );
    alert.note(admitted);
    if (!admitted.admitted) {
      log.info(`authorization refused by the limit: ${admitted.reason}`);
      return navigate(
        ctxt,
        errorPageURL(secureOriginURL, FIXED_ERROR_PAGES.rateLimited),
      );
    }

    // 2. The provider keeps no login between flows (ADR 021 §1.7): a session
    // the library remembered would sign this flow in as whoever it names.
    dropCookies(ctxt, sessionCookies);

    let query = ctxt.query as Query;
    let clientId = single(query, 'client_id');
    let client =
      clientId === REPEATED ? undefined : await findClient(provider, clientId);
    let check = checkAuthorizationRequest(query, {
      client,
      registry,
      preRegistered,
    });
    if (check.refused) {
      let redirectUri = single(query, 'redirect_uri');
      let state = single(query, 'state');
      let returnable =
        client !== undefined &&
        typeof redirectUri === 'string' &&
        state !== REPEATED &&
        client.redirectUriAllowed(redirectUri);
      log.info(
        `authorization refused: ${check.reason} (${check.error}), client ${client?.clientId ?? 'unknown'}`,
      );
      let reference = await storeAuthorizationError(dbAdapter, {
        error: check.error,
        reason: check.reason,
        ...(client ? { clientId: client.clientId } : {}),
        ...(returnable
          ? {
              redirectUri: redirectUri as string,
              ...(typeof state === 'string' ? { state } : {}),
            }
          : {}),
      });
      return navigate(ctxt, errorPageURL(secureOriginURL, reference));
    }
    if ('unknownClient' in check) {
      return next();
    }
    if (check.fromScopes) {
      let url = new URL(ctxt.req.url!, 'http://request.invalid');
      for (let { id } of check.resources) {
        url.searchParams.append('resource', id);
      }
      ctxt.req.url = `${url.pathname}${url.search}`;
      log.info(
        `authorization given its resource from its scopes, client ${client!.clientId}`,
      );
    }
    log.info(
      `authorization started: resources ${check.resources
        .map(({ id }) => id)
        .join(', ')}, client ${client!.clientId}`,
    );
    await next();
  };
}

// The library's session cookie and its signature, which the start of a flow
// and its resume drop.
export function sessionCookieNames(provider: Provider): string[] {
  let name = provider.cookieName('session');
  return [name, `${name}.sig`];
}

// Takes a cookie out of the request, so the library doesn't read it, and
// expires it in the browser.
export function dropCookies(ctxt: Koa.Context, names: string[]) {
  let header = ctxt.req.headers.cookie;
  if (header) {
    let kept = header
      .split(';')
      .map((pair) => pair.trim())
      .filter(
        (pair) => pair && !names.includes(pair.slice(0, pair.indexOf('='))),
      );
    if (kept.length > 0) {
      ctxt.req.headers.cookie = kept.join('; ');
    } else {
      delete ctxt.req.headers.cookie;
    }
  }
  for (let name of names) {
    ctxt.cookies.set(name, '', {
      path: '/',
      httpOnly: true,
      expires: new Date(0),
      overwrite: true,
    });
  }
}

// The library's `renderError`, called when it can't send an error back to the
// client: the client is unknown, the redirect URI isn't one it registered, or
// the request names neither. On the authorization endpoint, and on the resume
// route a finished flow continues on (whose request carries no client, and
// which fails when its interaction has expired or was already resumed), the
// error goes to Boxel's error page, with nothing to return to. Anywhere else,
// such as a registration sent by a browser, the library's JSON error is
// answered.
export function renderLibraryError({
  dbAdapter,
  secureOriginURL,
}: {
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
}) {
  return async function renderError(
    ctx: KoaContextWithOIDC,
    out: { error: string; error_description?: string },
  ) {
    let route = ctx.oidc?.route;
    if (route !== 'authorization' && route !== 'resume') {
      ctx.type = 'json';
      ctx.body = out;
      return;
    }
    let reason: AuthorizationRefusalReason =
      out.error === 'invalid_client'
        ? 'unknown-client'
        : out.error === 'invalid_redirect_uri'
          ? 'bad-redirect-uri'
          : 'library';
    let clientId = ctx.oidc.client?.clientId;
    log.info(
      `authorization refused: ${reason} (${out.error}), client ${clientId ?? 'unknown'}`,
    );
    let reference = await storeAuthorizationError(dbAdapter, {
      error: out.error,
      reason,
      ...(clientId ? { clientId } : {}),
    });
    navigate(ctx, errorPageURL(secureOriginURL, reference));
  };
}

// `GET /_oauth-provider/interaction/:uid`: the library sends the browser here
// to start the user's part of a flow, having set its interaction cookie for
// this path. Boxel's authorize page takes over from here.
export function interactionHandler({
  secureOriginURL,
}: {
  secureOriginURL: URL;
}): Koa.Middleware {
  return async function handleInteraction(ctxt) {
    let url = authorizePageURL(secureOriginURL);
    url.searchParams.set('interaction', ctxt.params.uid);
    navigate(ctxt, url.href);
  };
}

export interface AuthorizationErrorDetails {
  error: string;
  reason: AuthorizationRefusalReason;
  app?: AppName;
  returnOffered: boolean;
}

// `GET /_oauth-provider/error/:ref`, for the secure origin's error page: what
// went wrong, the app's name, and whether "Return" is offered. Answers only a
// request from the secure origin.
export function errorDetailsHandler({
  provider,
  dbAdapter,
  secureOriginURL,
  preRegistered,
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
  preRegistered: ReadonlySet<string>;
}): Koa.Middleware {
  return async function handleErrorDetails(ctxt) {
    ctxt.set('Cache-Control', 'no-store');
    if (ctxt.get('Origin') !== secureOriginURL.origin) {
      ctxt.status = 403;
      ctxt.body = { error: 'forbidden' };
      return;
    }
    let record = await findAuthorizationError(dbAdapter, ctxt.params.ref);
    if (!record) {
      ctxt.status = 404;
      ctxt.body = { error: FIXED_ERROR_PAGES.expired };
      return;
    }
    let client = await findClient(provider, record.clientId);
    let details: AuthorizationErrorDetails = {
      error: record.error,
      reason: record.reason,
      ...(client
        ? {
            app: appName({
              clientId: client.clientId,
              clientName: client.clientName,
              redirectUri: record.redirectUri,
              preRegistered,
            }),
          }
        : {}),
      returnOffered: isReturnable(record, client),
    };
    ctxt.body = details;
  };
}

// `GET /_oauth-provider/error/:ref/return`: "Return to …" on the error page.
// Sends the browser to the redirect URI stored with the error, with the
// error, once. Anything else goes to the page for an expired request.
export function errorReturnHandler({
  provider,
  dbAdapter,
  secureOriginURL,
}: {
  provider: Provider;
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
}): Koa.Middleware {
  return async function handleErrorReturn(ctxt) {
    let record = await takeAuthorizationError(dbAdapter, ctxt.params.ref);
    let client = record
      ? await findClient(provider, record.clientId)
      : undefined;
    if (!record || !isReturnable(record, client)) {
      return navigate(
        ctxt,
        errorPageURL(secureOriginURL, FIXED_ERROR_PAGES.expired),
      );
    }
    let destination = new URL(record.redirectUri!);
    destination.searchParams.set('error', record.error);
    if (record.state !== undefined) {
      destination.searchParams.set('state', record.state);
    }
    destination.searchParams.set('iss', provider.issuer);
    log.info(
      `authorization error returned to the client: ${record.reason}, client ${record.clientId}`,
    );
    navigate(ctxt, destination.href);
  };
}

// The client and the redirect URI stored with the error are still valid.
function isReturnable(
  record: AuthorizationErrorRecord,
  client: LibraryClient | undefined,
): boolean {
  return (
    client !== undefined &&
    record.redirectUri !== undefined &&
    client.redirectUriAllowed(record.redirectUri)
  );
}
