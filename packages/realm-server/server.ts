import Koa from 'koa';
import cors from '@koa/cors';
import { Memoize } from 'typescript-memoize';
import type { DefinitionLookup, Realm } from '@cardstack/runtime-common';
import {
  logger,
  SupportedMimeType,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
} from '@cardstack/runtime-common';
import { ensureDirSync } from 'fs-extra';
import {
  httpLogging,
  ecsMetadata,
  methodOverrideSupport,
  proxyAsset,
} from './middleware';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';

import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes';
import { createSendEvent } from './handlers/send-event';
import { createServeFromRealm } from './handlers/serve-from-realm';
import { createServeIndex } from './handlers/serve-index';
import { findOrMountRealm } from './lib/realm-routing';
import type { Prerenderer } from '@cardstack/runtime-common';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler';

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
  private definitionLookup: DefinitionLookup;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private matrixRegistrationSecret: string | undefined;
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;
  private cardSizeLimitBytes: number;
  private fileSizeLimitBytes: number;
  private domainsForPublishedRealms:
    | {
        boxelSpace?: string;
        boxelSite?: string;
      }
    | undefined;
  private prerenderer: Prerenderer | undefined;
  private reconciler: RealmRegistryReconciler;

  constructor({
    serverURL,
    realms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    grafanaSecret,
    realmsRootPath,
    dbAdapter,
    queue,
    definitionLookup,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    getRegistrationSecret,
    domainsForPublishedRealms,
    prerenderer,
  }: {
    serverURL: URL;
    realms: Realm[];
    reconciler: RealmRegistryReconciler;
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    realmServerSecretSeed: string;
    realmSecretSeed: string;
    grafanaSecret: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
    definitionLookup: DefinitionLookup;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    matrixRegistrationSecret?: string;
    getRegistrationSecret?: () => Promise<string | undefined>;
    enableFileWatcher?: boolean;
    domainsForPublishedRealms?: {
      boxelSpace?: string;
      boxelSite?: string;
    };
    prerenderer?: Prerenderer;
  }) {
    if (!matrixRegistrationSecret && !getRegistrationSecret) {
      throw new Error(
        `'matrixRegistrationSecret' or 'getRegistrationSecret' must be specified`,
      );
    }
    detectRealmCollision(realms);
    ensureDirSync(realmsRootPath);

    this.serverURL = serverURL;
    this.cardSizeLimitBytes = Number(
      process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
    );
    this.fileSizeLimitBytes = Number(
      process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
    );
    this.virtualNetwork = virtualNetwork;
    this.matrixClient = matrixClient;

    this.realmSecretSeed = realmSecretSeed;
    this.realmServerSecretSeed = realmServerSecretSeed;
    this.grafanaSecret = grafanaSecret;
    this.realmsRootPath = realmsRootPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.definitionLookup = definitionLookup;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.getRegistrationSecret = getRegistrationSecret;
    this.domainsForPublishedRealms = domainsForPublishedRealms;
    // Pass-by-reference: handlers and the reconciler both mutate this
    // array. Copying it would create two divergent views of mounted
    // realms — a bug under multi-instance Phase 3 semantics. The legacy
    // `[...realms]` copy is gone with that constraint.
    this.realms = realms;
    this.reconciler = reconciler;
    this.prerenderer = prerenderer;
  }

  @Memoize()
  get app() {
    let { serveIndex, serveHostApp } = createServeIndex({
      serverURL: this.serverURL,
      assetsURL: this.assetsURL,
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      virtualNetwork: this.virtualNetwork,
      matrixClient: this.matrixClient,
      getIndexHTML: this.getIndexHTML,
      cardSizeLimitBytes: this.cardSizeLimitBytes,
      fileSizeLimitBytes: this.fileSizeLimitBytes,
    });
    let serveFromRealm = createServeFromRealm({
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      virtualNetwork: this.virtualNetwork,
    });
    let sendEvent = createSendEvent({
      matrixClient: this.matrixClient,
      dbAdapter: this.dbAdapter,
    });

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, If-None-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Assume-User, X-HTTP-Method-Override, X-Boxel-Disable-Module-Cache, X-Filename, X-Boxel-During-Prerender, X-Boxel-Consuming-Realm, X-Boxel-Job-Id, X-Grafana-Device-Id',
          allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS,QUERY',
          // Cache the preflight response for 24 h. Without this @koa/cors
          // omits Access-Control-Max-Age and Chrome falls back to its
          // ~5 s default, which forces a fresh OPTIONS round-trip in front
          // of nearly every cross-origin QUERY the host fires during a
          // long indexing run. The doubled HTTP-arrival count translates
          // directly to wall-clock since each preflight is a serial RTT
          // blocking the QUERY behind it.
          maxAge: 86400,
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
            .includes(mimeType as any)
        ) {
          ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        await next();
      })
      .use(convertAcceptHeaderQueryParam)
      .use(methodOverrideSupport)
      .use(
        createRoutes({
          dbAdapter: this.dbAdapter,
          definitionLookup: this.definitionLookup,
          serverURL: this.serverURL.href,
          matrixClient: this.matrixClient,
          realmServerSecretSeed: this.realmServerSecretSeed,
          realmSecretSeed: this.realmSecretSeed,
          grafanaSecret: this.grafanaSecret,
          virtualNetwork: this.virtualNetwork,
          serveHostApp,
          serveIndex,
          serveFromRealm,
          sendEvent,
          queue: this.queue,
          realms: this.realms,
          assetsURL: this.assetsURL,
          realmsRootPath: this.realmsRootPath,
          getMatrixRegistrationSecret: this.getMatrixRegistrationSecret,
          domainsForPublishedRealms: this.domainsForPublishedRealms,
          prerenderer: this.prerenderer,
          reconciler: this.reconciler,
        }),
      )
      .use(
        proxyAsset('/auth-service-worker.js', this.assetsURL, {
          requestHeaders: {
            'accept-encoding': 'identity',
          },
        }),
      )
      .use(serveIndex)
      .use(serveFromRealm);

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
    instance.on('listening', () => {
      let actualPort =
        (instance.address() as import('net').AddressInfo | null)?.port ?? port;
      this.log.info(`Realm server listening on port %s\n`, actualPort);
    });
    return instance;
  }

  async start() {
    // Phase 3: two paths converge here.
    //
    // 1. Constructor-supplied realms — test helpers and any legacy boot
    //    code path push realms directly into `this.realms` before
    //    server.start() runs and expect this method to call
    //    realm.start() on them (it used to do this implicitly via
    //    loadRealms()). They are not in reconciler.knownByUrl, so the
    //    reconcile pass below would skip them. Iterate first, in
    //    insertion order — realms[] is empty in production main.ts, so
    //    this is a no-op there.
    // 2. Reconciler-driven boot — reconciler.reconcile() reads
    //    realm_registry into knownByUrl and eager-mounts every pinned
    //    row via mountFromRow (the main.ts factory), which constructs
    //    a Realm, publishes into realms[] + virtualNetwork, then
    //    awaits realm.start() so each pinned realm is fully indexed
    //    before this method returns. Non-pinned rows are deferred to
    //    findOrMountRealm() on first request.
    //
    // The reconciler's background poll loop (LISTEN realm_registry +
    // 30s safety poll) starts in main.ts after this method returns.
    for (let realm of this.realms) {
      await realm.start();
    }
    await this.reconciler.reconcile();
  }

  get testingOnlyRealms() {
    return [...this.realms];
  }

  testingOnlyUnmountRealms() {
    for (let realm of this.realms) {
      this.virtualNetwork.unmount(realm.handle);
    }
  }

  // Test-only accessor for the request-path realm resolver. Exposed so
  // lazy-mount integration tests can drive findOrMountRealm directly
  // without spinning up an HTTP listener + mocked Koa context.
  testingOnlyFindOrMountRealm(requestURL: URL): Promise<Realm | undefined> {
    return findOrMountRealm(requestURL, {
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
    });
  }

  // Test-only synchronous reconcile pass. The production reconciler
  // wakes on NOTIFY realm_registry, but tests need a deterministic
  // way to drive the post-DELETE unmount path without polling.
  testingOnlyReconcile(): Promise<void> {
    return this.reconciler.reconcile();
  }

  // we use a function to get the matrix registration secret because matrix
  // client tests leverage a synapse instance that changes multiple times per
  // realm lifespan, and each new synapse instance has a unique registration
  // secret
  private getMatrixRegistrationSecret = async () => {
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
