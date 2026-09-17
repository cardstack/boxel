import { notFound, CardError, responseWithError } from './error.ts';
import type { RequestContext } from './index.ts';
import { RealmPaths, logger } from './index.ts';

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
// Thrown at the realm request boundary when a request targets an archived
// (sealed) realm. Surfaced as a 403 carrying an "archived" marker so the
// client can render the sealed state rather than a generic forbidden error.
export class ArchivedRealmError extends Error {}
// A `const` object (rather than a TS `enum`) so the declaration is
// erasable and runs under Node's native `--experimental-strip-types`.
export const AuthenticationErrorMessages = {
  MissingAuthHeader: 'Missing Authorization header',
  // Could happen if the user's permissions were changed during the life of the JWT
  PermissionMismatch:
    "User permissions in the JWT payload do not match the server's permissions",
  TokenExpired: 'Token expired',
  TokenInvalid: 'Token invalid',
  // The token was issued before this user's sessions were revoked. Clients with
  // a live matrix session recover by re-authenticating, same as for an expired
  // token, so this is deliberately a 401 rather than a 403.
  SessionRevoked: 'Session revoked',
} as const;
export type AuthenticationErrorMessages =
  (typeof AuthenticationErrorMessages)[keyof typeof AuthenticationErrorMessages];

type Handler = (
  request: Request,
  requestContext: RequestContext,
) => Promise<Response>;

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack?.trim() || error.message;
  }

  if (
    error === null ||
    error === undefined ||
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return String(error);
  }

  try {
    let serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  } catch {
    // fall through to object tag
  }

  let tag = Object.prototype.toString.call(error);
  return tag === '[object Object]' ? 'non-Error object thrown' : tag;
}

export type Method = 'GET' | 'QUERY' | 'POST' | 'PATCH' | 'DELETE' | 'HEAD';

import { SupportedMimeType } from './supported-mime-type.ts';
export { SupportedMimeType };

function isHTTPMethod(method: unknown): method is Method {
  if (typeof method !== 'string') {
    return false;
  }
  return ['GET', 'QUERY', 'POST', 'PATCH', 'DELETE', 'HEAD'].includes(method);
}

export function extractSupportedMimeType(
  rawAcceptHeader: null | string | [string],
): SupportedMimeType | undefined {
  if (!rawAcceptHeader) {
    return undefined;
  }
  let acceptMimeTypes = Array.isArray(rawAcceptHeader)
    ? rawAcceptHeader
    : rawAcceptHeader.split(/,\s*/);
  let supportedMimeTypes = Object.values(SupportedMimeType);
  for (const candidateMimeType of acceptMimeTypes) {
    if (supportedMimeTypes.includes(candidateMimeType as SupportedMimeType)) {
      return candidateMimeType as SupportedMimeType;
    }
  }
  // A media type is its type and subtype; its parameters qualify it without
  // making it a different type. The pass above compares whole header values,
  // so it answers only for the one spelling a registered type is written in —
  // which is every spelling anything sent until a registered type carried a
  // parameter of its own. One does now: the operations envelope is
  // `application/vnd.api+json` with an `ext` naming its extension, and the
  // ways a client legitimately writes that (a space after the semicolon, an
  // unquoted value, a `charset` alongside, its URI in a list with another
  // extension's) are all the same media type and none of them is that string.
  //
  // So a second pass compares the parts. It only ever adds a match where the
  // first pass found none, and it prefers the registered type whose own
  // extensions the candidate carries — otherwise a body that named the
  // envelope's extension would route to the plain JSON:API family and be
  // answered as though it had named none.
  for (const candidateMimeType of acceptMimeTypes) {
    let matched = matchParameterized(candidateMimeType, supportedMimeTypes);
    if (matched) {
      return matched;
    }
  }
  return undefined;
}

interface ParsedMediaType {
  type: string;
  // The extension URIs the `ext` parameter names, which JSON:API writes as a
  // space-separated list. Compared case-sensitively — they are URIs — while
  // the type and the parameter's name are not.
  extensions: string[];
}

