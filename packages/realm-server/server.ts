import Koa from 'koa';
import cors from '@koa/cors';
import { Memoize } from 'typescript-memoize';
import type {
  DefinitionLookup,
  Realm,
  RealmInfo,
} from '@cardstack/runtime-common';
import {
  logger,
  SupportedMimeType,
  insertPermissions,
  fetchRealmPermissions,
  param,
  query,
  Deferred,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  DEFAULT_PERMISSIONS,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  RealmPaths,
  fetchSessionRoom,
  hasExtension,
  executableExtensions,
  userInitiatedPriority,
} from '@cardstack/runtime-common';
import { enqueueReindexRealmJob } from '@cardstack/runtime-common/jobs/reindex-realm';
import { ensureDirSync, writeJSONSync, existsSync } from 'fs-extra';
import { setupCloseHandler } from './node-realm';
import {
  httpLogging,
  ecsMetadata,
  setContextResponse,
  fetchRequestFromContext,
  methodOverrideSupport,
  proxyAsset,
} from './middleware';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp';
import convertAuthHeaderQueryParam from './middleware/convert-auth-header-qp';
import { resolve, join } from 'path';
import merge from 'lodash/merge';

import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import type { Prerenderer } from '@cardstack/runtime-common';
import { retrieveScopedCSS } from './lib/retrieve-scoped-css';
import { insertSourceRealmInRegistry } from './lib/realm-registry-writes';
import { withRealmWriteLock } from './lib/realm-advisory-locks';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler';
import {
  indexURLCandidates,
  indexCandidateExpressions,
} from './lib/index-url-utils';
import {
  retrieveHeadHTML,
  retrieveIsolatedHTML,
  injectHeadHTML,
  injectIsolatedHTML,
  ensureSingleTitle,
} from './lib/index-html-injection';
import { sanitizeHeadHTMLToString } from '@cardstack/runtime-common';
import { JSDOM } from 'jsdom';

