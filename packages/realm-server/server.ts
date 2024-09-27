import Koa from 'koa';
import cors from '@koa/cors';
import Router from '@koa/router';
import { Memoize } from 'typescript-memoize';
import {
  Realm,
  logger,
  SupportedMimeType,
  insertPermissions,
  createResponse,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  type RealmPermissions,
  Deferred,
} from '@cardstack/runtime-common';
import { ensureDirSync, writeJSONSync, readdirSync, copySync } from 'fs-extra';
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
import merge from 'lodash/merge';

import './lib/externals';
import {
  extractSupportedMimeType,
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import {
  MatrixClient,
  passwordFromSeed,
  getMatrixUsername,
} from '@cardstack/runtime-common/matrix-client';
import {
  MatrixBackendAuthentication,
  Utils,
} from '@cardstack/runtime-common/matrix-backend-authentication';
import {
  TokenExpiredError,
  JsonWebTokenError,
  sign,
  verify,
} from 'jsonwebtoken';

interface RealmServerTokenClaim {
  user: string;
}

const DEFAULT_PERMISSIONS = Object.freeze([
  'read',
  'write',
  'realm-owner',
]) as RealmPermissions['user'];

const IGNORE_SEED_FILES = [
  'node_modules',
  '.gitignore',
  '.realm.json',
  '.template-lintrc.js',
  'package.json',
  'TODO.md',
  'tsconfig.json',
];

export class RealmServer {
  private log = logger('realm-server');
  private realms: Realm[];
  private virtualNetwork: VirtualNetwork;
  private matrixClient: MatrixClient;
  private secretSeed: string;
  private realmsRootPath: string;
  private dbAdapter: DBAdapter;
  private queue: QueuePublisher;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private seedPath: string | undefined;
  private matrixRegistrationSecret: string | undefined;
  private promiseForIndexHTML: Promise<string> | undefined;
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;

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
    getRegistrationSecret,
    seedPath,
  }: {
    serverURL: URL;
    realms: Realm[];
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    secretSeed: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    seedPath?: string;
    matrixRegistrationSecret?: string;
    getRegistrationSecret?: () => Promise<string | undefined>;
  }) {
    if (!matrixRegistrationSecret && !getRegistrationSecret) {
      throw new Error(
        `'matrixRegistrationSecret' or 'getRegistrationSecret' must be specified`,
      );
    }
    detectRealmCollision(realms);
    ensureDirSync(realmsRootPath);

    this.serverURL = serverURL;
    this.virtualNetwork = virtualNetwork;
    this.matrixClient = matrixClient;
    this.secretSeed = secretSeed;
    this.realmsRootPath = realmsRootPath;
    this.seedPath = seedPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.getRegistrationSecret = getRegistrationSecret;
    this.realms = [...realms, ...this.loadRealms()];
  }

  @Memoize()
  get app() {
    let router = new Router();
    router.head('/', livenessCheck);
    router.get('/', healthCheck, this.serveIndex, this.serveFromRealm);
    router.post('/_server-session', this.createSession());
    router.post('/_create-realm', this.handleCreateRealmRequest);

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
      .use(this.serveIndex)
      .use(this.serveFromRealm);

    app.on('error', (err, ctx) => {
      console.error(`Unhandled server error`, err);
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

  async start() {
    // ideally we'd like to use a Promise.all to start these and the ordering
    // will just fall out naturally from cross realm invalidation. Until we have
    // that we should start the realms in order.
    for (let realm of this.realms) {
      await realm.start();
    }
  }

  get testingOnlyRealms() {
    return [...this.realms];
  }

  testingOnlyUnmountRealms() {
    for (let realm of this.realms) {
      this.virtualNetwork.unmount(realm.handle);
    }
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
            headers: { 'content-type': SupportedMimeType.Session },
          });
        },
        createResponse: function (
          body: BodyInit | null | undefined,
          init: ResponseInit | undefined,
        ) {
          return new Response(body, init);
        },
        createJWT: async (user: string) => this.createJWT(user),
      } as Utils,
    );

    return async (ctxt: Koa.Context, _next: Koa.Next) => {
      try {
        let request = await fetchRequestFromContext(ctxt);
        let response = await matrixBackendAuthentication.createSession(request);
        await setContextResponse(ctxt, response);
      } catch (e: any) {
        this.log.error(`Exception while creating a session on realm server`, e);
        await sendResponseForSystemError(ctxt, `${e.message}: at ${e.stack}`);
      }
    };
  }

  createJWT(userId: string): string {
    return sign({ user: userId } as RealmServerTokenClaim, this.secretSeed, {
      expiresIn: '7d',
    });
  }

  private serveIndex = async (ctxt: Koa.Context, next: Koa.Next) => {
    if (ctxt.header.accept?.includes('text/html')) {
      ctxt.type = 'html';
      ctxt.body = await this.retrieveIndexHTML();
      return;
    }
    return next();
  };

  private async retrieveIndexHTML(): Promise<string> {
    if (this.promiseForIndexHTML) {
      // This is optimized for production, in that we won't be changing index
      // HTML after we start. However, in development this might be annoying
      // because it means restarting the realm server to pick up ember-cli
      // rebuilds in the case where you want to test with the the realm server
      // specifically and not ember cli hosted app.
      return this.promiseForIndexHTML;
    }
    let deferred = new Deferred<string>();
    this.promiseForIndexHTML = deferred.promise;
    let indexHTML = (await this.getIndexHTML()).replace(
      /(<meta name="@cardstack\/host\/config\/environment" content=")([^"].*)(">)/,
      (_match, g1, g2, g3) => {
        let config = JSON.parse(decodeURIComponent(g2));
        config = merge({}, config, {
          hostsOwnAssets: false,
          assetsURL: this.assetsURL.href,
        });
        return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
      },
    );

    indexHTML = indexHTML.replace(
      /(src|href)="\//g,
      `$1="${this.assetsURL.href}`,
    );
    deferred.fulfill(indexHTML);
    return indexHTML;
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

  private handleCreateRealmRequest = async (
    ctxt: Koa.Context,
    _next: Koa.Next,
  ) => {
    let request = await fetchRequestFromContext(ctxt);

    let token: RealmServerTokenClaim;
    try {
      // Currently the only permission possible for the realm-server is the
      // permission to create a realm which is available for any matrix user,
      // as such we are only checking that the jwt is valid as opposed to
      // fetching permissions and comparing the JWT to what is configured on
      // the server. If we introduce another type of realm-server permission,
      // then we will need to compare the token with what is configured on the
      // server.
      token = this.getJwtToken(request);
    } catch (e) {
      if (e instanceof AuthenticationError) {
        await sendResponseForForbiddenRequest(ctxt, e.message);
        return;
      }
      throw e;
    }

    let { user: ownerUserId } = token;
    let body = await request.text();
    let json: Record<string, any>;
    try {
      json = JSON.parse(body);
    } catch (e) {
      await sendResponseForBadRequest(
        ctxt,
        'Request body is not valid JSON-API - invalid JSON',
      );
      return;
    }
    try {
      assertIsRealmCreationJSON(json);
    } catch (e: any) {
      await sendResponseForBadRequest(
        ctxt,
        `Request body is not valid JSON-API - ${e.message}`,
      );
      return;
    }

    let realm: Realm | undefined;
    let start = Date.now();
    let indexStart: number | undefined;
    try {
      realm = await this.createRealm({
        ownerUserId,
        ...json.data.attributes,
      });
      this.log.debug(
        `created new realm ${realm.url} in ${Date.now() - start} ms`,
      );
      this.log.debug(`indexing new realm ${realm.url}`);
      indexStart = Date.now();
      await realm.start();
    } catch (e: any) {
      if ('status' in e && e.status === 400) {
        await sendResponseForBadRequest(ctxt, e.message);
      } else {
        this.log.error(
          `Error creating realm '${json.data.attributes.name}' for user ${ownerUserId}`,
          e,
        );
        await sendResponseForSystemError(ctxt, `${e.message}: at ${e.stack}`);
      }
      return;
    } finally {
      if (realm != null && indexStart != null) {
        this.log.debug(
          `indexing of new realm ${realm.url} ended in ${
            Date.now() - indexStart
          } ms`,
        );
      }
    }

    let response = createResponse({
      body: JSON.stringify(
        {
          data: {
            type: 'realm',
            id: realm.url,
            attributes: { ...json.data.attributes },
          },
        },
        null,
        2,
      ),
      init: {
        status: 201,
        headers: {
          'content-type': SupportedMimeType.JSONAPI,
        },
      },
      requestContext: {
        realm,
        permissions: {
          [ownerUserId]: DEFAULT_PERMISSIONS,
        },
      },
    });
    await setContextResponse(ctxt, response);
    return;
  };

  private getJwtToken(request: Request) {
    let authorizationString = request.headers.get('Authorization');
    if (!authorizationString) {
      throw new AuthenticationError(
        AuthenticationErrorMessages.MissingAuthHeader,
      );
    }
    let tokenString = authorizationString.replace('Bearer ', '');
    try {
      return verify(tokenString, this.secretSeed) as RealmServerTokenClaim;
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
      }

      if (e instanceof JsonWebTokenError) {
        throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
      }
      throw e;
    }
  }

  private async createRealm({
    ownerUserId,
    endpoint,
    name,
    backgroundURL,
    iconURL,
  }: {
    ownerUserId: string; // note matrix userIDs look like "@mango:boxel.ai"
    endpoint: string;
    name: string;
    backgroundURL?: string;
    iconURL?: string;
  }): Promise<Realm> {
    if (
      this.realms.find(
        (r) => new URL(r.url).href.replace(/\/$/, '') === new URL(r.url).origin,
      )
    ) {
      throw errorWithStatus(
        400,
        `Cannot create a realm: a realm is already mounted at the origin of this server`,
      );
    }
    if (!endpoint.match(/^[a-z0-9-]+$/)) {
      throw errorWithStatus(
        400,
        `realm endpoint '${endpoint}' contains invalid characters`,
      );
    }

    let ownerUsername = getMatrixUsername(ownerUserId);
    let url = new URL(
      `${this.serverURL.pathname.replace(
        /\/$/,
        '',
      )}/${ownerUsername}/${endpoint}/`,
      this.serverURL,
    ).href;

    let existingRealmURLs = this.realms.map((r) => r.url);
    if (existingRealmURLs.includes(url)) {
      throw errorWithStatus(
        400,
        `realm '${url}' already exists on this server`,
      );
    }

    let realmPath = resolve(join(this.realmsRootPath, ownerUsername, endpoint));
    ensureDirSync(realmPath);
    let adapter = new NodeAdapter(resolve(String(realmPath)));

    let username = `realm/${ownerUsername}_${endpoint}`;
    let { userId } = await registerUser({
      matrixURL: this.matrixClient.matrixURL,
      displayname: username,
      username,
      password: await passwordFromSeed(username, this.secretSeed),
      registrationSecret: await this.getMatrixRegistrationSecret(),
    });
    this.log.debug(`created realm bot user '${userId}' for new realm ${url}`);

    await insertPermissions(this.dbAdapter, new URL(url), {
      [userId]: DEFAULT_PERMISSIONS,
      [ownerUserId]: DEFAULT_PERMISSIONS,
    });

    writeJSONSync(join(realmPath, '.realm.json'), {
      name,
      ...(iconURL ? { iconURL } : {}),
      ...(backgroundURL ? { backgroundURL } : {}),
    });
    if (this.seedPath) {
      let ignoreList = IGNORE_SEED_FILES.map((file) =>
        join(this.seedPath!.replace(/\/$/, ''), file),
      );
      copySync(this.seedPath, realmPath, {
        filter: (src, _dest) => {
          return !ignoreList.includes(src);
        },
      });
      this.log.debug(`seed files for new realm ${url} copied to ${realmPath}`);
    }

    let realm = new Realm({
      url,
      adapter,
      secretSeed: this.secretSeed,
      virtualNetwork: this.virtualNetwork,
      dbAdapter: this.dbAdapter,
      queue: this.queue,
      matrix: {
        url: this.matrixClient.matrixURL,
        username,
      },
    });
    this.realms.push(realm);
    this.virtualNetwork.mount(realm.handle);
    return realm;
  }

  // TODO consider refactoring this into main.ts after createRealm() becomes
  // private and realm creation happens as part of user creation. Then the
  // testing would likely move to the matrix client. Currently testing this
  // method is only possible by having this function in the RealmServer which is
  // within our testing boundary. main.ts is outside of our testing boundary.
  // The only real way to test thru main.ts is with a full stack, a la matrix
  // client tests.
  private loadRealms() {
    let realms: Realm[] = [];
    for (let maybeUsername of readdirSync(this.realmsRootPath, {
      withFileTypes: true,
    })) {
      if (!maybeUsername.isDirectory()) {
        continue;
      }
      let owner = maybeUsername.name;
      for (let maybeRealm of readdirSync(join(this.realmsRootPath, owner), {
        withFileTypes: true,
      })) {
        if (!maybeRealm.isDirectory()) {
          continue;
        }
        let realmName = maybeRealm.name;
        let realmPath = join(this.realmsRootPath, owner, realmName);
        let maybeRealmContents = readdirSync(realmPath);
        if (maybeRealmContents.includes('.realm.json')) {
          let url = new URL(
            `${this.serverURL.pathname.replace(
              /\/$/,
              '',
            )}/${owner}/${realmName}/`,
            this.serverURL,
          ).href;
          let adapter = new NodeAdapter(realmPath);
          let username = `realm/${owner}_${realmName}`;
          let realm = new Realm({
            url,
            adapter,
            secretSeed: this.secretSeed,
            virtualNetwork: this.virtualNetwork,
            dbAdapter: this.dbAdapter,
            queue: this.queue,
            matrix: {
              url: this.matrixClient.matrixURL,
              username,
            },
          });
          this.virtualNetwork.mount(realm.handle);
          realms.push(realm);
        }
      }
    }
    return realms;
  }

  // we use a function to get the matrix registration secret because matrix
  // client tests leverage a synapse instance that changes multiple times per
  // realm lifespan, and each new synapse instance has a unique registration
  // secret
  private async getMatrixRegistrationSecret() {
    if (this.getRegistrationSecret) {
      let secret = await this.getRegistrationSecret();
      if (!secret) {
        throw new Error(
          `the getRegistrationSecret() function returned no secret`,
        );
      }
      return secret;
    }

    if (this.matrixRegistrationSecret) {
      return this.matrixRegistrationSecret;
    }

    throw new Error(`Can not determine the matrix registration secret`);
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

interface RealmCreationJSON {
  data: {
    type: 'realm';
    attributes: {
      endpoint: string;
      name: string;
      backgroundURL?: string;
      iconURL?: string;
    };
  };
}

function errorWithStatus(
  status: number,
  message: string,
): Error & { status: number } {
  let error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error as Error & { status: number };
}

function assertIsRealmCreationJSON(
  json: any,
): asserts json is RealmCreationJSON {
  if (typeof json !== 'object') {
    throw new Error(`json must be an object`);
  }
  if (!('data' in json) || typeof json.data !== 'object') {
    throw new Error(`json is missing "data" object`);
  }
  let { data } = json;
  if (!('type' in data) || data.type !== 'realm') {
    throw new Error('json.data.type must be "realm"');
  }
  if (!('attributes' in data || typeof data.attributes !== 'object')) {
    throw new Error(`json.data is missing "attributes" object`);
  }
  let { attributes } = data;
  if (!('name' in attributes) || typeof attributes.name !== 'string') {
    throw new Error(
      `json.data.attributes.name is required and must be a string`,
    );
  }
  if (!('endpoint' in attributes) || typeof attributes.endpoint !== 'string') {
    throw new Error(
      `json.data.attributes.endpoint is required and must be a string`,
    );
  }
  if (
    'backgroundURL' in attributes &&
    typeof attributes.backgroundURL !== 'string'
  ) {
    throw new Error(`json.data.attributes.backgroundURL must be a string`);
  }
  if ('iconURL' in attributes && typeof attributes.iconURL !== 'string') {
    throw new Error(`json.data.attributes.iconURL must be a string`);
  }
}

async function sendResponseForBadRequest(ctxt: Koa.Context, message: string) {
  await sendResponseForError(ctxt, 400, 'Bad Request', message);
}

async function sendResponseForForbiddenRequest(
  ctxt: Koa.Context,
  message: string,
) {
  await sendResponseForError(ctxt, 401, 'Forbidden Request', message);
}
async function sendResponseForSystemError(ctxt: Koa.Context, message: string) {
  await sendResponseForError(ctxt, 500, 'System Error', message);
}

async function sendResponseForError(
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
