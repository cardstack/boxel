import Koa from 'koa';
import cors from '@koa/cors';
import Router from '@koa/router';
import { Memoize } from 'typescript-memoize';
import {
  Realm,
  logger,
  SupportedMimeType,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { setupCloseHandler } from './node-realm';
import {
  livenessCheck,
  healthCheck,
  httpLogging,
  httpBasicAuth,
  ecsMetadata,
  setContextResponse,
  fetchRequestFromContext,
} from './middleware';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';

import './lib/externals';
import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  MatrixBackendAuthentication,
  Utils,
} from '@cardstack/runtime-common/matrix-backend-authentication';
import jwt from 'jsonwebtoken';

export class RealmServer {
  private log = logger('realm:requests');

  constructor(
    private realms: Realm[],
    private virtualNetwork: VirtualNetwork,
    private matrixClient: MatrixClient,
    private secretSeed: string,
  ) {
    detectRealmCollision(realms);
    this.realms = realms;
  }

  @Memoize()
  get app() {
    let router = new Router();
    router.head('/', livenessCheck);
    router.get('/', healthCheck, this.serveIndex(), this.serveFromRealm);
    router.post('/_server-session', this.createSession());

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Use-WIP-Index',
        }),
      )
      .use(async (ctx, next) => {
        // Disable browser cache for all data requests to the realm server. The condition captures our supported mime types but not others,
        // such as assets, which we probably want to cache.
        let mimeType = extractSupportedMimeType(
          ctx.header.accept as unknown as null | string | [string],
        );

        if (
          Object.values(SupportedMimeType).includes(
            mimeType as SupportedMimeType,
          )
        ) {
          ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        await next();
      })
      .use(convertAcceptHeaderQueryParam)
      .use(httpBasicAuth)
      .use(router.routes())
      .use(this.serveFromRealm);

    app.on('error', (err, ctx) => {
      Sentry.withScope((scope) => {
        scope.setSDKProcessingMetadata({ request: ctx.request });
        Sentry.captureException(err);
      });
    });

    return app;
  }

  listen(port: number) {
    let instance = this.app.listen(port);
    this.log.info(`Realm server listening on port %s\n`, port);
    return instance;
  }

  private createSession(): (
    ctxt: Koa.Context,
    next: Koa.Next,
  ) => Promise<void> {
    let matrixBackendAuthentication = new MatrixBackendAuthentication(
      this.matrixClient,
      this.secretSeed,
      {
        badRequest: function (message: string) {
          return new Response(JSON.stringify({ errors: message }), {
            status: 400,
            statusText: 'Bad Request',
          });
        },
        createResponse: function (
          body: BodyInit | null | undefined,
          init: ResponseInit | undefined,
        ) {
          return new Response(body, init);
        },
        createJWT: async (user: string) => {
          return jwt.sign({ user }, this.secretSeed, { expiresIn: '7d' });
        },
      } as Utils,
    );

    return async (ctxt: Koa.Context, _next: Koa.Next) => {
      let request = await fetchRequestFromContext(ctxt);
      let response = await matrixBackendAuthentication.createSession(request);
      await setContextResponse(ctxt, response);
    };
  }

  private serveIndex(): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
    return async (ctxt: Koa.Context, next: Koa.Next) => {
      if (ctxt.header.accept?.includes('text/html') && this.realms.length > 0) {
        ctxt.type = 'html';
        ctxt.body = await this.realms[0].getIndexHTML({
          realmsServed: this.realms.map((r) => r.url),
        });
        return;
      }
      return next();
    };
  }

  private serveFromRealm = async (ctxt: Koa.Context, _next: Koa.Next) => {
    if (ctxt.request.path === '/_boom') {
      throw new Error('boom');
    }
    let request = await fetchRequestFromContext(ctxt);
    let realmResponse = await this.virtualNetwork.handle(
      request,
      (mappedRequest) => {
        // Setup this handler only after the request has been mapped because
        // the *mapped request* is the one that gets closed, not the original one
        setupCloseHandler(ctxt.res, mappedRequest);
      },
    );

    await setContextResponse(ctxt, realmResponse);
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
        collisions,
      )}`,
    );
  }
}
