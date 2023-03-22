import Koa from 'koa';
import cors from '@koa/cors';
import KoaBody from 'koa-body';
import proxy from 'koa-proxies';
import Router from '@koa/router';
import compose from 'koa-compose';
import { Memoize } from 'typescript-memoize';
import { Loader, Realm, baseRealm, assetsDir } from '@cardstack/runtime-common';
import { webStreamToText } from '@cardstack/runtime-common/stream';
import { setupCloseHandler } from './node-realm';
import '@cardstack/runtime-common/externals-global';
import log from 'loglevel';

const logger = log.getLogger('realm:requests');
const assetPathname = new URL(`${baseRealm.url}${assetsDir}`).pathname;
const monacoFont = 'ade705761eb7e702770d.ttf';

export interface RealmConfig {
  realmURL: string;
  path: string;
}

interface Options {
  hostLocalRealm?: boolean;
}

export class RealmServer {
  private hostLocalRealm = false;

  constructor(private realms: Realm[], opts?: Options) {
    detectRealmCollision(realms);
    this.realms = realms;
    this.hostLocalRealm = Boolean(opts?.hostLocalRealm);
  }

  @Memoize()
  get app() {
    let router = new Router();
    router.head('/', livenessCheck);
    router.get(
      '/',
      healthCheck,
      this.serveIndex({ serveLocalRealm: false }),
      this.rootRealmRedirect,
      parseBody,
      this.serveFromRealm
    );
    router.get('/local', this.serveIndex({ serveLocalRealm: true }));
    router.get(/\/local\/.*/, this.serveIndex({ serveLocalRealm: true }));

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(this.httpLogging)
      .use(ecsMetadata);

    // handle monaco...
    router.get(`/${monacoFont}`, (ctxt: Koa.Context) =>
      ctxt.redirect(
        Loader.resolve(new URL(`.${ctxt.path}`, `${baseRealm.url}${assetsDir}`))
          .href
      )
    );
    // if the base realm is not running in this server then we should proxy for monaco web worker js
    if (!this.realms.find((r) => r.url === baseRealm.url)) {
      app.use(
        compose([
          ...['editor', 'json', 'css', 'ts', 'html'].map((f) =>
            proxy(`/base/__boxel/${f}.worker.js`, {
              target: Loader.resolve(baseRealm.url).href,
              changeOrigin: true,
              rewrite: () => {
                return `/${assetsDir}${f}.worker.js`;
              },
            })
          ),
        ])
      );
    }

    app
      .use(this.assetRedirect)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, X-Requested-With',
        })
      )
      .use(
        proxy('/local/worker.js', {
          target: Loader.resolve(baseRealm.url).href,
          changeOrigin: true,
          rewrite: () => {
            return `/${assetsDir}worker.js`;
          },
          events: {
            proxyRes: (_proxyRes, _req, res) => {
              res.setHeader('Service-Worker-Allowed', '/');
            },
          },
        })
      )
      .use(this.rootRealmRedirect)
      .use(router.routes())
      .use(compose([parseBody, this.serveFromRealm]));

    return app;
  }

  listen(port: number) {
    let instance = this.app.listen(port);
    logger.info(`Realm server listening on port %s\n`, port);
    return instance;
  }

  serveIndex({
    serveLocalRealm,
  }: {
    serveLocalRealm: boolean;
  }): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
    return async (ctxt: Koa.Context, next: Koa.Next) => {
      if (ctxt.header.accept?.includes('text/html') && this.realms.length > 0) {
        ctxt.type = 'html';
        ctxt.body = await this.realms[0].getIndexHTML({
          hostLocalRealm: serveLocalRealm && this.hostLocalRealm,
          localRealmURL:
            serveLocalRealm && this.hostLocalRealm
              ? `${ctxt.URL.origin}/local/`
              : undefined,
          realmsServed: this.realms.map((r) => r.url),
        });
        return;
      }
      return next();
    };
  }

  // if the base realm is not running on this server then we should issue a
  // redirect to get the asset from the base realm
  private assetRedirect = (ctxt: Koa.Context, next: Koa.Next) => {
    if (
      ctxt.path.startsWith(assetPathname) &&
      !this.realms.find((r) => r.url === baseRealm.url)
    ) {
      let redirectURL = Loader.resolve(new URL(ctxt.path, baseRealm.url)).href;
      ctxt.redirect(redirectURL);
      return;
    }
    return next();
  };

  // requests for the root of the realm without a trailing slash aren't
  // technically inside the realm (as the realm includes the trailing '/').
  // So issue a redirect in those scenarios.
  private rootRealmRedirect = (ctxt: Koa.Context, next: Koa.Next) => {
    if (
      !ctxt.URL.href.endsWith('/') &&
      this.realms.find(
        (r) => Loader.reverseResolution(`${ctxt.URL.href}/`).href === r.url
      )
    ) {
      ctxt.redirect(`${ctxt.URL.href}/`);
      return;
    }
    return next();
  };

  private httpLogging = (ctxt: Koa.Context, next: Koa.Next) => {
    ctxt.res.on('finish', () => {
      logger.info(`${ctxt.method} ${ctxt.URL.href}: ${ctxt.status}`);
      logger.debug(JSON.stringify(ctxt.req.headers));
    });
    return next();
  };

  private serveFromRealm = async (ctxt: Koa.Context, _next: Koa.Next) => {
    let reversedResolution = Loader.reverseResolution(ctxt.URL.href);
    logger.debug(
      `Looking for realm to handle request with full URL: ${ctxt.URL.href} (reversed: ${reversedResolution.href})`
    );

    let realm = this.realms.find((r) => {
      let inRealm = r.paths.inRealm(reversedResolution);
      logger.debug(
        `${reversedResolution} in realm ${JSON.stringify({
          url: r.url,
          paths: r.paths,
        })}: ${inRealm}`
      );
      return inRealm;
    });

    if (!realm) {
      ctxt.status = 404;
      return;
    }

    let reqBody: string | undefined;
    if (['POST', 'PATCH'].includes(ctxt.method)) {
      reqBody = JSON.stringify(ctxt.request.body);
    }

    let request = new Request(reversedResolution.href, {
      method: ctxt.method,
      headers: ctxt.req.headers as { [name: string]: string },
      ...(reqBody ? { body: reqBody } : {}),
    });

    setupCloseHandler(ctxt.res, request);
    let realmResponse = await realm.handle(request);
    let { status, statusText, headers, body, nodeStream } = realmResponse;
    ctxt.status = status;
    ctxt.message = statusText;
    for (let [header, value] of headers.entries()) {
      ctxt.set(header, value);
    }
    if (!headers.get('content-type')) {
      let fileName = reversedResolution.href.split('/').pop()!;
      if (fileName.includes('.')) {
        ctxt.type = fileName.split('.').pop()!;
      } else {
        ctxt.type = 'application/vnd.api+json';
      }
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
  };
}

