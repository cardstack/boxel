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
//   parsed cookies, and with any `token` query parameter masked. The caller's
//   session token is no help in triage and is a liability once stored.
// - On every event, a breadcrumb that names a proxy route's URL (the request
//   log line, kept by Sentry's console integration) loses that URL's query
//   string.
// - A transaction carries the incoming URL again in its spans' data: the
//   server span's `http.url`, `http.target` and `http.query`, which the trace
//   context holds as the transaction's own data, and the like on each child
//   span. A breadcrumb for an outgoing request records its URL under the same
//   names. These URL attributes follow the request's rules: on a transaction
//   or event for a request to the secure origin or a proxy route, each keeps
//   only its origin and path, with no query string or fragment; on any other,
//   each keeps its query with any `token` parameter masked. A URL attribute
//   that itself names the secure origin or a proxy route keeps only its origin
//   and path either way. A transaction's name and its spans' descriptions are
//   the method and path alone already.
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
    if (!credentialHeaders.has(name.toLowerCase())) {
      keptHeaders[name] = value;
    }
  }
  return { ...kept, headers: keptHeaders };
}

// Whether an event for this request keeps only its method and the origin and
// path of its URLs: a request to the secure origin or to a proxy route.
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

type SpanData = Record<string, unknown>;

interface SpanJSON {
  data?: SpanData;
}

interface TraceContexts {
  trace?: { data?: SpanData };
}

// The span attributes that record a URL, by which part of it they hold. Sentry
// copies the OpenTelemetry HTTP instrumentation's attributes into a span's
// data and adds `url` and `http.query` (and `http.fragment`) of its own.
const fullURLAttributes = ['url', 'http.url', 'url.full'];
const pathAndQueryAttributes = ['http.target'];
const queryAttributes = ['http.query', 'url.query'];
const fragmentAttributes = ['http.fragment', 'url.fragment'];

// The request a span's attributes describe, as `event.request` would.
function spanRequest(data: SpanData): SentryRequestData {
  let url = fullURLAttributes
    .map((name) => data[name])
    .find((value): value is string => typeof value === 'string');
  let host = data['http.host'] ?? data['server.address'];
  return {
    ...(url !== undefined ? { url } : {}),
    ...(typeof host === 'string' ? { headers: { host } } : {}),
  };
}

function withPathOnly(pathAndQuery: string): string {
  return pathAndQuery.replace(/[?#].*$/s, '');
}

function pathAndQueryWithTokenMasked(pathAndQuery: string): string {
  let queryStart = pathAndQuery.indexOf('?');
  if (queryStart === -1) {
    return pathAndQuery;
  }
  let fragmentStart = pathAndQuery.indexOf('#', queryStart);
  let queryEnd = fragmentStart === -1 ? pathAndQuery.length : fragmentStart;
  let query = pathAndQuery.slice(queryStart + 1, queryEnd);
  let masked = queryWithTokenMasked(query);
  return masked === query
    ? pathAndQuery
    : `${pathAndQuery.slice(0, queryStart + 1)}${masked}${pathAndQuery.slice(queryEnd)}`;
}

// A query attribute may or may not keep the URL's leading `?`.
function queryAttributeWithTokenMasked(query: unknown): unknown {
  if (typeof query !== 'string' || !query.startsWith('?')) {
    return queryWithTokenMasked(query);
  }
  return `?${queryWithTokenMasked(query.slice(1)) as string}`;
}

// The URL attributes of a span or breadcrumb follow the incoming request's
// rules. A URL attribute that names the secure origin or a proxy route itself
// keeps only its origin and path whatever the request.
function scrubURLAttributes(
  data: SpanData,
  methodAndPathOnly: boolean,
): SpanData {
  let pathOnly = methodAndPathOnly || keepsMethodAndPathOnly(spanRequest(data));
  let scrubbed: SpanData = {};
  for (let [name, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      scrubbed[name] = withoutProxyRouteQueries(value);
    } else if (fullURLAttributes.includes(name)) {
      let parsed = parseURL(value);
      scrubbed[name] = pathOnly
        ? parsed
          ? `${parsed.origin}${parsed.pathname}`
          : withPathOnly(value)
        : withTokenMasked(value);
    } else if (pathAndQueryAttributes.includes(name)) {
      scrubbed[name] = pathOnly
        ? withPathOnly(value)
        : pathAndQueryWithTokenMasked(value);
    } else if (queryAttributes.includes(name)) {
      if (!pathOnly) {
        scrubbed[name] = queryAttributeWithTokenMasked(value);
      }
    } else if (fragmentAttributes.includes(name)) {
      if (!pathOnly) {
        scrubbed[name] = value;
      }
    } else {
      scrubbed[name] = withoutProxyRouteQueries(value);
    }
  }
  return scrubbed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// An outgoing request's breadcrumb records its URL under the same attribute
// names a span does.
function scrubBreadcrumbs(
  breadcrumbs: Breadcrumb[],
  methodAndPathOnly: boolean,
): Breadcrumb[] {
  return breadcrumbs.map((breadcrumb) => ({
    ...breadcrumb,
    ...(breadcrumb.message !== undefined
      ? { message: withoutProxyRouteQueries(breadcrumb.message) as string }
      : {}),
    ...(breadcrumb.data !== undefined
      ? {
          data: isPlainObject(breadcrumb.data)
            ? scrubURLAttributes(breadcrumb.data, methodAndPathOnly)
            : withoutProxyRouteQueries(breadcrumb.data),
        }
      : {}),
  }));
}

// A transaction's spans: the trace context holds the root span's data, and
// `spans` each child's.
function scrubSpans(
  event: { contexts?: TraceContexts; spans?: SpanJSON[] },
  methodAndPathOnly: boolean,
): void {
  let trace = event.contexts?.trace;
  if (trace?.data) {
    trace.data = scrubURLAttributes(trace.data, methodAndPathOnly);
  }
  if (Array.isArray(event.spans)) {
    event.spans = event.spans.map((span) =>
      span.data
        ? { ...span, data: scrubURLAttributes(span.data, methodAndPathOnly) }
        : span,
    );
  }
}

// Sentry `beforeSend` / `beforeSendTransaction` hook.
export function scrubRequestTelemetry<
  E extends {
    request?: SentryRequestData;
    breadcrumbs?: Breadcrumb[];
    contexts?: TraceContexts;
    spans?: SpanJSON[];
  },
>(event: E): E {
  let request = event.request;
  // A transaction need not carry the request: its root span records it.
  let rootSpanData = event.contexts?.trace?.data;
  let methodAndPathOnly = request
    ? keepsMethodAndPathOnly(request)
    : rootSpanData !== undefined &&
      keepsMethodAndPathOnly(spanRequest(rootSpanData));
  if (Array.isArray(event.breadcrumbs)) {
    (event as { breadcrumbs?: Breadcrumb[] }).breadcrumbs = scrubBreadcrumbs(
      event.breadcrumbs,
      methodAndPathOnly,
    );
  }
  scrubSpans(event, methodAndPathOnly);
  if (!request) {
    return event;
  }
  let parsed = parseURL(request.url);
  (event as { request?: SentryRequestData }).request = methodAndPathOnly
    ? {
        ...(request.method ? { method: request.method } : {}),
        ...(parsed ? { url: `${parsed.origin}${parsed.pathname}` } : {}),
      }
    : withoutCredentials(request);
  return event;
}
