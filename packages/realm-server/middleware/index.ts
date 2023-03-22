import proxy from 'koa-proxies';
import {
  Loader,
  baseRealm,
  assetsDir,
  type Realm,
} from '@cardstack/runtime-common';
import log from 'loglevel';
import type Koa from 'koa';

const logger = log.getLogger('realm:requests');
export const assetPathname = new URL(`${baseRealm.url}${assetsDir}`).pathname;

interface ProxyOptions {
  responseHeaders?: Record<string, string>;
}

export function proxyAsset(
  from: string,
  opts?: ProxyOptions
): Koa.Middleware<Koa.DefaultState, Koa.DefaultContext> {
  let filename = from.split('/').pop()!;
  return proxy(from, {
    target: Loader.resolve(baseRealm.url).href,
    changeOrigin: true,
    rewrite: () => {
      return `/${assetsDir}${filename}`;
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
  ctxt.res.on('finish', () => {
    logger.info(`${ctxt.method} ${ctxt.URL.href}: ${ctxt.status}`);
    logger.debug(JSON.stringify(ctxt.req.headers));
  });
  return next();
}

export function ecsMetadata(ctxt: Koa.Context, next: Koa.Next) {
  if (process.env['ECS_CONTAINER_METADATA_URI_V4']) {
    ctxt.set(
      'X-ECS-Container-Metadata-URI-v4',
      process.env['ECS_CONTAINER_METADATA_URI_V4']
    );
  }
  return next();
}

// if the base realm is not running on this server then we should issue a
// redirect to get the asset from the base realm
export function assetRedirect(
  realms: Realm[]
): (ctxt: Koa.Context, next: Koa.Next) => void {
  return (ctxt: Koa.Context, next: Koa.Next) => {
    if (
      ctxt.path.startsWith(assetPathname) &&
      !realms.find((r) => r.url === baseRealm.url)
    ) {
      let redirectURL = Loader.resolve(new URL(ctxt.path, baseRealm.url)).href;
      ctxt.redirect(redirectURL);
      return;
    }
    return next();
  };
}

// requests for the root of the realm without a trailing slash aren't
// technically inside the realm (as the realm includes the trailing '/').
// So issue a redirect in those scenarios.
export function rootRealmRedirect(
  realms: Realm[]
): (ctxt: Koa.Context, next: Koa.Next) => void {
  return (ctxt: Koa.Context, next: Koa.Next) => {
    if (
      !ctxt.URL.href.endsWith('/') &&
      realms.find(
        (r) => Loader.reverseResolution(`${ctxt.URL.href}/`).href === r.url
      )
    ) {
      ctxt.redirect(`${ctxt.URL.href}/`);
      return;
    }
    return next();
  };
}
