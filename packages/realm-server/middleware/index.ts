import proxy from 'koa-proxies';
import {
  logger as getLogger,
  ResponseWithNodeStream,
  webStreamToText,
} from '@cardstack/runtime-common';
import type Koa from 'koa';
import mime from 'mime-types';
import { nodeStreamToText } from '../stream';
import { retrieveTokenClaim } from '../utils/jwt';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
  SupportedMimeType,
} from '@cardstack/runtime-common/router';

interface ProxyOptions {
  responseHeaders?: Record<string, string>;
}

export function proxyAsset(
  from: string,
  assetsURL: URL,
  opts?: ProxyOptions,
): Koa.Middleware<Koa.DefaultState, Koa.DefaultContext> {
  let filename = from.split('/').pop()!;
  return proxy(from, {
    target: assetsURL.href.replace(/$\//, ''),
    changeOrigin: true,
    rewrite: () => {
      return `/${filename}`;
    },
    events: {
      proxyRes: (_proxyRes, _req, res) => {
        for (let [key, value] of Object.entries(opts?.responseHeaders ?? {})) {
          res.setHeader(key, value);
        }
      },
    },
  });
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

  logger.info(
    `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${
      fullRequestURL(ctxt).href
    }`,
  );

  ctxt.res.on('finish', () => {
    logger.info(
      `--> ${ctxt.method} ${ctxt.req.headers.accept} ${
        fullRequestURL(ctxt).href
      }: ${ctxt.status}`,
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

export function fullRequestURL(ctxt: Koa.Context): URL {
  let protocol =
    ctxt.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return new URL(`${protocol}://${ctxt.req.headers.host}${ctxt.req.url}`);
}

export async function fetchRequestFromContext(
  ctxt: Koa.Context,
): Promise<Request> {
  let reqBody: string | undefined;
  if (['POST', 'PATCH'].includes(ctxt.method)) {
    reqBody = await nodeStreamToText(ctxt.req);
  }

  let url = fullRequestURL(ctxt).href;
  return new Request(url, {
    method: ctxt.method,
    headers: ctxt.req.headers as { [name: string]: string },
    ...(reqBody ? { body: reqBody } : {}),
  });
}

export function jwtMiddleware(
  secretSeed: string,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    let authorization = ctxt.req.headers['authorization'];
    if (!authorization) {
      await sendResponseForForbiddenRequest(
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
        await sendResponseForForbiddenRequest(ctxt, e.message);
        return;
      }
      throw e;
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

export async function sendResponseForForbiddenRequest(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 401, 'Forbidden Request', message);
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
