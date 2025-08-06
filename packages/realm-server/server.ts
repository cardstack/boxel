import Koa from 'koa';
import cors from '@koa/cors';
import { Memoize } from 'typescript-memoize';
import {
  Realm,
  logger,
  SupportedMimeType,
  insertPermissions,
  query,
  Deferred,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  type RealmPermissions,
} from '@cardstack/runtime-common';
import {
  ensureDirSync,
  writeJSONSync,
  readdirSync,
  existsSync,
} from 'fs-extra';
import { setupCloseHandler } from './node-realm';
import {
  httpLogging,
  ecsMetadata,
  setContextResponse,
  fetchRequestFromContext,
  methodOverrideSupport,
} from './middleware';
import { registerUser } from './synapse';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';
import convertAuthHeaderQueryParam from './middleware/convert-auth-header-qp';
import { NodeAdapter } from './node-realm';
import { resolve, join } from 'path';
import merge from 'lodash/merge';

import './lib/externals';
import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import {
  MatrixClient,
  passwordFromSeed,
  getMatrixUsername,
} from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

const DEFAULT_PERMISSIONS = Object.freeze([
  'read',
  'write',
  'realm-owner',
]) as RealmPermissions['user'];

export const PUBLISHED_DIRECTORY_NAME = '_published';

export class RealmServer {
  private log = logger('realm-server');
  private realms: Realm[];
  private virtualNetwork: VirtualNetwork;
  private matrixClient: MatrixClient;
  private realmServerSecretSeed: string;
  private realmSecretSeed: string;
  private grafanaSecret: string;
  private realmsRootPath: string;
  private dbAdapter: DBAdapter;
  private queue: QueuePublisher;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private matrixRegistrationSecret: string | undefined;
  private promiseForIndexHTML: Promise<string> | undefined;
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;
  private enableFileWatcher: boolean;