export class RealmServer {
  private log = logger('realm-server');
  private headLog = logger('realm-server:head');
  private isolatedLog = logger('realm-server:isolated');
  private scopedCSSLog = logger('realm-server:scoped-css');
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
  private promiseForIndexHTML: Promise<string> | undefined;
  private indexHTMLHash: string | undefined;
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
    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          allowHeaders:
            'Authorization, Content-Type, If-Match, If-None-Match, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Assume-User, X-HTTP-Method-Override, X-Boxel-Disable-Module-Cache, X-Filename',
          allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS,QUERY',
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
      .use(convertAuthHeaderQueryParam)
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
          createRealm: this.createRealm,
          serveHostApp: this.serveHostApp,
          serveIndex: this.serveIndex,
          serveFromRealm: this.serveFromRealm,
          sendEvent: this.sendEvent,
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
    return this.findOrMountRealm(requestURL);
  }

  // Test-only synchronous reconcile pass. The production reconciler
  // wakes on NOTIFY realm_registry, but tests need a deterministic
  // way to drive the post-DELETE unmount path without polling.
  testingOnlyReconcile(): Promise<void> {
    return this.reconciler.reconcile();
  }

  private serveIndex = async (ctxt: Koa.Context, next: Koa.Next) => {
    let acceptHeader = ctxt.header.accept ?? '';
    let lowerAcceptHeader = acceptHeader.toLowerCase();
    let includesVndMimeType = lowerAcceptHeader.includes('application/vnd.');
    let includesHtmlMimeType = lowerAcceptHeader.includes('text/html');

    let requestURL = new URL(
      `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
    );

    // Track published realm info from routing checks to avoid redundant
    // DB queries in the ETag logic below.
    let publishedRealmInfo: { lastPublishedAt: string | null } | null = null;
    let publishedRealmInfoFetched = false;

    if (includesHtmlMimeType) {
      if (includesVndMimeType) {
        publishedRealmInfo = await this.getPublishedRealmInfo(requestURL);
        publishedRealmInfoFetched = true;

        if (publishedRealmInfo) {
          return next();
        }
      }
    } else {
      if (includesVndMimeType) {
        return next();
      }

      if (hasExtension(requestURL.pathname)) {
        return next();
      }

      publishedRealmInfo = await this.getPublishedRealmInfo(requestURL);
      publishedRealmInfoFetched = true;

      if (!publishedRealmInfo) {
        return next();
      }

      // For published realms with generic Accept headers (like */*), we need to
      // distinguish card URLs from module URLs. Module imports (e.g., "./person")
      // resolve to URLs without extensions and would incorrectly get HTML served.
      // Only serve HTML if:
      // 1. This is a directory index request (path ends with /), OR
      // 2. The URL corresponds to an indexed card instance
      let isIndexRequest = requestURL.pathname.endsWith('/');
      if (!isIndexRequest) {
        let cardURL = requestURL;
        let isCardInstance = await this.isIndexedCardInstance(cardURL);
        if (!isCardInstance) {
          return next();
        }
      }
    }

    // If this is a /connect iframe request, is the origin a valid published realm?

    let connectMatch = ctxt.request.path.match(/\/connect\/(.+)$/);

    if (connectMatch) {
      try {
        let originParameter = new URL(decodeURIComponent(connectMatch[1])).href;

        let publishedRealms = await query(this.dbAdapter, [
          `SELECT url FROM realm_registry WHERE kind = 'published' AND url LIKE `,
          param(`${originParameter}%`),
        ]);

        if (publishedRealms.length === 0) {
          ctxt.status = 404;
          ctxt.body = `Not Found: No published realm found for origin ${originParameter}`;

          this.log.debug(
            `Ignoring /connect request for origin ${originParameter}: no matching published realm`,
          );

          return;
        }

        ctxt.set(
          'Content-Security-Policy',
          `frame-ancestors ${originParameter}`,
        );
      } catch (error) {
        ctxt.status = 400;
        ctxt.body = 'Bad Request';

        this.log.info(`Error processing /connect request: ${error}`);

        return;
      }
    }

    ctxt.type = 'html';

    let cardURL = requestURL;
    let isIndexRequest = requestURL.pathname.endsWith('/');
    if (isIndexRequest) {
      cardURL = new URL('index', requestURL);
    }

    // Retrieve index HTML early so the shell hash is available for ETag.
    // This is memoized in production, so it's cheap after the first call.
    let indexHTML = await this.retrieveIndexHTML();

    // For published realms, support HTTP caching via ETag.
    // The ETag includes both last_published_at and a hash of the host app
    // shell, so a deploy that changes index.html invalidates cached responses.
    if (!publishedRealmInfoFetched) {
      publishedRealmInfo = await this.getPublishedRealmInfo(requestURL);
    }
    let lastPublishedAt = publishedRealmInfo?.lastPublishedAt;
    let etag =
      lastPublishedAt && this.indexHTMLHash
        ? `"${lastPublishedAt}-${this.indexHTMLHash}"`
        : null;

    if (etag) {
      let ifNoneMatch = ctxt.get('If-None-Match');
      if (
        ifNoneMatch === '*' ||
        ifNoneMatch
          .split(',')
          .some((t) => t.trim().replace(/^W\//, '') === etag)
      ) {
        ctxt.status = 304;
        ctxt.set('ETag', etag);
        ctxt.set('Cache-Control', 'public, max-age=0, must-revalidate');
        ctxt.vary('Accept');
        return;
      }
    }
    let hasPublicPermissions = await this.hasPublicPermissions(cardURL);

    if (!hasPublicPermissions) {
      ctxt.body = injectHeadHTML(
        indexHTML,
        `<title>Boxel</title>\n${this.defaultIconLinks().join('\n')}`,
      );
      return;
    }

    this.headLog.debug(`Fetching head HTML for ${cardURL.href}`);
    this.isolatedLog.debug(`Fetching isolated HTML for ${cardURL.href}`);
    this.scopedCSSLog.debug(`Fetching scoped CSS for ${cardURL.href}`);

    let [headHTML, isolatedHTML, scopedCSS] = await Promise.all([
      retrieveHeadHTML({
        cardURL,
        dbAdapter: this.dbAdapter,
        log: this.headLog,
      }),
      retrieveIsolatedHTML({
        cardURL,
        dbAdapter: this.dbAdapter,
        log: this.isolatedLog,
      }),
      retrieveScopedCSS({
        cardURL,
        dbAdapter: this.dbAdapter,
        log: this.scopedCSSLog,
      }),
    ]);

    let doc = new JSDOM().window.document;
    if (headHTML != null) {
      let sanitized = sanitizeHeadHTMLToString(headHTML, doc);
      if (sanitized !== null) {
        headHTML = sanitized;
      } else {
        headHTML = null;
      }
    }

    if (headHTML != null) {
      this.headLog.debug(
        `Injecting head HTML for ${cardURL.href} (length ${headHTML.length})\n${this.truncateLogLines(
          headHTML,
        )}`,
      );
    } else {
      this.headLog.debug(
        `No head HTML found for ${cardURL.href}, serving base index.html`,
      );
    }

    if (scopedCSS != null) {
      this.scopedCSSLog.debug(
        `Using scoped CSS for ${cardURL.href} (length ${scopedCSS.length})`,
      );
    } else {
      this.scopedCSSLog.debug(
        `No scoped CSS returned from database for ${cardURL.href}`,
      );
    }

    let responseHTML = indexHTML;
    let headFragments: string[] = [];

    if (headHTML != null) {
      headFragments.push(ensureSingleTitle(headHTML));
    } else {
      headFragments.push('<title>Boxel</title>');
    }

    if (scopedCSS != null) {
      this.scopedCSSLog.debug(`Injecting scoped CSS for ${cardURL.href}`);
      headFragments.push(
        `<style data-boxel-scoped-css>\n${scopedCSS}\n</style>`,
      );
    }

    let hasFavicon = false;
    let hasAppleTouchIcon = false;
    if (headHTML != null) {
      let fragment = doc.createRange().createContextualFragment(headHTML);
      hasFavicon = fragment.querySelector('link[rel~="icon"]') != null;
      hasAppleTouchIcon =
        fragment.querySelector('link[rel~="apple-touch-icon"]') != null;
    }
    let faviconURL = new URL('boxel-favicon.png', this.assetsURL).href;
    let webclipURL = new URL('boxel-webclip.png', this.assetsURL).href;
    if (!hasFavicon) {
      headFragments.push(`<link href="${faviconURL}" rel="icon" />`);
    }
    if (!hasAppleTouchIcon) {
      headFragments.push(
        `<link href="${webclipURL}" rel="apple-touch-icon" />`,
      );
    }

    if (headFragments.length > 0) {
      responseHTML = injectHeadHTML(responseHTML, headFragments.join('\n'));
    }

    if (isolatedHTML != null) {
      this.isolatedLog.debug(
        `Injecting isolated HTML for ${cardURL.href} (length ${isolatedHTML.length})\n${this.truncateLogLines(
          isolatedHTML,
        )}`,
      );
      responseHTML = injectIsolatedHTML(responseHTML, isolatedHTML);
    }

    if (etag) {
      ctxt.set('ETag', etag);
      ctxt.set('Cache-Control', 'public, max-age=0, must-revalidate');
      ctxt.vary('Accept');
    }

    ctxt.body = responseHTML;
    return;
  };

  private serveHostApp = async (ctxt: Koa.Context, next: Koa.Next) => {
    let acceptHeader = (ctxt.header.accept ?? '').toLowerCase();
    let isHead = ctxt.method === 'HEAD';
    if (!isHead && !acceptHeader.includes('text/html')) {
      return next();
    }

    ctxt.type = 'html';
    ctxt.body = injectHeadHTML(
      await this.retrieveIndexHTML(),
      `<title>Boxel</title>\n${this.defaultIconLinks().join('\n')}`,
    );
  };

  // Resolves a request URL to a mounted Realm, lazy-mounting via the
  // reconciler if the request is the first hit on a non-pinned realm
  // (Phase 3 lazy-mount semantics). Returns undefined when no realm in the
  // registry matches the request — caller should respond 404.
  //
  // Lookup order:
  //   1. this.realms — covers (a) realms whose mountFromRow has already
  //      published them to this array but whose start() is still awaiting
  //      fullIndex; the worker processing that fullIndex re-enters this
  //      resolver to fetch <realm>/_mtimes and must hit the published
  //      realm rather than reconciler.ensureMounted(), which would
  //      return the same in-flight promise and deadlock the boot path;
  //      and (b) handler-created realms in Phase 3 PR 1 (publish/copy
  //      push directly to this.realms; the reconciler may not have
  //      observed them via NOTIFY/reconcile yet). Phase 3 PR 2 collapses
  //      (b) onto the reconciler.
  //   2. reconciler.knownByUrl — the Phase 3 source of truth for never-
  //      mounted realms. Iterates registry rows, finds the one whose URL
  //      prefix contains the request, delegates to lookupOrMount() which
  //      constructs+mounts via mountFromRow on the cold first request.
  private async findOrMountRealm(requestURL: URL): Promise<Realm | undefined> {
    let legacy = this.realms.find((candidate) => {
      let realmURL = new URL(candidate.url);
      realmURL.protocol = requestURL.protocol;
      return new RealmPaths(realmURL).inRealm(requestURL);
    });
    if (legacy) {
      return legacy;
    }
    for (const url of this.reconciler.knownByUrl.keys()) {
      let realmURL = new URL(url);
      realmURL.protocol = requestURL.protocol;
      if (new RealmPaths(realmURL).inRealm(requestURL)) {
        return await this.reconciler.lookupOrMount(url);
      }
    }
    // Phase 3: knownByUrl is populated by reconciler.reconcile() on
    // boot + LISTEN/poll. A request that arrives between a sibling
    // instance's POST /_create-realm (or /_publish-realm) and this
    // instance's reconciler picking up NOTIFY would otherwise 404.
    // Fall through to a direct registry probe — match on every path
    // prefix and let Postgres pick the longest URL so a request to
    // `/foo/bar/baz/file.json` resolves to `/foo/bar/baz/` if that's
    // registered, not `/foo/` (both prefixes are valid candidates).
    let candidatePaths = candidateRealmURLs(requestURL);
    if (candidatePaths.length === 0) {
      return undefined;
    }
    let inClause: (string | ReturnType<typeof param>)[] = ['('];
    candidatePaths.forEach((u, idx) => {
      if (idx > 0) inClause.push(',');
      inClause.push(param(u));
    });
    inClause.push(')');
    let rows = (await query(this.dbAdapter, [
      `SELECT url FROM realm_registry WHERE url IN`,
      ...inClause,
      `ORDER BY LENGTH(url) DESC LIMIT 1`,
    ])) as { url: string }[];
    if (rows.length === 0) {
      return undefined;
    }
    return await this.reconciler.lookupOrMount(rows[0].url);
  }

  private async getPublishedRealmInfo(
    requestURL: URL,
  ): Promise<{ lastPublishedAt: string | null } | null> {
    let realm = await this.findOrMountRealm(requestURL);
    if (!realm) {
      return null;
    }

    let rows = await query(this.dbAdapter, [
      `SELECT last_published_at FROM realm_registry WHERE kind = 'published' AND url =`,
      param(realm.url),
    ]);

    if (rows.length === 0) {
      return null;
    }

    return {
      lastPublishedAt: (rows[0].last_published_at as string) ?? null,
    };
  }

  // Check if the URL corresponds to an indexed card instance.
  // This is used to distinguish card URLs from module URLs when deciding
  // whether to serve HTML for published realms.
  //
  // IMPORTANT: Card instances have their file_alias set to the URL without
  // the .json extension. This means an instance at /foo/bar.json has
  // file_alias /foo/bar. When a module request comes in for /foo/bar (no
  // extension), we must check if it's actually a module before assuming it's
  // an instance. Modules take precedence over instance aliases.
  private async isIndexedCardInstance(cardURL: URL): Promise<boolean> {
    let candidates = indexURLCandidates(cardURL);
    if (candidates.length === 0) {
      return false;
    }

    // First check if there's a module at this URL - modules take precedence
    // over instance aliases. This handles the case where:
    // - Module: /foo/bar.gts (file_alias: /foo/bar)
    // - Instance: /foo/bar.json (file_alias: /foo/bar)
    // A request for /foo/bar should serve the module, not HTML for the instance.
    // Prefer the modules table here because copied/published realms do not
    // carry module rows in boxel_index.
    let moduleRows = await query(this.dbAdapter, [
      `
        SELECT 1
        FROM modules
        WHERE
      `,
      ...indexCandidateExpressions(candidates),
      `
        LIMIT 1
      `,
    ]);

    if (moduleRows.length > 0) {
      return false;
    }

    let rows = await query(this.dbAdapter, [
      `
        SELECT 1
        FROM boxel_index
        WHERE type = 'instance'
          AND is_deleted IS NOT TRUE
          AND
        `,
      ...indexCandidateExpressions(candidates),
      `
        LIMIT 1
      `,
    ]);

    if (rows.length === 0) {
      return false;
    }

    // During publish/copy index races, module rows can lag behind source files.
    // Only do filesystem probing after we've identified an instance candidate
    // to avoid extra IO on the hot request path.
    if (await this.hasExtensionlessSourceModule(cardURL)) {
      return false;
    }

    return true;
  }

  private async hasExtensionlessSourceModule(cardURL: URL): Promise<boolean> {
    let realm = await this.findOrMountRealm(cardURL);
    if (!realm?.dir) {
      return false;
    }

    let localPath: string;
    try {
      localPath = realm.paths.local(cardURL);
    } catch {
      return false;
    }

    if (!localPath || hasExtension(localPath)) {
      return false;
    }

    for (let extension of executableExtensions) {
      if (existsSync(join(realm.dir, `${localPath}${extension}`))) {
        return true;
      }
      if (existsSync(join(realm.dir, localPath, `index${extension}`))) {
        return true;
      }
    }

    return false;
  }

  private async hasPublicPermissions(cardURL: URL): Promise<boolean> {
    let realm = await this.findOrMountRealm(cardURL);

    if (!realm) {
      return false;
    }

    let permissions = await fetchRealmPermissions(
      this.dbAdapter,
      new URL(realm.url),
    );

    return permissions['*']?.includes('read') ?? false;
  }

  private async retrieveIndexHTML(): Promise<string> {
    // Cache index.html in production only
    let isDev = this.assetsURL.hostname === 'localhost';

    if (!isDev && this.promiseForIndexHTML) {
      return this.promiseForIndexHTML;
    }

    let deferred = new Deferred<string>();

    if (!isDev) {
      this.promiseForIndexHTML = deferred.promise;
    }

    let rewriteRealmURL = (url?: string) => {
      if (!url) {
        return url;
      }

      let parsed = new URL(url);
      return new URL(
        `${parsed.pathname}${parsed.search}${parsed.hash}`,
        this.serverURL,
      ).href;
    };

    let indexHTML = (await this.getIndexHTML()).replace(
      /(<meta name="@cardstack\/host\/config\/environment" content=")([^"].*)(">)/,
      (_match, g1, g2, g3) => {
        let config = JSON.parse(decodeURIComponent(g2));

        // Rewrite published realm domains to match this realm server’s host.
        // The host app’s build-time config may have a different domain (e.g.
        // realm-server.*.localhost for the dev stack), but the isolated test
        // realm server uses realm-matrix-test.*.localhost.
        config.publishedRealmBoxelSpaceDomain = this.serverURL.host;
        config.publishedRealmBoxelSiteDomain = this.serverURL.host;

        config = merge({}, config, {
          hostsOwnAssets: false,
          assetsURL: this.assetsURL.href,
          matrixURL: this.matrixClient.matrixURL.href.replace(/\/$/, ''),
          matrixServerName:
            process.env.MATRIX_SERVER_NAME ||
            this.matrixClient.matrixURL.hostname,
          realmServerURL: this.serverURL.href,
          resolvedBaseRealmURL: rewriteRealmURL(config.resolvedBaseRealmURL),
          resolvedCatalogRealmURL: rewriteRealmURL(
            config.resolvedCatalogRealmURL,
          ),
          resolvedLegacyCatalogRealmURL: rewriteRealmURL(
            config.resolvedLegacyCatalogRealmURL,
          ),
          resolvedSkillsRealmURL: rewriteRealmURL(
            config.resolvedSkillsRealmURL,
          ),
          resolvedOpenRouterRealmURL: rewriteRealmURL(
            config.resolvedOpenRouterRealmURL,
          ),
          defaultSystemCardId: rewriteRealmURL(config.defaultSystemCardId),
          cardSizeLimitBytes: this.cardSizeLimitBytes,
          fileSizeLimitBytes: this.fileSizeLimitBytes,
          publishedRealmDomainOverrides:
            process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES ??
            config.publishedRealmDomainOverrides,
        });
        return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
      },
    );

    indexHTML = indexHTML.replace(
      /(src|href)="\//g,
      `$1="${this.assetsURL.href}`,
    );

    // Strip any static favicon/apple-touch-icon links from the base HTML
    // since these are now dynamically injected between the head markers
    indexHTML = indexHTML
      .replace(/<link[^>]*\brel="icon"[^>]*\/?>/gi, '')
      .replace(/<link[^>]*\brel="apple-touch-icon"[^>]*\/?>/gi, '');

    // Recompute the hash in dev mode (where index.html is not cached) so
    // that changes to the shell are reflected in the ETag.
    if (!this.indexHTMLHash || isDev) {
      let { createHash } = await import('crypto');
      this.indexHTMLHash = createHash('md5')
        .update(indexHTML)
        .digest('hex')
        .slice(0, 8);
    }

    deferred.fulfill(indexHTML);
    return indexHTML;
  }

  private defaultIconLinks(): string[] {
    let faviconURL = new URL('boxel-favicon.png', this.assetsURL).href;
    let webclipURL = new URL('boxel-webclip.png', this.assetsURL).href;
    return [
      `<link href="${faviconURL}" rel="icon" />`,
      `<link href="${webclipURL}" rel="apple-touch-icon" />`,
    ];
  }

  private truncateLogLines(value: string, maxLines = 3): string {
    let lines = value.split(/\r?\n/);
    if (lines.length <= maxLines) {
      return value;
    }
    let truncated = lines.slice(0, maxLines);
    truncated[maxLines - 1] = `${truncated[maxLines - 1]} ...`;
    return truncated.join('\n');
  }

  private serveFromRealm = async (ctxt: Koa.Context, _next: Koa.Next) => {
    if (ctxt.request.path === '/_boom') {
      throw new Error('boom');
    }
    let request = await fetchRequestFromContext(ctxt);
    // Phase 3 lazy mount: trigger findOrMountRealm before dispatching to
    // virtualNetwork.handle so non-pinned realms (source/published) mount
    // on first request. virtualNetwork.handle returns 404 for any URL
    // whose handle isn't registered, which is exactly what happens for
    // a realm that the reconciler knows about (knownByUrl) but hasn't
    // mounted yet. findOrMountRealm walks knownByUrl, calls
    // reconciler.lookupOrMount() on a prefix match, and that
    // synchronously publishes the realm into virtualNetwork before the
    // dispatch below. Mount failures throw — the catch turns them into
    // 503 so the next request retries from scratch (ensureMounted's
    // failure path clears mounted/pendingMounts).
    let requestURL = new URL(
      `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
    );
    try {
      await this.findOrMountRealm(requestURL);
    } catch (err: any) {
      this.log.warn(
        `failed to mount realm for request ${requestURL.href}: ${err?.message ?? err}`,
      );
      ctxt.status = 503;
      ctxt.body = `Realm mount failed: ${err?.message ?? err}`;
      return;
    }
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
  }): Promise<{ url: string; realm: Realm; info: Partial<RealmInfo> }> => {
    // Server-root collision check. Read realms[] AND realm_registry —
    // every production realm has a registry row, but test fixtures
    // construct CLI-style realms via runTestRealmServer that don't
    // mirror to the registry. Either source matching the origin is a
    // collision. (Phase 3 PR 2: handlers don't *mutate* realms[]; read
    // is fine.)
    let serverRootUrl = this.serverURL.origin + '/';
    let realmAtServerRoot = this.realms.find((r) => {
      let realmUrl = new URL(r.url);
      return (
        realmUrl.href.replace(/\/$/, '') === realmUrl.origin &&
        realmUrl.hostname === this.serverURL.hostname
      );
    });
    if (realmAtServerRoot) {
      throw errorWithStatus(
        400,
        `Cannot create a realm: a realm is already mounted at the origin of this server: ${realmAtServerRoot.url}`,
      );
    }
    let serverRootRows = (await query(this.dbAdapter, [
      `SELECT url FROM realm_registry WHERE url =`,
      param(serverRootUrl),
    ])) as { url: string }[];
    if (serverRootRows.length > 0) {
      throw errorWithStatus(
        400,
        `Cannot create a realm: a realm is already mounted at the origin of this server: ${serverRootRows[0].url}`,
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

    let existingRows = (await query(this.dbAdapter, [
      `SELECT url FROM realm_registry WHERE url =`,
      param(url),
    ])) as { url: string }[];
    if (existingRows.length > 0) {
      throw errorWithStatus(
        400,
        `realm '${url}' already exists on this server`,
      );
    }

    let realmPath = resolve(join(this.realmsRootPath, ownerUsername, endpoint));
    ensureDirSync(realmPath);

    let info = {
      name,
      ...(iconURL ? { iconURL } : {}),
      ...(backgroundURL ? { backgroundURL } : {}),
      publishable: true,
    };

    // Serialize against any other caller of withRealmWriteLock for this
    // same URL (concurrent createRealm for the same endpoint, or a
    // concurrent publish/unpublish/delete). This is almost never a real
    // concurrency concern — the endpoint was already checked above for
    // collision.
    await withRealmWriteLock(this.dbAdapter, url, async () => {
      await insertPermissions(this.dbAdapter, new URL(url), {
        [ownerUserId]: DEFAULT_PERMISSIONS,
      });

      // CS-10053: publishable lives in realm_metadata now, not the
      // sidecar. The legacy .realm.json is no longer written here;
      // hostHome/interactHome (still sidecar-owned until CS-10055)
      // are absent on a fresh realm and don't need a placeholder file.
      // Reset all mutable metadata columns on conflict so a stale row
      // (e.g. left over from a previous realm at the same URL whose
      // delete didn't clean up) doesn't bleed into the new realm.
      await query(this.dbAdapter, [
        `INSERT INTO realm_metadata (url, publishable, show_as_catalog) VALUES (`,
        param(url),
        `,`,
        param(true),
        `,`,
        param(null),
        `) ON CONFLICT (url) DO UPDATE SET publishable = true, show_as_catalog = NULL, updated_at = now()`,
      ]);
      writeJSONSync(join(realmPath, 'realm.json'), {
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name },
            ...(iconURL ? { iconURL } : {}),
            ...(backgroundURL ? { backgroundURL } : {}),
          },
          meta: {
            adoptsFrom: {
              module: 'https://cardstack.com/base/realm-config',
              name: 'RealmConfig',
            },
          },
        },
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

      // Register the source realm in realm_registry. The INSERT emits
      // NOTIFY realm_registry; the reconciler on every instance picks
      // up the row, and the realm is lazy-mounted on first request.
      await insertSourceRealmInRegistry(this.dbAdapter, {
        url,
        diskId: `${ownerUsername}/${endpoint}`,
        ownerUsername,
      });
    });

    // virtualNetwork URL mapping was historically bridged here so a
    // virtual realm URL (e.g. cardstack.com/base/) routed to the
    // physical localhost URL. For dynamically-created realms via
    // /_create-realm, the URL is already a physical
    // serverURL-rooted URL (no remap needed), but preserve the
    // detection-and-add for any environment that maps it.
    let actualRealmURL = this.virtualNetwork.mapURL(url, 'virtual-to-real');
    if (actualRealmURL && actualRealmURL.href !== url) {
      this.virtualNetwork.addURLMapping(new URL(url), actualRealmURL);
    }

    // Phase 3: enqueue the from-scratch-index job at userInitiatedPriority
    // so the canonical (post-coalesce) job carries that priority — even
    // if reconciler.lookupOrMount below also enqueues one at the default
    // systemInitiatedPriority via realm.start(). The chooseFromScratch
    // coalesce JOINs same-realm jobs and keeps maxPriority.
    await enqueueReindexRealmJob(
      url,
      ownerUsername,
      this.queue,
      this.dbAdapter,
      userInitiatedPriority,
    );

    // Synchronously mount + start the realm on the *handling* instance.
    // The 202 response with status:'pending' is for sibling instances —
    // they pick up the realm via NOTIFY realm_registry and lazy-mount
    // on first request. On this instance the realm is fully ready by
    // the time we return: ensureMounted publishes into realms[] /
    // virtualNetwork via prepareRealmFromRow and awaits realm.start(),
    // which awaits the from-scratch-index job. Mounting eagerly here
    // also drains the queue locally so the test framework's teardown
    // (close server → drain runner → close DB) doesn't race a worker
    // mid-fetch on the now-closed HTTP listener.
    let realm = await this.reconciler.lookupOrMount(url);
    if (!realm) {
      throw new Error(
        `expected realm ${url} to be mounted after createRealm — registry row missing or mount failed`,
      );
    }

    return { url, realm, info };
  };

  private sendEvent = async (
    user: string,
    eventType: string,
    data?: Record<string, any>,
  ) => {
    if (!this.matrixClient.isLoggedIn()) {
      await this.matrixClient.login();
    }
    let roomId = await fetchSessionRoom(this.dbAdapter, user);
    if (!roomId) {
      console.error(
        `Failed to send event: ${eventType}, cannot find session room for user: ${user}`,
      );
    }

    await this.matrixClient.sendEvent(roomId!, 'm.room.message', {
      body: JSON.stringify({ eventType, data }),
      msgtype: APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE,
    });
  };

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

function errorWithStatus(
  status: number,
  message: string,
): Error & { status: number } {
  let error = new Error(message);
  (error as Error & { status: number }).status = status;
  return error as Error & { status: number };
}

// Build candidate realm URLs from a request URL by trimming the
// pathname segment-by-segment. Used by findOrMountRealm's registry
// fallback when knownByUrl is stale. Includes the origin-only form
// (root realm) and every prefix that ends with a slash.
function candidateRealmURLs(requestURL: URL): string[] {
  let segments = requestURL.pathname.split('/').filter(Boolean);
  let candidates: string[] = [];
  // Try longest-prefix first.
  for (let i = segments.length; i >= 0; i--) {
    let path = i === 0 ? '/' : '/' + segments.slice(0, i).join('/') + '/';
    candidates.push(`${requestURL.origin}${path}`);
  }
  return [...new Set(candidates)];
}