function parseMediaType(value: string): ParsedMediaType {
  let [type, ...parameters] = value.split(';');
  let extensions: string[] = [];
  for (let parameter of parameters) {
    let separator = parameter.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (parameter.slice(0, separator).trim().toLowerCase() !== 'ext') {
      continue;
    }
    let raw = parameter.slice(separator + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    extensions.push(...raw.split(/\s+/).filter(Boolean));
  }
  return { type: type.trim().toLowerCase(), extensions };
}

function matchParameterized(
  candidate: string,
  supportedMimeTypes: SupportedMimeType[],
): SupportedMimeType | undefined {
  let sent = parseMediaType(candidate);
  if (!sent.type) {
    return undefined;
  }
  let plain: SupportedMimeType | undefined;
  for (let supported of supportedMimeTypes) {
    let registered = parseMediaType(supported);
    if (registered.type !== sent.type) {
      continue;
    }
    if (registered.extensions.length === 0) {
      plain ??= supported;
      continue;
    }
    if (
      registered.extensions.every((extension) =>
        sent.extensions.includes(extension),
      )
    ) {
      return supported;
    }
  }
  return plain;
}

export type RouteTable<T> = Map<SupportedMimeType, Map<Method, Map<string, T>>>;

export function lookupRouteTable<T>(
  routeTable: RouteTable<T>,
  paths: RealmPaths,
  request: Request,
) {
  if (!isHTTPMethod(request.method)) {
    return;
  }
  // we construct a new URL within RealmPath.local() param that strips off the query string
  let requestPath = `/${paths.local(new URL(request.url))}`;
  // add a leading and trailing slashes back so we can match on routing rules for directories.
  requestPath =
    request.url.endsWith('/') && requestPath !== '/'
      ? `${requestPath}/`
      : requestPath;

  let acceptMimeType = extractSupportedMimeType(
    request.headers.get('Accept') as unknown as null | string | [string],
  );
  let matched = acceptMimeType
    ? matchRoute(
        routeTable.get(acceptMimeType)?.get(request.method),
        requestPath,
      )
    : undefined;
  if (matched !== undefined) {
    return matched;
  }
  // Fall back to Content-Type when `Accept` doesn't match a route. This
  // supports POST/PATCH routes where the request body type (e.g.
  // application/octet-stream) is the meaningful discriminator rather than the
  // desired response type.
  //
  // The fall-through is on failing to match a *route*, not on the family
  // holding no routes for the method. A family can hold routes for this
  // method and none for this path — `application/json` has three `POST`
  // routes, all of them other paths — and stopping there would answer "no
  // such route" to a request whose `Content-Type` named one.
  let contentType = extractSupportedMimeType(
    request.headers.get('Content-Type') as unknown as null | string | [string],
  );
  if (!contentType || contentType === acceptMimeType) {
    return;
  }
  return matchRoute(
    routeTable.get(contentType)?.get(request.method),
    requestPath,
  );
}

function matchRoute<T>(
  routes: Map<string, T> | undefined,
  requestPath: string,
): T | undefined {
  if (!routes) {
    return undefined;
  }
  for (let [route, value] of routes) {
    // let's take care of auto escaping '/' and anchoring in our route regex's
    // to make it more readable in our config
    let routeRegExp = new RegExp(`^${route.replace('/', '\\/')}$`);
    if (routeRegExp.test(requestPath)) {
      return value;
    }
  }
  return undefined;
}

export class Router {
  #routeTable: RouteTable<Handler> = new Map<
    SupportedMimeType,
    Map<Method, Map<string, Handler>>
  >();
  log = logger('realm:router');
  #paths: RealmPaths;
  constructor(mountURL: URL) {
    this.#paths = new RealmPaths(mountURL);
  }

  get(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'GET', path, handler);
    return this;
  }
  query(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'QUERY', path, handler);
    return this;
  }
  post(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'POST', path, handler);
    return this;
  }
  patch(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'PATCH', path, handler);
    return this;
  }
  delete(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'DELETE', path, handler);
    return this;
  }
  head(path: string, mimeType: SupportedMimeType, handler: Handler): Router {
    this.setRoute(mimeType, 'HEAD', path, handler);
    return this;
  }

  private setRoute(
    mimeType: SupportedMimeType,
    method: Method,
    path: string,
    handler: Handler,
  ) {
    let routeFamily = this.#routeTable.get(mimeType);
    if (!routeFamily) {
      routeFamily = new Map();
      this.#routeTable.set(mimeType, routeFamily);
    }
    let routes = routeFamily.get(method);
    if (!routes) {
      routes = new Map();
      routeFamily.set(method, routes);
    }
    routes.set(path, handler);
  }

  handles(request: Request): boolean {
    return !!this.lookupHandler(request);
  }

  async handle(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let handler = this.lookupHandler(request);
    if (!handler) {
      return notFound(request, requestContext);
    }
    try {
      return await handler(request, requestContext);
    } catch (err) {
      if (err instanceof CardError) {
        // Without this line a thrown CardError is indistinguishable in the
        // request log from a handler that returned the same status
        // deliberately (e.g. a 404 from a routed endpoint that can't
        // otherwise produce one), which makes such failures undiagnosable
        // from CI logs alone.
        this.log.warn(
          `handler for ${request.method} ${request.url} threw CardError ` +
            `(status ${err.status}): ${err.message}`,
        );
        return responseWithError(err, requestContext);
      }

      this.log.error(err);

      return new Response(
        `unexpected exception in realm ${formatUnknownError(err)}`,
        {
          status: 500,
        },
      );
    }
  }

  private lookupHandler(request: Request): Handler | undefined {
    return lookupRouteTable(this.#routeTable, this.#paths, request);
  }
}
