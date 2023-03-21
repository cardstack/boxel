import Koa from 'koa';
import cors from '@koa/cors';
import { Memoize } from 'typescript-memoize';
import http, { IncomingMessage, ServerResponse } from 'http';
import { Loader, Realm, baseRealm, assetsDir } from '@cardstack/runtime-common';
import { webStreamToText } from '@cardstack/runtime-common/stream';
import { Readable } from 'stream';
import { setupCloseHandler } from './node-realm';
import '@cardstack/runtime-common/externals-global';
import log from 'loglevel';

let logger = log.getLogger('realm:requests');
let assetPathname = new URL(`${baseRealm.url}${assetsDir}`).pathname;
let monacoLanguages = ['css', 'json', 'ts', 'html'];
let monacoFonts = ['ade705761eb7e702770d.ttf'];

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
    let middlewareToRefactor = createRealmServerMiddleware(this.realms, {
      hostLocalRealm: this.hostLocalRealm,
    });
    let app = new Koa<Koa.DefaultState, Koa.Context>()
      // .use(errorMiddleware)
      // .use(
      //   cors({
      //     origin: '*',
      //     allowHeaders:
      //       'Authorization, Content-Type, If-Match, X-Requested-With',
      //   })
      // )
      // .use(httpLogging)
      .use(middlewareToRefactor);
    return app;
  }

  listen(port: number) {
    let instance = this.app.listen(port);
    logger.info(`Realm server listening on port %s\n`, port);
    return instance;
  }
}