  constructor({
    serverURL,
    realms,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    grafanaSecret,
    realmsRootPath,
    dbAdapter,
    queue,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    getRegistrationSecret,
    enableFileWatcher,
  }: {
    serverURL: URL;
    realms: Realm[];
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    realmServerSecretSeed: string;
    realmSecretSeed: string;
    grafanaSecret: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    matrixRegistrationSecret?: string;
    getRegistrationSecret?: () => Promise<string | undefined>;
    enableFileWatcher?: boolean;
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
    this.realmSecretSeed = realmSecretSeed;
    this.realmServerSecretSeed = realmServerSecretSeed;
    this.grafanaSecret = grafanaSecret;
    this.realmsRootPath = realmsRootPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.getRegistrationSecret = getRegistrationSecret;
    this.enableFileWatcher = enableFileWatcher ?? false;
    this.realms = [...realms];
  }

  @Memoize()
  get app() {
    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, If-None-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Building-Index, X-Boxel-Assume-User, X-HTTP-Method-Override, X-Boxel-Disable-Module-Cache, X-Filename',
        }),
      )
      .use(async (ctx, next) => {
        // Disable browser cache for all data requests to the realm server. The condition captures our supported mime types but not others,
        // such as assets, which we probably want to cache.
        let mimeType = extractSupportedMimeType(
          ctx.header.accept as unknown as null | string | [string],
        );

        if (
          Object.values(SupportedMimeType)
            // Actually, we want to use HTTP caching for executable modules which
            // are requested with the "*/*" accept header
            .filter((m) => m !== '*/*')
            .includes(mimeType as SupportedMimeType)
        ) {
          ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        await next();
      })
      .use(convertAcceptHeaderQueryParam)
      .use(convertAuthHeaderQueryParam)
      .use(methodOverrideSupport)
      .use(
        createRoutes({
          dbAdapter: this.dbAdapter,
          serverURL: this.serverURL.href,
          matrixClient: this.matrixClient,
          realmServerSecretSeed: this.realmServerSecretSeed,
          realmSecretSeed: this.realmSecretSeed,
          grafanaSecret: this.grafanaSecret,
          virtualNetwork: this.virtualNetwork,
          createRealm: this.createRealm,
          serveIndex: this.serveIndex,
          serveFromRealm: this.serveFromRealm,
          sendEvent: this.sendEvent,
          queue: this.queue,
          realms: this.realms,
        }),
      )
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
    let loadedRealms = await this.loadRealms();
    this.realms.push(...loadedRealms);

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
          realmServerDomain: this.serverURL.hostname,
        });
        return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
      },
    );

    indexHTML = indexHTML
      .replace(/(src|href)="\//g, `$1="${this.assetsURL.href}`)
      // This is imported within a script tag vs being in an attribute
      .replace(
        '/assets/content-tag/standalone.js',
        new URL('/assets/content-tag/standalone.js', this.assetsURL.href).href,
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

  private createRealm = async ({
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
  }): Promise<Realm> => {
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
    let adapter = new NodeAdapter(
      resolve(String(realmPath)),
      this.enableFileWatcher,
    );

    let username = `realm/${ownerUsername}_${endpoint}`;
    let { userId } = await registerUser({
      matrixURL: this.matrixClient.matrixURL,
      displayname: username,
      username,
      password: await passwordFromSeed(username, this.realmSecretSeed),
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
    writeJSONSync(join(realmPath, 'index.json'), {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    });

    let realm = new Realm({
      url,
      adapter,
      secretSeed: this.realmSecretSeed,
      virtualNetwork: this.virtualNetwork,
      dbAdapter: this.dbAdapter,
      queue: this.queue,
      matrix: {
        url: this.matrixClient.matrixURL,
        username,
      },
      realmServerMatrixClient: this.matrixClient,
    });
    this.realms.push(realm);
    this.virtualNetwork.mount(realm.handle);
    return realm;
  };

  // TODO consider refactoring this into main.ts after createRealm() becomes
  // private and realm creation happens as part of user creation. Then the
  // testing would likely move to the matrix client. Currently testing this
  // method is only possible by having this function in the RealmServer which is
  // within our testing boundary. main.ts is outside of our testing boundary.
  // The only real way to test thru main.ts is with a full stack, a la matrix
  // client tests.
  private async loadRealms() {
    let realms: Realm[] = [];

    for (let maybeUsername of readdirSync(this.realmsRootPath, {
      withFileTypes: true,
    })) {
      if (!maybeUsername.isDirectory()) {
        continue;
      }
      let owner = maybeUsername.name;

      // Skip published realms, loaded later
      if (owner === PUBLISHED_DIRECTORY_NAME) {
        continue;
      }

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
          let adapter = new NodeAdapter(realmPath, this.enableFileWatcher);
          let username = `realm/${owner}_${realmName}`;
          let realm = new Realm({
            url,
            adapter,
            secretSeed: this.realmSecretSeed,
            virtualNetwork: this.virtualNetwork,
            dbAdapter: this.dbAdapter,
            queue: this.queue,
            matrix: {
              url: this.matrixClient.matrixURL,
              username,
            },
            realmServerMatrixClient: this.matrixClient,
          });
          this.virtualNetwork.mount(realm.handle);
          realms.push(realm);
        }
      }
    }

    console.log('About to find published realms');
    let publishedRealms = await this.findPublishedRealms();
    return [...realms, ...publishedRealms];
  }

  private async findPublishedRealms() {
    let realms = [];
    try {
      console.log('Loading published realms…');

      let publishedRealms = (
        await query(this.dbAdapter, [
          `SELECT * FROM published_realms ORDER BY published_realm_url`,
        ])
      ).map((row) => ({
        id: row.id as string,
        owner_username: row.owner_id as string,
        source_realm_url: row.source_realm_url as string,
        published_realm_url: row.published_realm_url as string,
      }));

      console.log(
        `Found ${publishedRealms.length} published realms in database`,
      );

      let publishedRealmsByUrl = new Map(
        publishedRealms.map((r) => [r.published_realm_url, r]),
      );

      let publishedDir = join(this.realmsRootPath, PUBLISHED_DIRECTORY_NAME);

      if (!existsSync(publishedDir)) {
        if (publishedRealms.length > 0) {
          this.log.warn(
            `Found ${publishedRealms.length} published realms in database but ${PUBLISHED_DIRECTORY_NAME} directory does not exist at ${publishedDir}`,
          );
        }

        console.log(
          `No ${PUBLISHED_DIRECTORY_NAME} directory found, skipping published realms`,
        );
        return [];
      }

      console.log(
        `Scanning ${PUBLISHED_DIRECTORY_NAME} directory: ${publishedDir}`,
      );

      let foundDirectories = new Set<string>();
      let publishedDirContents = readdirSync(publishedDir, {
        withFileTypes: true,
      });

      console.log(
        `Found ${publishedDirContents.length} items in ${PUBLISHED_DIRECTORY_NAME} directory`,
      );

      for (let maybeRealmDir of publishedDirContents) {
        if (!maybeRealmDir.isDirectory()) {
          continue;
        }

        let realmDirName = maybeRealmDir.name;
        let realmPath = join(publishedDir, realmDirName);

        try {
          let maybeRealmContents = readdirSync(realmPath);

          if (!maybeRealmContents.includes('.realm.json')) {
            this.log.warn(
              `Directory ${realmPath} exists but does not contain .realm.json, skipping`,
            );
            continue;
          }

          let matchingPublishedRealm = publishedRealms.find(
            (publishedRealmRow) => publishedRealmRow.id === realmDirName,
          );

          if (!matchingPublishedRealm) {
            this.log.warn(
              `Found directory ${realmPath} but no matching entry in published_realms table, skipping`,
            );
            continue;
          }

          let publishedRealmUrl = matchingPublishedRealm.published_realm_url;

          foundDirectories.add(publishedRealmUrl);

          let publishedRealmRow = publishedRealmsByUrl.get(publishedRealmUrl);

          if (!publishedRealmRow) {
            this.log.warn(
              `Found published realm directory at ${realmPath} but no corresponding entry in published_realms table for URL ${publishedRealmUrl}`,
            );
            continue;
          }

          let adapter = new NodeAdapter(realmPath, this.enableFileWatcher);
          let username = publishedRealmRow.owner_username;

          let realm = new Realm({
            url: publishedRealmUrl,
            adapter,
            secretSeed: this.realmSecretSeed,
            virtualNetwork: this.virtualNetwork,
            dbAdapter: this.dbAdapter,
            queue: this.queue,
            matrix: {
              url: this.matrixClient.matrixURL,
              username,
            },
            realmServerMatrixClient: this.matrixClient,
          });

          this.virtualNetwork.mount(realm.handle);
          realms.push(realm);

          console.log(
            `Loaded published realm: ${publishedRealmUrl} from ${realmPath}`,
          );
        } catch (dirError) {
          this.log.warn(
            `Error processing published realm directory ${realmPath}: ${dirError}`,
          );
        }
      }

      for (let publishedRealm of publishedRealms) {
        if (!foundDirectories.has(publishedRealm.published_realm_url)) {
          this.log.warn(
            `Published realm ${publishedRealm.published_realm_url} exists in database but no corresponding directory found in ${publishedDir}`,
          );
        }
      }

      console.log(
        `Finished loading published realms. Loaded ${realms.filter((r) => r.url.includes(PUBLISHED_DIRECTORY_NAME) || foundDirectories.has(r.url)).length} published realms.`,
      );
    } catch (error) {
      this.log.error(`Error loading published realms: ${error}`);
      if (error instanceof Error) {
        this.log.error(`Stack trace: ${error.stack}`);
      }
    }

    return realms;
  }

  private sendEvent = async (user: string, eventType: string) => {
    let dmRooms =
      (await this.matrixClient.getAccountDataFromServer<Record<string, string>>(
        'boxel.session-rooms',
      )) ?? {};
    let roomId = dmRooms[user];
    if (!roomId) {
      console.error(
        `Failed to send event: ${eventType}, cannot find session room for user: ${user}`,
      );
    }

    await this.matrixClient.sendEvent(roomId, 'm.room.message', {
      body: JSON.stringify({ eventType }),
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
    });
  };

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

function errorWithStatus(
  status: number,
  message: string,
): Error & { status: number } {
  let error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error as Error & { status: number };
}
