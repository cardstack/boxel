// Keeps what is sent to the secure origin out of Sentry. Sentry's HTTP
// instrumentation records the body of every incoming request a handler reads,
// along with its headers, cookies and query string, and attaches them to any
// event raised while that request is in flight. The secure origin is where
// credentials are typed, so an event raised there must leave all of that out.
//
// Kept free of imports so `instrument.ts`, which runs before anything else,
// can install it.

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

// Sentry `beforeSend` / `beforeSendTransaction` hook. An event raised while a
// secure-origin request was in flight keeps only its method and the URL's
// path; the body, headers, cookies and query string are dropped.
export function scrubSecureOriginEvent<
  E extends { request?: SentryRequestData },
>(event: E): E {
  let request = event.request;
  if (!request || !isSecureOriginRequestData(request)) {
    return event;
  }
  let url: string | undefined;
  if (request.url) {
    try {
      let parsed = new URL(request.url);
      url = `${parsed.origin}${parsed.pathname}`;
    } catch {
      url = undefined;
    }
  }
  (event as { request?: SentryRequestData }).request = {
    ...(request.method ? { method: request.method } : {}),
    ...(url ? { url } : {}),
  };
  return event;
}
