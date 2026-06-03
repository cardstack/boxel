import http from 'http';
import https from 'https';
import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  logger as getLogger,
  webStreamToText,
  sanitizeLoggingCorrelationId,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
} from '@cardstack/runtime-common';
import type Koa from 'koa';
import mime from 'mime-types';
import { nodeStreamToText, nodeStreamToBuffer } from '../stream';
import { retrieveTokenClaim } from '../utils/jwt';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
  SupportedMimeType,
} from '@cardstack/runtime-common/router';
import {
  PRERENDER_JOB_ID_HEADER,
  sanitizePrerenderJobId,
} from '../prerender/prerender-constants';
import {
  incrementSearchInFlight,
  decrementSearchInFlight,
} from '../search-inflight';

// Matches the realm-server's search endpoints (`/_search`,
// `/_search-prerendered`, `/_federated-search`,
// `/_federated-search-prerendered`) so the request middleware can track how
// many searches are in flight for the health sampler.
const SEARCH_PATH_PATTERN = /(^|\/)_(federated-)?search(-prerendered)?$/;

const REQUEST_BODY_STATE = 'requestBody';

// HTTP/2 forbids connection-specific (hop-by-hop) headers (RFC 9113
// §8.2.2). Sending any of them on an h2 response makes Node's http2
// compat layer either strip them silently or — worse — drop the stream
// mid-flight. We also strip them from the upstream-asset response in
// `proxyAsset` for the same reason: even when the host-dist upstream
// is plain HTTP/1.1, we re-emit its response through the realm-server's
// (potentially h2) response and the forbidden list applies there too.
const H2_FORBIDDEN_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-connection',
  'http2-settings',
]);

interface ProxyOptions {
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export function proxyAsset(
  from: string,
  assetsURL: URL,
  opts?: ProxyOptions,
): Koa.Middleware<Koa.DefaultState, Koa.DefaultContext> {
  let filename = from.split('/').pop()!;
  let upstreamPath = `${assetsURL.pathname.replace(/\/$/, '')}/${filename}`;
  let client = assetsURL.protocol === 'https:' ? https : http;
  // Direct upstream proxy. Replaces the previous koa-proxies + http-proxy
  // stack which forwarded `req.headers` verbatim into Node's
  // `http.ClientRequest`; under HTTP/2 that included pseudo-headers
  // (`:method`, `:path`, …) and tripped `ERR_INVALID_HTTP_TOKEN`. By
  // building the upstream request ourselves we choose exactly which
  // headers to forward, so the h2 / h1 callers share one code path.
  //
  // GET-only — `upstreamReq.end()` fires without a body. Add request-
  // body piping if you need to reuse this for POST/PUT/PATCH; the only
  // current caller is the host-dist asset hand-off (`/auth-service-worker.js`).
  return async (ctxt, next) => {
    if (ctxt.path !== from) {
      return next();
    }

    let forwardedHeaders: Record<string, string> = {};
    for (let [name, value] of Object.entries(ctxt.req.headers)) {
      if (name.startsWith(':')) continue;
      // Node's http.ClientRequest rejects connection-specific hop-by-hop
      // headers when targeting an HTTP/1.1 upstream.
      if (name === 'host') continue;
      if (typeof value === 'string') {
        forwardedHeaders[name] = value;
      } else if (Array.isArray(value)) {
        forwardedHeaders[name] = value.join(', ');
      }
    }
    for (let [key, value] of Object.entries(opts?.requestHeaders ?? {})) {
      forwardedHeaders[key] = value;
    }

    let upstreamRes = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        let upstreamReq = client.request(
          {
            method: ctxt.method,
            hostname: assetsURL.hostname,
            // `assetsURL.port` is the empty string for default-port URLs;
            // fall through to the protocol default.
            port: assetsURL.port || (client === https ? 443 : 80),
            path: upstreamPath,
            headers: forwardedHeaders,
          },
          resolve,
        );
        upstreamReq.on('error', reject);
        upstreamReq.end();
      },
    );