function detectRealmCollision(realms: Realm[]): void {
  let collisions: string[] = [];
  let realmsURLs = realms.map(({ url }) => ({
    url,
    path: new URL(url).pathname,
  }));
  for (let realmA of realmsURLs) {
    for (let realmB of realmsURLs) {
      if (realmA.path.length > realmB.path.length) {
        if (realmA.path.startsWith(realmB.path)) {
          collisions.push(`${realmA.url} collides with ${realmB.url}`);
        }
      }
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot start realm server--realm route collisions detected: ${JSON.stringify(
        collisions
      )}`
    );
  }
}

function livenessCheck(ctxt: Koa.Context, _next: Koa.Next) {
  ctxt.status = 200;
  ctxt.set('server', '@cardstack/host');
}

// Respond to AWS ELB health check
function healthCheck(ctxt: Koa.Context, next: Koa.Next) {
  if (ctxt.req.headers['user-agent']?.startsWith('ELB-HealthChecker')) {
    ctxt.body = 'OK';
    return;
  }
  return next();
}

function ecsMetadata(ctxt: Koa.Context, next: Koa.Next) {
  if (process.env['ECS_CONTAINER_METADATA_URI_V4']) {
    ctxt.set(
      'X-ECS-Container-Metadata-URI-v4',
      process.env['ECS_CONTAINER_METADATA_URI_V4']
    );
  }
  return next();
}

const parseBody = KoaBody({
  jsonLimit: '16mb',
  urlencoded: false,
  text: false,
  onError(error: Error) {
    throw new Error(`error while parsing body: ${error.message}`);
  },
});
