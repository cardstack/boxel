// Decides what of an incoming request a Sentry event carries. Sentry's HTTP
// instrumentation records the body of every incoming request a handler reads
// (up to 1 MB), along with its headers, cookies and query string, and attaches
// them to any event raised while that request is in flight. Sentry keeps up to
// `maxValueLength` characters of each value. So:
//
// - An event raised during a request to the secure origin or to a proxy route
//   keeps only the method and the URL's origin and path. The secure origin is
//   where credentials are typed. A proxy route's body is the caller's own
//   content (a forwarded request's URL, headers and body, or a whole prompt),
//   and its query string can carry a token.
// - An event raised during any other request keeps its request context, minus
//   the `Authorization` / `Proxy-Authorization` and `Cookie` headers and the
//   parsed cookies. The caller's session token is no help in triage and is a
//   liability once stored.
//
// Kept free of runtime imports so `instrument.ts`, which runs before anything
// else, can install it.

import type { IncomingMessage } from 'http';

// The routes that pass a caller's request on to an outside vendor.
export const REQUEST_FORWARD_PATH = '/_request-forward';
export const OPENROUTER_PASSTHROUGH_PATH = '/_openrouter/chat/completions';

const proxyRoutePaths = new Set([
  REQUEST_FORWARD_PATH,
  OPENROUTER_PASSTHROUGH_PATH,
]);

const credentialHeaders = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
]);

const secureOriginHosts = new Set<string>();

// Registers a host (`host[:port]`, as `URL#host` spells it) whose requests
// are secure-origin requests.
export function registerSecureOriginHost(host: string): void {
  secureOriginHosts.add(host.toLowerCase());
}

interface SentryRequestData {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: unknown;
  query_string?: unknown;
  data?: unknown;
  env?: unknown;
}

function requestHost(request: SentryRequestData): string | undefined {
  let headers = request.headers ?? {};
  for (let name of [':authority', 'host']) {
    let value = headers[name];
    if (typeof value === 'string' && value) {
      return value.toLowerCase();
    }
  }
  if (request.url) {
    try {
      return new URL(request.url).host.toLowerCase();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isSecureOriginRequestData(request: SentryRequestData): boolean {
  let host = requestHost(request);
  if (!host) {
    return false;
  }
  if (secureOriginHosts.has(host)) {
    return true;
  }
  // A Host header may carry the scheme's default port explicitly.
  let withoutDefaultPort = host.replace(/:(80|443)$/, '');
  return secureOriginHosts.has(withoutDefaultPort);
}

function parseURL(url: string | undefined): URL | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

// Matches the router, which also accepts the path with a trailing slash.
function isProxyRoutePath(pathname: string): boolean {
  let path =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  return proxyRoutePaths.has(path);
}

function withoutCredentials(request: SentryRequestData): SentryRequestData {
  let { cookies: _cookies, headers, ...rest } = request;
  if (!headers) {
    return rest;
  }
  let kept: Record<string, string | string[] | undefined> = {};
  for (let [name, value] of Object.entries(headers)) {
    if (!credentialHeaders.has(name.toLowerCase())) {
      kept[name] = value;
    }
  }
  return { ...rest, headers: kept };
}

// Sentry `beforeSend` / `beforeSendTransaction` hook.
export function scrubRequestTelemetry<
  E extends { request?: SentryRequestData },
>(event: E): E {
  let request = event.request;
  if (!request) {
    return event;
  }
  let parsed = parseURL(request.url);
  let methodAndPathOnly =
    isSecureOriginRequestData(request) ||
    (parsed !== undefined && isProxyRoutePath(parsed.pathname));
  (event as { request?: SentryRequestData }).request = methodAndPathOnly
    ? {
        ...(request.method ? { method: request.method } : {}),
        ...(parsed ? { url: `${parsed.origin}${parsed.pathname}` } : {}),
      }
    : withoutCredentials(request);
  return event;
}

// Sentry's HTTP instrumentation buffers an incoming request's body by
// replacing the request's own `on` / `off` with wrappers that copy each `data`
// chunk, up to 1 MB, and hold the joined body as a string until the request
// ends. A proxy route's body never reaches an event (see
// `scrubRequestTelemetry`), and it can be a multi-megabyte image or a prompt
// held open for a whole streamed completion, so a proxy route removes the
// wrappers before reading it. The request falls back to the
// `IncomingMessage` methods, which is all the wrappers delegate to; with no
// wrapper installed this does nothing.
export function stopRequestBodyCapture(req: IncomingMessage): void {
  for (let name of ['on', 'off'] as const) {
    if (Object.prototype.hasOwnProperty.call(req, name)) {
      delete (req as unknown as Record<string, unknown>)[name];
    }
  }
}