    ctxt.status = upstreamRes.statusCode ?? 502;
    for (let [name, value] of Object.entries(upstreamRes.headers)) {
      if (value == null) continue;
      // Strip hop-by-hop headers (Node manages them per-connection) plus
      // anything else the h2 response layer will reject. `host` is
      // irrelevant on the response side.
      if (H2_FORBIDDEN_RESPONSE_HEADERS.has(name.toLowerCase())) {
        continue;
      }
      ctxt.set(name, Array.isArray(value) ? value.map(String) : String(value));
    }
    for (let [key, value] of Object.entries(opts?.responseHeaders ?? {})) {
      ctxt.set(key, value);
    }
    ctxt.body = upstreamRes;
  };
}

// Add middleware to handle method override for QUERY
export function methodOverrideSupport(ctxt: Koa.Context, next: Koa.Next) {
  const methodOverride = ctxt.request.headers['x-http-method-override'];
  if (ctxt.method === 'POST' && methodOverride === 'QUERY') {
    // Change the request method to the overridden method
    // This is just for internal routing, the actual HTTP method remains POST
    Object.defineProperty(ctxt.request, 'method', {
      value: methodOverride,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return next();
}

export function livenessCheck(ctxt: Koa.Context, _next: Koa.Next) {
  ctxt.status = 200;
  ctxt.set('server', '@cardstack/host');
}

// Respond to AWS ELB health check
export function healthCheck(ctxt: Koa.Context, next: Koa.Next) {
  if (ctxt.req.headers['user-agent']?.startsWith('ELB-HealthChecker')) {
    ctxt.body = 'OK';
    return;
  }
  return next();
}

export function httpLogging(ctxt: Koa.Context, next: Koa.Next) {
  let logger = getLogger('realm:requests');
  // Stamp `[job: J.R]` onto the request log lines when the upstream
  // caller (typically the worker indexing pipeline) supplied an
  // `x-boxel-job-id` header. Lets a single substring filter pull
  // realm-server lines for an indexing job alongside worker lines.
  let jobId = sanitizePrerenderJobId(ctxt.get(PRERENDER_JOB_ID_HEADER));
  let jobTag = jobId ? ` [job: ${jobId}]` : '';
  // Correlation id minted by the client; echoed onto both request log
  // lines (and into the response header) so a client-observed slow search
  // joins to the realm-server's view of the same request. The matching
  // `realm:search-timing` line (emitted by `searchRealms`) is keyed by the
  // same value.
  let loggingCorrelationId = sanitizeLoggingCorrelationId(
    ctxt.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER),
  );
  let corrTag = loggingCorrelationId ? ` corr=${loggingCorrelationId}` : '';
  if (loggingCorrelationId) {
    ctxt.set(X_BOXEL_LOGGING_CORRELATION_ID_HEADER, loggingCorrelationId);
  }
  let startedAt = Date.now();

  // Track in-flight search load for the health sampler across the request's
  // full lifecycle (queue → parse → SQL → serialize → send), which is the
  // window during which a saturated event loop would leave it unserviced.
  let isSearch = SEARCH_PATH_PATTERN.test(ctxt.path);
  let releasedInFlight = false;
  let releaseInFlight = () => {
    if (releasedInFlight) {
      return;
    }
    releasedInFlight = true;
    decrementSearchInFlight();
  };
  if (isSearch) {
    incrementSearchInFlight();
  }

  logger.info(
    `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${
      fullRequestURL(ctxt).href
    }${jobTag}${corrTag}`,
  );

  let onSettled = () => {
    if (isSearch) {
      releaseInFlight();
    }
    logger.info(
      `--> ${ctxt.method} ${ctxt.req.headers.accept} ${
        fullRequestURL(ctxt).href
      }: ${ctxt.status}${jobTag}${corrTag} dur=${Date.now() - startedAt}ms`,
    );
    logger.debug(JSON.stringify(ctxt.req.headers));
  };
  // `finish` fires on a fully-sent response; `close` covers a connection
  // torn down before that (so the in-flight count can't leak on aborts).
  ctxt.res.on('finish', onSettled);
  ctxt.res.on('close', () => {
    if (isSearch) {
      releaseInFlight();
    }
  });
  return next();
}

export function ecsMetadata(ctxt: Koa.Context, next: Koa.Next) {
  if (process.env['ECS_CONTAINER_METADATA_URI_V4']) {
    ctxt.set(
      'X-ECS-Container-Metadata-URI-v4',
      process.env['ECS_CONTAINER_METADATA_URI_V4'],
    );
  }
  return next();
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}

export function fullRequestURL(ctxt: Koa.Context): URL {
  // Three protocol signals, checked in order:
  //   1. `x-forwarded-proto: https` — set by a TLS-terminating proxy in front
  //      of us (ALB, Traefik, etc.). Trust it ahead of the socket check because
  //      the proxy may have negotiated TLS even when our socket is plain HTTP.
  //   2. The TLS socket flag — set when we terminate TLS ourselves (the local
  //      dev HTTPS/h2 listener). `tls.TLSSocket#encrypted` is true here; plain
  //      http.IncomingMessage sockets do not have the property.
  //   3. Default to http.
  let socket = ctxt.req.socket as { encrypted?: boolean } | undefined;
  let protocol =
    ctxt.req.headers['x-forwarded-proto'] === 'https' || socket?.encrypted
      ? 'https'
      : 'http';
  // HTTP/2 carries the authority in the `:authority` pseudo-header rather
  // than the legacy `Host` header. Node's http2 compat layer normally
  // populates `headers.host` from `:authority`, but only when the value
  // is set; falling back to `:authority` makes URL construction robust to
  // h2 clients (and proxies) that may omit `host`.
  let h2Headers = ctxt.req.headers as Record<string, string | undefined>;
  let host =
    typeof h2Headers.host === 'string' && h2Headers.host
      ? h2Headers.host
      : (h2Headers[':authority'] ?? '');
  let computedURL = new URL(`${protocol}://${host}${ctxt.req.url}`);
  let forwardedURL = ctxt.req.headers['x-boxel-forwarded-url'];
  if (
    process.env.BOXEL_TRUST_FORWARDED_URL === 'true' &&
    typeof forwardedURL === 'string' &&
    forwardedURL.trim() !== '' &&
    isLoopbackAddress(ctxt.req.socket?.remoteAddress)
  ) {
    try {
      let parsed = new URL(forwardedURL);
      if (
        parsed.pathname === computedURL.pathname &&
        parsed.search === computedURL.search
      ) {
        return parsed;
      }
    } catch {
      // Ignore malformed forwarded URLs and fall back to the computed request.
    }
  }
  return computedURL;
}

export async function fetchRequestFromContext(
  ctxt: Koa.Context,
): Promise<Request> {
  let reqBody: string | Buffer | undefined;
  if (['POST', 'PATCH', 'PUT', 'QUERY', 'DELETE'].includes(ctxt.method)) {
    let state = ctxt.state as Record<string, unknown>;
    if (REQUEST_BODY_STATE in state) {
      reqBody = state[REQUEST_BODY_STATE] as string | Buffer;
    } else {
      let isBinary =
        ctxt.req.headers['content-type'] === 'application/octet-stream';
      reqBody = isBinary
        ? await nodeStreamToBuffer(ctxt.req)
        : await nodeStreamToText(ctxt.req);
      state[REQUEST_BODY_STATE] = reqBody;
    }
  }

  let url = fullRequestURL(ctxt).href;
  // HTTP/2's compat layer presents pseudo-headers (`:method`, `:scheme`,
  // `:path`, `:authority`) alongside the regular headers. WHATWG `Headers`
  // rejects names starting with `:` as invalid, so the raw `ctxt.req.headers`
  // object cannot be passed to `new Request()` on h2 requests. Strip the
  // pseudo-headers — the URL and method are already extracted above, and
  // `:authority` is folded back into `host` by `fullRequestURL`.
  let headers: Record<string, string> = {};
  for (let [name, value] of Object.entries(ctxt.req.headers)) {
    if (name.startsWith(':')) continue;
    if (typeof value === 'string') {
      headers[name] = value;
    } else if (Array.isArray(value)) {
      headers[name] = value.join(', ');
    }
  }
  return new Request(url, {
    method: ctxt.method,
    headers,
    ...(reqBody !== undefined ? { body: reqBody as BodyInit } : {}),
  });
}

export function jwtMiddleware(
  secretSeed: string,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let authorization = ctxt.req.headers['authorization'];
    if (!authorization) {
      await sendResponseForUnauthorizedRequest(
        ctxt,
        AuthenticationErrorMessages.MissingAuthHeader,
      );
      return;
    }

    try {
      // Currently the only permission possible for the realm-server is the
      // permission to create a realm which is available for any matrix user,
      // as such we are only checking that the jwt is valid as opposed to
      // fetching permissions and comparing the JWT to what is configured on
      // the server. If we introduce another type of realm-server permission,
      // then we will need to compare the token with what is configured on the
      // server.
      ctxt.state.token = retrieveTokenClaim(authorization, secretSeed);
    } catch (e) {
      if (e instanceof AuthenticationError) {
        await sendResponseForUnauthorizedRequest(ctxt, e.message);
        return;
      }
      throw e;
    }

    await next();
  };
}

export function grafanaAuthorization(
  grafanaSecret: string,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let authorization = ctxt.req.headers['authorization'];
    if (!authorization) {
      await sendResponseForUnauthorizedRequest(
        ctxt,
        AuthenticationErrorMessages.MissingAuthHeader,
      );
      return;
    }
    // RFC 6750: scheme name is case-insensitive and any 1+ whitespace
    // separator is allowed. Match only the first whitespace run so a
    // secret that itself contains whitespace stays intact in the
    // captured token (a greedy /\s+/ split would false-reject those).
    let bearerMatch = authorization.trim().match(/^bearer\s+(.+)$/i);
    if (!bearerMatch || bearerMatch[1] !== grafanaSecret) {
      await sendResponseForUnauthorizedRequest(
        ctxt,
        AuthenticationErrorMessages.TokenInvalid,
      );
      return;
    }
    await next();
  };
}

