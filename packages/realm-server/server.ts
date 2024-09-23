import Koa from 'koa';
import cors from '@koa/cors';
import Router from '@koa/router';
import { Memoize } from 'typescript-memoize';
import {
  logger,
  SupportedMimeType,
  insertPermissions,
  createResponse,
  type VirtualNetwork,
  type DBAdapter,
  type Queue,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';

import {
  ensureDirSync,
  writeJSONSync,
  readFileSync,
  existsSync,
  readdirSync,
  copySync,
} from 'fs-extra';
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
import {
  extractSupportedMimeType,
  AuthenticationError,
  AuthenticationErrorMessages,
} from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import {
  MatrixClient,
  passwordFromSeed,
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
  private seedPath: string | undefined;
  private matrixRegistrationSecret: string | undefined;
  private matrixRegistrationSecretFile: string | undefined;
  private onRealmCreate: ((realm: Realm) => void) | undefined;

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
    seedPath,
    onRealmStart,
    onRealmCreate,
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
    seedPath?: string;
    matrixRegistrationSecret?: string;
    matrixRegistrationSecretFile?: string;
    // these are a special callbacks for our tests that allows the test worker
    // to mount the realm in its private network
    onRealmStart?: (realm: Realm) => void;
    onRealmCreate?: (realm: Realm) => void;
  }) {
    if (!matrixRegistrationSecret && !matrixRegistrationSecretFile) {
      throw new Error(
        `'matrixRegistrationSecret' or 'matrixRegistrationSecretFile' must be specified`,
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
    this.matrixRegistrationSecretFile = matrixRegistrationSecretFile;
    this.onRealmCreate = onRealmCreate;
    this.realms = [...realms, ...this.loadRealms()];

    if (onRealmStart) {
      for (let realm of this.realms) {
        onRealmStart(realm);
      }
    }
  }

  @Memoize()
  get app() {
    let router = new Router();
    router.head('/', livenessCheck);
    router.get('/', healthCheck, this.serveIndex(), this.serveFromRealm);
    router.post('/_server-session', this.createSession());
    router.post('/_create-realm', this.handleCreateRealmRequest());

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
      let request = await fetchRequestFromContext(ctxt);
      let response = await matrixBackendAuthentication.createSession(request);
      await setContextResponse(ctxt, response);
    };
  }

  createJWT(userId: string): string {
    return sign({ user: userId } as RealmServerTokenClaim, this.secretSeed, {
      expiresIn: '7d',
    });
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

  private handleCreateRealmRequest(): (
    ctxt: Koa.Context,
    next: Koa.Next,
  ) => Promise<void> {
    return async (ctxt: Koa.Context, _next: Koa.Next) => {
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

      let realmName = json.data.attributes.name;
      let realm: Realm;
      try {
        realm = await this.createRealm(ownerUserId, realmName);
        if (this.onRealmCreate) {
          this.onRealmCreate(realm);
        }
        await realm.start();
      } catch (e: any) {
        if ('status' in e && e.status === 400) {
          await sendResponseForBadRequest(ctxt, e.message);
        } else {
          await sendResponseForSystemError(ctxt, `${e.message}: at ${e.stack}`);
        }
        return;
      }

      let response = createResponse({
        body: JSON.stringify(
          {
            data: {
              type: 'realm',
              id: realm.url,
              attributes: {
                name: realmName,
              },
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
  }

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

  private async createRealm(
    ownerUserId: string, // note matrix userIDs look like "@mango:boxel.ai"
    realmName: string,
  ): Promise<Realm> {
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
    if (!realmName.match(/^[a-z0-9-]+$/)) {
      throw errorWithStatus(
        400,
        `realm name '${realmName}' contains invalid characters`,
      );
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
      throw errorWithStatus(
        400,
        `realm '${url}' already exists on this server`,
      );
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
      [ownerUserId]: DEFAULT_PERMISSIONS,
    });

    writeJSONSync(join(realmPath, '.realm.json'), { name: realmName });
    if (this.seedPath) {
      let ignoreList = IGNORE_SEED_FILES.map((file) =>
        join(this.seedPath!.replace(/\/$/, ''), file),
      );
      copySync(this.seedPath, realmPath, {
        filter: (src, _dest) => {
          return !ignoreList.includes(src);
        },
      });
    }

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

interface RealmCreationJSON {
  data: {
    type: 'realm';
    attributes: {
      name: string;
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
    throw new Error(`json.data.attributes.name must be a string`);
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
