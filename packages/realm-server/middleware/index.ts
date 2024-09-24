import proxy from 'koa-proxies';
import {
  logger as getLogger,
  ResponseWithNodeStream,
  webStreamToText,
} from '@cardstack/runtime-common';
import type Koa from 'koa';
import basicAuth from 'basic-auth';
import mime from 'mime-types';
import { nodeStreamToText } from '../stream';

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

const BASIC_AUTH_USERNAME = 'cardstack';

export function httpBasicAuth(ctxt: Koa.Context, next: Koa.Next) {
  if (
    process.env['BOXEL_HTTP_BASIC_PW'] &&
    ctxt.header.accept?.includes('text/html')
  ) {
    let credentials = basicAuth(ctxt.request as any);
    if (
      !credentials ||
      credentials.name !== BASIC_AUTH_USERNAME ||
      credentials.pass !== process.env['BOXEL_HTTP_BASIC_PW']
    ) {
      ctxt.type = 'html';
      ctxt.status = 401;
      ctxt.body = 'Authorization Required';
      ctxt.set('WWW-Authenticate', 'Basic realm="Boxel realm server"');
      return;
    }
  }
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
