// Decides what of an incoming request a Sentry event carries. Sentry's HTTP
// instrumentation records an incoming request's headers, cookies, query string
// and URL, plus up to 1 MB of any body a handler reads through `data`
// listeners, and attaches them to any event raised while that request is in
// flight. Sentry keeps up to `maxValueLength` characters of each value. So:
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
// Kept free of imports so `instrument.ts`, which runs before anything else,
// can install it.

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