export async function sendResponseForBadRequest(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 400, 'Bad Request', message);
}

export async function sendResponseForUnprocessableEntity(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 422, 'Unprocessable Entity', message);
}

export async function sendResponseForNotFound(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 404, 'Not Found', message);
}

export async function sendResponseForForbiddenRequest(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 403, 'Forbidden Request', message);
}

export async function sendResponseForUnauthorizedRequest(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 401, 'Unauthorized Request', message);
}

export async function sendResponseForSystemError(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 500, 'System Error', message);
}

export async function sendResponseForError(
  ctxt: Koa.Context,
  status: number,
  statusText: string,
  message: string,
) {
  await setContextResponse(
    ctxt,
    new Response(
      JSON.stringify({
        errors: [message],
      }),
      {
        status,
        statusText,
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
    ),
  );
}

export async function setContextResponse(
  ctxt: Koa.Context,
  response: ResponseWithNodeStream,
) {
  let url = fullRequestURL(ctxt).href;

  let { status, statusText, headers, body, nodeStream } = response;
  ctxt.status = status;
  ctxt.message = statusText;
  for (let [header, value] of headers.entries()) {
    if (H2_FORBIDDEN_RESPONSE_HEADERS.has(header.toLowerCase())) continue;
    ctxt.set(header, value);
  }
  if (!headers.get('content-type')) {
    let fileName = url.split('/').pop()!;
    ctxt.type = mime.lookup(fileName) || 'application/octet-stream';
  }

  if (nodeStream) {
    ctxt.body = nodeStream;
  } else if (body instanceof ReadableStream) {
    // A quirk with native fetch Response in node is that it will be clever
    // and convert strings or buffers in the response.body into web-streams
    // automatically. This is not to be confused with actual file streams
    // that the Realm is creating. The node HTTP server does not play nice
    // with web-streams, so we will read these streams back into strings and
    // then include in our node ServerResponse. Actual node file streams
    // (i.e streams that we are intentionally creating in the Realm) will
    // not be handled here--those will be taken care of above.
    ctxt.body = await webStreamToText(body);
  } else if (body != null) {
    ctxt.body = body;
  }
}