// TODO refactor this with middleware--perhaps use KOA
export function createRealmServerMiddleware(
  realms: Realm[],
  opts?: Options
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async (ctxt: Koa.Context, next: Koa.Next) => {
    let { req, res: deprecatedRes } = ctxt;
    detectRealmCollision(realms);

    // let server = http.createServer(async (req, res) => {
    if (process.env['ECS_CONTAINER_METADATA_URI_V4']) {
      deprecatedRes.setHeader(
        'X-ECS-Container-Metadata-URI-v4',
        process.env['ECS_CONTAINER_METADATA_URI_V4']
      );
    }

    deprecatedRes.on('finish', () => {
      logger.info(`${req.method} ${req.url}: ${deprecatedRes.statusCode}`);
      logger.debug(JSON.stringify(req.headers));
    });

    try {
      if (handleCors(req, deprecatedRes)) {
        next();
        return;
      }
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }

      // Respond to AWS ELB health check
      if (requestIsHealthCheck(req)) {
        // res.statusCode = 200;
        // res.statusMessage = 'OK';
        // res.write('OK');
        ctxt.body = 'OK';
        // res.end();
        // next();
        return;
      }

      if (req.url === '/' && realms.length > 0) {
        if (req.headers.accept?.includes('text/html')) {
          // this would only be called when there is a single realm on this
          // server, in which case just use the first realm
          ctxt.type = 'html';
          ctxt.body = await realms[0].getIndexHTML();
          // res.end();
          // next();
          return;
        } else if (req.method === 'HEAD') {
          // necessary for liveness checks
          // res.writeHead(200, { server: `@cardstack/host` });
          ctxt.status = 200;
          ctxt.set('server', '@cardstack/host');
          // res.end();
          // next();
          return;
        }
      }

      let protocol =
        req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      let fullRequestUrl = new URL(
        `${protocol}://${req.headers.host}${req.url}`
      );
      if (
        (req.url === '/local' || req.url.startsWith('/local/')) &&
        opts?.hostLocalRealm &&
        realms.length > 0 &&
        req.headers.accept?.includes('text/html')
      ) {
        ctxt.type = 'html';
        ctxt.body = await realms[0].getIndexHTML({
          hostLocalRealm: true,
          localRealmURL: `${fullRequestUrl.origin}/local/`,
          realmsServed: realms.map((r) => r.url),
        });
        // res.end();
        // next();
        return;
      }
      // this one is unique in that it is requested in a manner that is relative
      // to the URL in the address bar as opposed to the absolute asset
      // location. worker can't be served out of /assets because that would
      // adversely effect the service worker scope--the service worker scope
      // is always a subset of the path the service worker js is served from.
      if (req.url === '/local/worker.js' && opts?.hostLocalRealm) {
        await proxyAsset(
          Loader.resolve(`${baseRealm.url}${assetsDir}worker.js`).href,
          deprecatedRes,
          {
            'Service-Worker-Allowed': '/',
          }
        );
        // next();
        return;
      }
      // For requests that are base realm assets and no base realm is running
      // in this server then we should redirect to the base realm--except for
      // web-worker scripts whose origin is sensitive to this server. in that
      // case we should proxy those specific scripts so we don't run afoul of
      // cross origin issues
      if (
        req.url.startsWith(assetPathname) &&
        !realms.find((r) => r.url === baseRealm.url)
      ) {
        let redirectURL = Loader.resolve(new URL(req.url, baseRealm.url)).href;
        if (
          [
            ...monacoLanguages.map((l) => `${l}.worker.js`),
            'editor.worker.js',
          ].includes(req.url.slice(assetPathname.length))
        ) {
          await proxyAsset(redirectURL, deprecatedRes);
          // next();
          return;
        }

        // res.writeHead(302, {
        //   Location: redirectURL,
        // });
        ctxt.redirect(redirectURL);
        // res.end();
        // next();
        return;
      }

      // monaco fonts are hardcoded to load from the root of the origin, this is
      // where we deal with those
      if (monacoFonts.map((f) => `/${f}`).includes(req.url)) {
        let redirectURL = Loader.resolve(
          new URL(`.${req.url}`, `${baseRealm.url}${assetsDir}`)
        ).href;
        // res.writeHead(302, {
        //   Location: redirectURL,
        // });
        ctxt.redirect(redirectURL);
        // res.end();
        // next();
        return;
      }

      // requests for the root of the realm without a trailing slash aren't
      // technically inside the realm (as the realm includes the trailing '/').
      // So issue a redirect in those scenarios.
      if (
        !fullRequestUrl.href.endsWith('/') &&
        realms.find(
          (r) =>
            Loader.reverseResolution(`${fullRequestUrl.href}/`).href === r.url
        )
      ) {
        // res.writeHead(302, { Location: `${fullRequestUrl.href}/` });
        ctxt.redirect(`${fullRequestUrl.href}/`);
        // res.end();
        // next();
        return;
      }
      let reversedResolution = Loader.reverseResolution(fullRequestUrl.href);
      logger.debug(
        `Looking for realm to handle request with full URL: ${fullRequestUrl.href} (reversed: ${reversedResolution.href})`
      );

      let realm = realms.find((r) => {
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
        // res.statusCode = 404;
        // res.statusMessage = 'Not Found';
        ctxt.status = 404;
        // res.end();
        // next();
        return;
      }

      let reqBody = await nodeStreamToText(req);

      let request = new Request(reversedResolution.href, {
        method: req.method,
        headers: req.headers as { [name: string]: string },
        ...(reqBody ? { body: reqBody } : {}),
      });

      setupCloseHandler(deprecatedRes, request);

      let { status, statusText, headers, body, nodeStream } =
        await realm.handle(request);
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
        // isStreaming = true;
        // nodeStream.pipe(res);
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
        // res.write(await webStreamToText(body));
        ctxt.body = await webStreamToText(body);
      } else if (body != null) {
        // res.write(body);
        ctxt.body = body;
      }
    } finally {
      // the node pipe takes care of ending the response for us, so we only have
      // to do this when we are not piping
      // if (!isStreaming) {
      // res.end();
      // }
    }
    // });
    // next();
  };
}

function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (
    req.method === 'OPTIONS' &&
    req.headers['access-control-request-method']
  ) {
    // preflight request
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,DELETE,PATCH');
    res.statusCode = 204;
    // res.end();
    return true;
  }
  return false;
}

async function nodeStreamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  // the types for Readable have not caught up to the fact these are async generators
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
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

function requestIsHealthCheck(req: http.IncomingMessage) {
  return (
    req.url === '/' &&
    req.method === 'GET' &&
    req.headers['user-agent']?.startsWith('ELB-HealthChecker')
  );
}

async function proxyAsset(
  url: string,
  res: ServerResponse,
  headers: Record<string, string> = {}
) {
  // TODO use Loader.fetch--that will node stream when it is local, but
  // I'm having problems getting streaming to work...
  let response = await fetch(url);
  res.setHeader('Content-Type', 'text/javascript');
  for (let [header, value] of Object.entries(headers)) {
    res.setHeader(header, value);
  }
  let workerJS = await response.text();
  // TODO we should stream this
  res.write(workerJS);
  // res.end();
}
