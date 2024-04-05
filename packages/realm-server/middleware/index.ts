import proxy from 'koa-proxies';
import {
  assetsDir,
  boxelUIAssetsDir,
  logger as getLogger,
  VirtualNetwork,
  type Realm,
} from '@cardstack/runtime-common';
import type Koa from 'koa';
import basicAuth from 'basic-auth';

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
  ctxt.res.on('finish', () => {
    logger.info(
      `${ctxt.method} ${ctxt.req.headers.accept} ${
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

// requests for the root of the realm without a trailing slash aren't
// technically inside the realm (as the realm includes the trailing '/').
// So issue a redirect in those scenarios.
export function rootRealmRedirect(
  realms: Realm[],
  virtualNetwork: VirtualNetwork,
): (ctxt: Koa.Context, next: Koa.Next) => void {
  return (ctxt: Koa.Context, next: Koa.Next) => {
    let url = fullRequestURL(ctxt);

    let realmUrlWithoutQueryParams = url.href.split('?')[0];

    if (
      !realmUrlWithoutQueryParams.endsWith('/') &&
      realms.find((realm) => {
        let mappedRealmUrl =
          virtualNetwork.resolveURLMapping(realm.url, 'virtual-to-real') ||
          realm.url;

        return `${realmUrlWithoutQueryParams}/` === mappedRealmUrl;
      })
    ) {
      url.pathname = `${url.pathname}/`;
      ctxt.redirect(`${url.href}`); // Adding a trailing slash to the URL one line above will update the href
      return;
    }
    return next();
  };
}

export function fullRequestURL(ctxt: Koa.Context): URL {
  let protocol =
    ctxt.req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return new URL(`${protocol}://${ctxt.req.headers.host}${ctxt.req.url}`);
}
