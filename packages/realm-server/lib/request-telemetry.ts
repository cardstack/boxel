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
//   the credential headers (`Authorization`, `Proxy-Authorization`, `Cookie`,
//   `Set-Cookie` and the request-signature headers) and the parsed cookies,
//   and with any `token` query parameter masked. The caller's session token
//   is no help in triage and is a liability once stored.
// - On every event, a breadcrumb that names a proxy route's URL (the request
//   log line, kept by Sentry's console integration) loses that URL's query
//   string. Nothing here looks for header values in a breadcrumb: the request
//   log's header line masks the credential headers before it is written.
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

// The headers whose value is a credential: the caller's session token, its
// cookies, the HMAC signatures that authenticate a worker request
// (`WORKER_REQUEST_SIGNATURE_HEADER`) and a session delegation
// (`DELEGATED_USER_REALM_SESSION_SIGNATURE_HEADER`), and any header whose name
// marks it as a signature, token, secret or API key. That last rule covers the
// webhook routes: `/_stripe-webhook` checks `Stripe-Signature`, and an
// incoming webhook checks whichever header its configuration names (such as
// `X-Hub-Signature-256`), which no fixed list can know. A signature is
// replayable with its body, so it is treated like a token. The names are
// spelled out here, not imported, to keep this module free of imports. The
// request log's header line masks these, and an event's request context drops
// them.
const credentialHeaders = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-boxel-worker-request-signature',
  'x-boxel-delegation-signature',
]);

const credentialHeaderName = /signature|token|secret|api-?key/i;

export function isCredentialHeader(name: string): boolean {
  return (
    credentialHeaders.has(name.toLowerCase()) || credentialHeaderName.test(name)
  );
}

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

// Matches the router, which ignores case and also accepts the path with a
// trailing slash.
function isProxyRoutePath(pathname: string): boolean {
  let path = pathname.toLowerCase();
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return proxyRoutePaths.has(path);
}

// A proxy route's URL followed by a query string, wherever it is written: the
// request log line names the incoming URL, and Sentry keeps that line as a
// breadcrumb on every event raised during the request.
const proxyRouteQuery = new RegExp(
  `(${[...proxyRoutePaths]
    .map((path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(/?)\\?[^\\s"'<>]*`,
  'gi',
);

function withoutProxyRouteQueries(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.replace(proxyRouteQuery, '$1$2');
  }
  if (depth > 4 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => withoutProxyRouteQueries(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      withoutProxyRouteQueries(item, depth + 1),
    ]),
  );
}

interface Breadcrumb {
  message?: string;
  data?: unknown;
}

function scrubBreadcrumbs(breadcrumbs: Breadcrumb[]): Breadcrumb[] {
  return breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    ...(breadcrumb.message !== undefined
      ? { message: withoutProxyRouteQueries(breadcrumb.message) as string }
      : {}),
    ...(breadcrumb.data !== undefined
      ? { data: withoutProxyRouteQueries(breadcrumb.data) }
      : {}),
  }));
}

// The query parameter that carries a bearer credential on ordinary routes: a
// capture-URL token, or a session JWT on a `_download-realm` link. Masked the
// same way the request log masks it.
const TOKEN_PARAM = 'token';
const MASKED = 'REDACTED';

function withTokenMasked(url: string | undefined): string | undefined {
  let parsed = parseURL(url);
  if (!parsed || !parsed.searchParams.has(TOKEN_PARAM)) {
    return url;
  }
  parsed.searchParams.set(TOKEN_PARAM, MASKED);
  return parsed.href;
}

function queryWithTokenMasked(query: unknown): unknown {
  if (typeof query === 'string') {
    let params = new URLSearchParams(query);
    if (!params.has(TOKEN_PARAM)) {
      return query;
    }
    params.set(TOKEN_PARAM, MASKED);
    return params.toString();
  }
  if (Array.isArray(query)) {
    return query.map((pair) =>
      Array.isArray(pair) && pair[0] === TOKEN_PARAM ? [pair[0], MASKED] : pair,
    );
  }
  if (query && typeof query === 'object' && TOKEN_PARAM in query) {
    return { ...query, [TOKEN_PARAM]: MASKED };
  }
  return query;
}

function withoutCredentials(request: SentryRequestData): SentryRequestData {
  let { cookies: _cookies, headers, ...rest } = request;
  let kept: SentryRequestData = {
    ...rest,
    ...(rest.url !== undefined ? { url: withTokenMasked(rest.url) } : {}),
    ...(rest.query_string !== undefined
      ? { query_string: queryWithTokenMasked(rest.query_string) }
      : {}),
  };
  if (!headers) {
    return kept;
  }
  let keptHeaders: Record<string, string | string[] | undefined> = {};
  for (let [name, value] of Object.entries(headers)) {
    if (!isCredentialHeader(name)) {
      keptHeaders[name] = value;
    }
  }
  return { ...kept, headers: keptHeaders };
}

// Whether telemetry about this request keeps only its method and path: a
// request to the secure origin or to a proxy route. `url` is the full request
// URL; `headers` supply the host when they carry one.
export function keepsMethodAndPathOnly(request: {
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}): boolean {
  if (isSecureOriginRequestData(request)) {
    return true;
  }
  let parsed = parseURL(request.url);
  return parsed !== undefined && isProxyRoutePath(parsed.pathname);
}

// Sentry `beforeSend` / `beforeSendTransaction` hook.
export function scrubRequestTelemetry<
  E extends { request?: SentryRequestData; breadcrumbs?: Breadcrumb[] },
>(event: E): E {
  if (Array.isArray(event.breadcrumbs)) {
    (event as { breadcrumbs?: Breadcrumb[] }).breadcrumbs = scrubBreadcrumbs(
      event.breadcrumbs,
    );
  }
  let request = event.request;
  if (!request) {
    return event;
  }
  let parsed = parseURL(request.url);
  let methodAndPathOnly = keepsMethodAndPathOnly(request);
  (event as { request?: SentryRequestData }).request = methodAndPathOnly
    ? {
        ...(request.method ? { method: request.method } : {}),
        ...(parsed ? { url: `${parsed.origin}${parsed.pathname}` } : {}),
      }
    : withoutCredentials(request);
  return event;
}
