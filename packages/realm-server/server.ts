import Koa from 'koa';
import cors from '@koa/cors';
import Router from '@koa/router';
import { Memoize } from 'typescript-memoize';
import {
  Realm,
  logger,
  SupportedMimeType,
  insertPermissions,
  type VirtualNetwork,
  type DBAdapter,
  type Queue,
} from '@cardstack/runtime-common';
import { ensureDirSync, writeJSONSync, readFileSync } from 'fs-extra';
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
import { registerUser } from './synapse';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';
import { NodeAdapter } from './node-realm';
import { resolve, join } from 'path';

import './lib/externals';
import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import {
  MatrixClient,
  passwordFromSeed,
} from '@cardstack/runtime-common/matrix-client';
import {
  MatrixBackendAuthentication,
  Utils,
} from '@cardstack/runtime-common/matrix-backend-authentication';
import jwt from 'jsonwebtoken';
import { existsSync } from 'fs';

export class RealmServer {
  private log = logger('realm:requests');
  private realms: Realm[];
  private virtualNetwork: VirtualNetwork;
  private matrixClient: MatrixClient;
  private secretSeed: string;
  private realmsRootPath: string;
  private dbAdapter: DBAdapter;
  private queue: Queue;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private matrixRegistrationSecret: string | undefined;
  private matrixRegistrationSecretFile: string | undefined;

  constructor({
    serverURL,
    realms,
    virtualNetwork,
    matrixClient,
    secretSeed,
    realmsRootPath,
    dbAdapter,
    queue,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    matrixRegistrationSecretFile,
  }: {
    serverURL: URL;
    realms: Realm[];
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    secretSeed: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: Queue;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    matrixRegistrationSecret?: string;
    matrixRegistrationSecretFile?: string;
  }) {
    detectRealmCollision(realms);

    if (!matrixRegistrationSecret && !matrixRegistrationSecretFile) {
      throw new Error(
        `'matrixRegistrationSecret' or 'matrixRegistrationSecretFile' must be specified`,
      );
    }

    this.serverURL = serverURL;
    this.realms = realms;
    this.virtualNetwork = virtualNetwork;
    this.matrixClient = matrixClient;
    this.secretSeed = secretSeed;
    this.realmsRootPath = realmsRootPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.matrixRegistrationSecretFile = matrixRegistrationSecretFile;
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
            'Authorization, Content-Type, If-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Building-Index',
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

  // TODO make this method private after we have provided an HTTP interface for
  // this capability
  async createRealm(
    ownerUserId: string, // note matrix userIDs look like "@mango:boxel.ai"
    realmName: string,
  ): Promise<Realm> {
    if (
      this.realms.find(
        (r) => new URL(r.url).href.replace(/\/$/, '') === new URL(r.url).origin,
      )
    ) {
      throw new Error(
        `Cannot create a realm: a realm is already mounted at the origin of this server`,
      );
    }
    if (!realmName.match(/^[a-z0-9-]+$/)) {
      throw new Error(`realm name '${realmName}' contains invalid characters`);
    }

    let ownerUsername = ownerUserId.replace(/^@/, '').replace(/:.*$/, '');
    let url = new URL(
      `${this.serverURL.pathname.replace(
        /\/$/,
        '',
      )}/${ownerUsername}/${realmName}/`,
      this.serverURL,
    ).href;

    let existingRealmURLs = this.realms.map((r) => r.url);
    if (existingRealmURLs.includes(url)) {
      throw new Error(`realm '${url}' already exists on this server`);
    }

    let realmPath = resolve(
      join(this.realmsRootPath, ownerUsername, realmName),
    );
    ensureDirSync(realmPath);
    let adapter = new NodeAdapter(resolve(String(realmPath)));

    let username = `realm/${ownerUsername}_${realmName}`;
    await registerUser({
      matrixURL: this.matrixClient.matrixURL,
      displayname: username,
      username,
      password: await passwordFromSeed(username, this.secretSeed),
      registrationSecret: this.getMatrixRegistrationSecret(),
    });

    await insertPermissions(this.dbAdapter, new URL(url), {
      // TODO confirm that we store matrix userID's in this table and not usernames
      [ownerUserId]: ['read', 'write', 'realm-owner'],
    });

    writeJSONSync(join(realmPath, '.realm.json'), { name: realmName });

    let realm = new Realm({
      url,
      adapter,
      getIndexHTML: this.getIndexHTML,
      secretSeed: this.secretSeed,
      virtualNetwork: this.virtualNetwork,
      dbAdapter: this.dbAdapter,
      queue: this.queue,
      assetsURL: this.assetsURL,
      matrix: {
        url: this.matrixClient.matrixURL,
        username,
      },
    });
    this.realms.push(realm);
    this.virtualNetwork.mount(realm.handle);
    return realm;
  }

  private getMatrixRegistrationSecret() {
    if (
      this.matrixRegistrationSecretFile &&
      existsSync(this.matrixRegistrationSecretFile)
    ) {
      let secret = readFileSync(this.matrixRegistrationSecretFile, 'utf8');
      if (!secret) {
        throw new Error(
          `The matrix registration secret file '${this.matrixRegistrationSecretFile}' is empty`,
        );
      }
      return secret;
    }

    if (this.matrixRegistrationSecret) {
      return this.matrixRegistrationSecret;
    }

    throw new Error('Can not determine the matrix registration secret');
  }
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
