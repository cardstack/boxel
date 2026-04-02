import { notFound, CardError, responseWithError } from './error';
import type { RequestContext } from './index';
import { RealmPaths, logger } from './index';

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
export enum AuthenticationErrorMessages {
  MissingAuthHeader = 'Missing Authorization header',
  PermissionMismatch = "User permissions in the JWT payload do not match the server's permissions", // Could happen if the user's permissions were changed during the life of the JWT
  TokenExpired = 'Token expired',
  TokenInvalid = 'Token invalid',
}

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

import { SupportedMimeType } from './supported-mime-type';
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
  return undefined;
}

export type RouteTable<T> = Map<SupportedMimeType, Map<Method, Map<string, T>>>;

export function lookupRouteTable<T>(
  routeTable: RouteTable<T>,
  paths: RealmPaths,
  request: Request,
) {
  let acceptMimeType = extractSupportedMimeType(
    request.headers.get('Accept') as unknown as null | string | [string],
  );
  if (!isHTTPMethod(request.method)) {
    return;
  }
  let routes = acceptMimeType
    ? routeTable.get(acceptMimeType)?.get(request.method)
    : undefined;
  // Fall back to Content-Type when Accept doesn't match a route. This
  // supports POST/PATCH routes where the request body type (e.g.
  // application/octet-stream) is the meaningful discriminator rather than the
  // desired response type.
  if (!routes) {
    let contentType = extractSupportedMimeType(
      request.headers.get('Content-Type') as unknown as
        | null
        | string
        | [string],
    );
    if (!contentType) {
      return;
    }
    routes = routeTable.get(contentType)?.get(request.method);
    if (!routes) {
      return;
    }
  }

  // we construct a new URL within RealmPath.local() param that strips off the query string
  let requestPath = `/${paths.local(new URL(request.url))}`;
  // add a leading and trailing slashes back so we can match on routing rules for directories.
  requestPath =
    request.url.endsWith('/') && requestPath !== '/'
      ? `${requestPath}/`
      : requestPath;
  for (let [route, value] of routes) {
    // let's take care of auto escaping '/' and anchoring in our route regex's
    // to make it more readable in our config
    let routeRegExp = new RegExp(`^${route.replace('/', '\\/')}$`);
    if (routeRegExp.test(requestPath)) {
      return value;
    }
  }
  return;
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
