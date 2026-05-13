import proxy from 'koa-proxies';
import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  logger as getLogger,
  webStreamToText,
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

const REQUEST_BODY_STATE = 'requestBody';

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
  let inner = proxy(from, {
    target: assetsURL.href.replace(/$\//, ''),
    changeOrigin: true,
    rewrite: () => {
      return `/${filename}`;
    },
    events: {
      proxyReq: (proxyReq) => {
        for (let [key, value] of Object.entries(opts?.requestHeaders ?? {})) {
          proxyReq.setHeader(key, value);
        }
      },
      proxyRes: (_proxyRes, _req, res) => {
        for (let [key, value] of Object.entries(opts?.responseHeaders ?? {})) {
          res.setHeader(key, value);
        }
      },
    },
  });
  return async (ctxt, next) => {
    // HTTP/2's compat layer attaches pseudo-headers (`:method`, `:scheme`,
    // `:path`, `:authority`) to `req.headers`. http-proxy forwards every
    // header verbatim into Node's `new http.ClientRequest(...)`, which
    // throws `ERR_INVALID_HTTP_TOKEN` for any name starting with `:` —
    // every proxied h2 request becomes a 500. Shadow `req.headers` with
    // a filtered copy for the inner proxy call. Mutating the original
    // would clobber Node's internal headers map (it's the same object
    // returned by the `req.headers` getter), and `req.method` / `req.url`
    // read from that map too — so deleting `:method` / `:path` would
    // null them out and break Koa's `ctx.path` lookup.
    let original = ctxt.req.headers;
    let filtered: Record<string, string | string[] | undefined> = {};
    for (let [name, value] of Object.entries(original)) {
      if (!name.startsWith(':')) {
        filtered[name] = value;
      }
    }
    Object.defineProperty(ctxt.req, 'headers', {
      value: filtered,
      configurable: true,
      enumerable: true,
      writable: true,
    });
    try {
      return await inner(ctxt, next);
    } finally {
      // Restore the prototype getter so downstream middleware (and any
      // later request-scoped logic) sees Node's original h2 headers map.
      delete (ctxt.req as { headers?: unknown }).headers;
    }
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

  logger.info(
    `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${
      fullRequestURL(ctxt).href
    }${jobTag}`,
  );

  ctxt.res.on('finish', () => {
    logger.info(
      `--> ${ctxt.method} ${ctxt.req.headers.accept} ${
        fullRequestURL(ctxt).href
      }: ${ctxt.status}${jobTag}`,
    );
    logger.debug(JSON.stringify(ctxt.req.headers));
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
  // HTTP/2 forbids connection-specific (hop-by-hop) headers — sending any
  // of them on an h2 response causes Node's http2 compat layer to either
  // strip them silently or, worse, drop the stream mid-flight. Filter
  // them out before forwarding the realm's WHATWG Response headers to
  // Koa's response. RFC 9113 §8.2.2.
  const H2_FORBIDDEN_RESPONSE_HEADERS = new Set([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'proxy-connection',
    'http2-settings',
  ]);
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
