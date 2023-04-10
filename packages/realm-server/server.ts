import Koa from 'koa';
import cors from '@koa/cors';
import Router from '@koa/router';
import { Memoize } from 'typescript-memoize';
import {
  Loader,
  Realm,
  baseRealm,
  assetsDir,
  logger,
} from '@cardstack/runtime-common';
import { webStreamToText } from '@cardstack/runtime-common/stream';
import { setupCloseHandler } from './node-realm';
import {
  proxyAsset,
  livenessCheck,
  healthCheck,
  httpLogging,
  ecsMetadata,
  assetRedirect,
  rootRealmRedirect,
  fullRequestURL,
} from './middleware';
import { monacoMiddleware } from './middleware/monaco';
import '@cardstack/runtime-common/externals-global';
import { nodeStreamToText } from './stream';

interface Options {
  hostLocalRealm?: boolean;
  assetsURL?: URL;
}

export class RealmServer {
  private hostLocalRealm = false;
  private assetsURL: URL;
  private logger = logger('realm:requests');

  constructor(private realms: Realm[], opts?: Options) {
    detectRealmCollision(realms);
    this.realms = realms;
    this.hostLocalRealm = Boolean(opts?.hostLocalRealm);
    // defaults to using the base realm to host assets (this is the dev env default)
    this.assetsURL =
      opts?.assetsURL ?? Loader.resolve(`${baseRealm.url}${assetsDir}`);
  }

  @Memoize()
  get app() {
    let router = new Router();
    router.head('/', livenessCheck);
    router.get(
      '/',
      healthCheck,
      this.serveIndex({ serveLocalRealm: false }),
      rootRealmRedirect(this.realms),
      this.serveFromRealm
    );
    router.get('/local', this.serveIndex({ serveLocalRealm: true }));
    router.get(/\/local\/.*/, this.serveIndex({ serveLocalRealm: true }));

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, X-Requested-With',
        })
      )
      .use(monacoMiddleware(this.assetsURL))
      .use(assetRedirect(this.assetsURL))
      .use(
        proxyAsset('/local/worker.js', this.assetsURL, {
          responseHeaders: { 'Service-Worker-Allowed': '/' },
        })
      )
      .use(rootRealmRedirect(this.realms))
      .use(router.routes())
      .use(this.serveFromRealm);

    return app;
  }

  listen(port: number) {
    let instance = this.app.listen(port);
    this.logger.info(`Realm server listening on port %s\n`, port);
    return instance;
  }

  private serveIndex({
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
              ? `${fullRequestURL(ctxt).origin}/local/`
              : undefined,
          realmsServed: this.realms.map((r) => r.url),
        });
        return;
      }
      return next();
    };
  }

  private serveFromRealm = async (ctxt: Koa.Context, _next: Koa.Next) => {
    let reversedResolution = Loader.reverseResolution(
      fullRequestURL(ctxt).href
    );
    this.logger.debug(
      `Looking for realm to handle request with full URL: ${
        fullRequestURL(ctxt).href
      } (reversed: ${reversedResolution.href})`
    );

    let realm = this.realms.find((r) => {
      let inRealm = r.paths.inRealm(reversedResolution);
      this.logger.debug(
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
      reqBody = await nodeStreamToText(ctxt.req);
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
