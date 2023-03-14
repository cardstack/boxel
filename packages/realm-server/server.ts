import http, { IncomingMessage, ServerResponse } from 'http';
import { Loader, Realm, baseRealm, assetsDir } from '@cardstack/runtime-common';
import { webStreamToText } from '@cardstack/runtime-common/stream';
import { Readable } from 'stream';
import { setupCloseHandler } from './node-realm';
import '@cardstack/runtime-common/externals-global';
import log from 'loglevel';

let requestLog = log.getLogger('realm:requests');
let assetPathname = new URL(`${baseRealm.url}${assetsDir}`).pathname;
let monacoLanguages = ['css', 'json', 'ts', 'html'];

export interface RealmConfig {
  realmURL: string;
  path: string;
}

interface Options {
  hostLocalRealm?: boolean;
}
// TODO refactor this with middleware--perhaps use KOA
export function createRealmServer(realms: Realm[], opts?: Options) {
  detectRealmCollision(realms);

  let server = http.createServer(async (req, res) => {
    if (process.env['ECS_CONTAINER_METADATA_URI_V4']) {
      res.setHeader(
        'X-ECS-Container-Metadata-URI-v4',
        process.env['ECS_CONTAINER_METADATA_URI_V4']
      );
    }

    res.on('finish', () => {
      requestLog.info(`${req.method} ${req.url}: ${res.statusCode}`);
      requestLog.debug(JSON.stringify(req.headers));
    });

    let isStreaming = false;
    try {
      if (handleCors(req, res)) {
        return;
      }
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }

      // Respond to AWS ELB health check
      if (requestIsHealthCheck(req)) {
        res.statusCode = 200;
        res.statusMessage = 'OK';
        res.write('OK');
        res.end();
        return;
      }

      if (req.url === '/' && realms.length > 0) {
        if (req.headers.accept?.includes('text/html')) {
          // this would only be called when there is a single realm on this
          // server, in which case just use the first realm
          res.setHeader('Content-Type', 'text/html');
          res.write(await realms[0].getIndexHTML());
          res.end();
          return;
        } else if (req.method === 'HEAD') {
          // necessary for liveness checks
          res.writeHead(200, { server: `@cardstack/host` });
          res.end();
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
        res.setHeader('Content-Type', 'text/html');
        res.write(
          await realms[0].getIndexHTML({
            hostLocalRealm: true,
            localRealmURL: `${fullRequestUrl.origin}/local/`,
            realmsServed: realms.map((r) => r.url),
          })
        );
        res.end();
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
          res,
          {
            'Service-Worker-Allowed': '/',
          }
        );
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
          await proxyAsset(redirectURL, res);
          return;
        }
        res.writeHead(302, {
          Location: redirectURL,
        });
        res.end();
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
        res.writeHead(302, { Location: `${fullRequestUrl.href}/` });
        res.end();
        return;
      }
      let reversedResolution = Loader.reverseResolution(fullRequestUrl.href);
      requestLog.debug(
        `Looking for realm to handle request with full URL: ${fullRequestUrl.href} (reversed: ${reversedResolution.href})`
      );

      let realm = realms.find((r) => {
        let inRealm = r.paths.inRealm(reversedResolution);
        requestLog.debug(
          `${reversedResolution} in realm ${JSON.stringify({
            url: r.url,
            paths: r.paths,
          })}: ${inRealm}`
        );
        return inRealm;
      });

      if (!realm) {
        res.statusCode = 404;
        res.statusMessage = 'Not Found';
        res.end();
        return;
      }

      let reqBody = await nodeStreamToText(req);

      let request = new Request(reversedResolution.href, {
        method: req.method,
        headers: req.headers as { [name: string]: string },
        ...(reqBody ? { body: reqBody } : {}),
      });

      setupCloseHandler(res, request);

      let { status, statusText, headers, body, nodeStream } =
        await realm.handle(request);
      res.statusCode = status;
      res.statusMessage = statusText;
      for (let [header, value] of headers.entries()) {
        res.setHeader(header, value);
      }

      if (nodeStream) {
        isStreaming = true;
        nodeStream.pipe(res);
      } else if (body instanceof ReadableStream) {
        // A quirk with native fetch Response in node is that it will be clever
        // and convert strings or buffers in the response.body into web-streams
        // automatically. This is not to be confused with actual file streams
        // that the Realm is creating. The node HTTP server does not play nice
        // with web-streams, so we will read these streams back into strings and
        // then include in our node ServerResponse. Actual node file streams
        // (i.e streams that we are intentionally creating in the Realm) will
        // not be handled here--those will be taken care of above.
        res.write(await webStreamToText(body));
      } else if (body != null) {
        res.write(body);
      }
    } finally {
      // the node pipe takes care of ending the response for us, so we only have
      // to do this when we are not piping
      if (!isStreaming) {
        res.end();
      }
    }
  });
  return server;
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
    res.end();
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
  res.end();
}
