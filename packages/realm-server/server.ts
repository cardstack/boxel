import Koa from 'koa';
import cors from '@koa/cors';
import { Memoize } from 'typescript-memoize';
import type { DefinitionLookup, RealmInfo } from '@cardstack/runtime-common';
import {
  Realm,
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
  PUBLISHED_DIRECTORY_NAME,
  RealmPaths,
  fetchSessionRoom,
  REALM_SERVER_REALM,
  userInitiatedPriority,
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

import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import {
  addExplicitParens,
  any,
  type Expression,
} from '@cardstack/runtime-common/expression';
import * as Sentry from '@sentry/node';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  passwordFromSeed,
  getMatrixUsername,
} from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes';
import { APP_BOXEL_REALM_SERVER_EVENT_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';
import type { Prerenderer } from '@cardstack/runtime-common';
import { retrieveScopedCSS } from './lib/retrieve-scoped-css';

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
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;
  private enableFileWatcher: boolean;
  private cardSizeLimitBytes: number;
  private domainsForPublishedRealms:
    | {
        boxelSpace?: string;
        boxelSite?: string;
      }
    | undefined;
  private prerenderer: Prerenderer | undefined;

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
    definitionLookup,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    getRegistrationSecret,
    enableFileWatcher,
    domainsForPublishedRealms,
    prerenderer,
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
    this.enableFileWatcher = enableFileWatcher ?? false;
    this.domainsForPublishedRealms = domainsForPublishedRealms;
    this.realms = [...realms];
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
          assetsURL: this.assetsURL,
          realmsRootPath: this.realmsRootPath,
          getMatrixRegistrationSecret: this.getMatrixRegistrationSecret,
          createAndMountRealm: this.createAndMountRealm,
          domainsForPublishedRealms: this.domainsForPublishedRealms,
          prerenderer: this.prerenderer,
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
    for (let loadedRealm of loadedRealms) {
      const existingIndex = this.realms.findIndex(
        (r) => r.url === loadedRealm.url,
      );
      if (existingIndex === -1) {
        this.realms.push(loadedRealm);
      } else {
        this.realms[existingIndex] = loadedRealm;
      }
    }

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
      // If this is a /connect iframe request, is the origin a valid published realm?

      let connectMatch = ctxt.request.path.match(/\/connect\/(.+)$/);

      if (connectMatch) {
        try {
          let originParameter = new URL(decodeURIComponent(connectMatch[1]))
            .href;

          let publishedRealms = await query(this.dbAdapter, [
            `SELECT published_realm_url FROM published_realms WHERE published_realm_url LIKE `,
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

      let requestURL = new URL(
        `${ctxt.protocol}://${ctxt.host}${ctxt.originalUrl}`,
      );
      let cardURL = requestURL;
      let isIndexRequest = requestURL.pathname.endsWith('/');
      if (isIndexRequest) {
        cardURL = new URL('index', requestURL);
      }

      let indexHTML = await this.retrieveIndexHTML();
      let hasPublicPermissions = await this.hasPublicPermissions(cardURL);

      if (!hasPublicPermissions) {
        ctxt.body = indexHTML;
        return;
      }

      this.headLog.debug(`Fetching head HTML for ${cardURL.href}`);
      this.isolatedLog.debug(`Fetching isolated HTML for ${cardURL.href}`);
      this.scopedCSSLog.debug(`Fetching scoped CSS for ${cardURL.href}`);

      let [headHTML, isolatedHTML, scopedCSS] = await Promise.all([
        this.retrieveHeadHTML(cardURL),
        this.retrieveIsolatedHTML(cardURL),
        retrieveScopedCSS({
          cardURL,
          dbAdapter: this.dbAdapter,
          indexURLCandidates: (url) => this.indexURLCandidates(url),
          indexCandidateExpressions: (candidates) =>
            this.indexCandidateExpressions(candidates),
          log: this.scopedCSSLog,
        }),
      ]);

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
        headFragments.push(headHTML);
      }

      if (scopedCSS != null) {
        this.scopedCSSLog.debug(`Injecting scoped CSS for ${cardURL.href}`);
        headFragments.push(
          `<style data-boxel-scoped-css>\n${scopedCSS}\n</style>`,
        );
      }

      if (headFragments.length > 0) {
        responseHTML = this.injectHeadHTML(
          responseHTML,
          headFragments.join('\n'),
        );
      }

      if (isolatedHTML != null) {
        this.isolatedLog.debug(
          `Injecting isolated HTML for ${cardURL.href} (length ${isolatedHTML.length})\n${this.truncateLogLines(
            isolatedHTML,
          )}`,
        );
        responseHTML = this.injectIsolatedHTML(responseHTML, isolatedHTML);
      }

      ctxt.body = responseHTML;
      return;
    }
    return next();
  };

  private async hasPublicPermissions(cardURL: URL): Promise<boolean> {
    let realm = this.realms.find((candidate) => {
      let realmURL = new URL(candidate.url);
      realmURL.protocol = cardURL.protocol;
      return new RealmPaths(realmURL).inRealm(cardURL);
    });

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

        if (config.publishedRealmBoxelSpaceDomain === 'localhost:4201') {
          // if this is the default, this needs to be the realm server’s host
          // to work in Matrix tests, since publishedRealmBoxelSpaceDomain is currently
          // the default domain for publishing a realm
          config.publishedRealmBoxelSpaceDomain = this.serverURL.host;
        }

        if (config.publishedRealmBoxelSiteDomain === 'localhost:4201') {
          // if this is the default, this needs to be the realm server’s host
          // to work in Matrix tests, since publishedRealmBoxelSiteDomain is currently
          // the default domain for publishing a realm
          config.publishedRealmBoxelSiteDomain = this.serverURL.host;
        }

        config = merge({}, config, {
          hostsOwnAssets: false,
          assetsURL: this.assetsURL.href,
          realmServerURL: this.serverURL.href,
          cardSizeLimitBytes: this.cardSizeLimitBytes,
          publishedRealmDomainOverrides:
            process.env.PUBLISHED_REALM_DOMAIN_OVERRIDES ??
            config.publishedRealmDomainOverrides,
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

  private async retrieveHeadHTML(cardURL: URL): Promise<string | null> {
    let candidates = this.indexURLCandidates(cardURL);

    this.headLog.debug(
      `Head URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
    );

    if (candidates.length === 0) {
      this.headLog.debug(`No head candidates for ${cardURL.href}`);
      return null;
    }

    let rows = await query(this.dbAdapter, [
      `SELECT head_html, realm_version FROM boxel_index_working WHERE head_html IS NOT NULL AND type =`,
      param('instance'),
      'AND',
      'is_deleted IS NOT TRUE',
      'AND',
      ...this.indexCandidateExpressions(candidates),
      `UNION ALL
       SELECT head_html, realm_version FROM boxel_index WHERE head_html IS NOT NULL AND type =`,
      param('instance'),
      'AND',
      'is_deleted IS NOT TRUE',
      'AND',
      ...this.indexCandidateExpressions(candidates),
      `ORDER BY realm_version DESC
       LIMIT 1`,
    ]);

    this.headLog.debug('Head query result for %s', cardURL.href, rows);

    let headRow = rows[0] as
      | { head_html?: string | null; realm_version?: string | number }
      | undefined;

    if (headRow?.head_html != null) {
      this.headLog.debug(
        `Using head HTML from realm version ${headRow.realm_version} for ${cardURL.href}`,
      );
    } else {
      this.headLog.debug(
        `No head HTML returned from database for ${cardURL.href}`,
      );
    }
    return headRow?.head_html ?? null;
  }

  private async retrieveIsolatedHTML(cardURL: URL): Promise<string | null> {
    let candidates = this.indexURLCandidates(cardURL);

    this.isolatedLog.debug(
      `Isolated URL candidates for ${cardURL.href}: ${candidates.join(', ')}`,
    );

    if (candidates.length === 0) {
      this.isolatedLog.debug(`No isolated candidates for ${cardURL.href}`);
      return null;
    }

    let rows = await query(this.dbAdapter, [
      `SELECT isolated_html, realm_version FROM boxel_index_working WHERE isolated_html IS NOT NULL AND type =`,
      param('instance'),
      'AND',
      'is_deleted IS NOT TRUE',
      'AND',
      ...this.indexCandidateExpressions(candidates),
      `UNION ALL
       SELECT isolated_html, realm_version FROM boxel_index WHERE isolated_html IS NOT NULL AND type =`,
      param('instance'),
      'AND',
      'is_deleted IS NOT TRUE',
      'AND',
      ...this.indexCandidateExpressions(candidates),
      `ORDER BY realm_version DESC
       LIMIT 1`,
    ]);

    this.isolatedLog.debug('Isolated query result for %s', cardURL.href, rows);

    let isolatedRow = rows[0] as
      | { isolated_html?: string | null; realm_version?: string | number }
      | undefined;

    if (isolatedRow?.isolated_html != null) {
      this.isolatedLog.debug(
        `Using isolated HTML from realm version ${isolatedRow.realm_version} for ${cardURL.href}`,
      );
    } else {
      this.isolatedLog.debug(
        `No isolated HTML returned from database for ${cardURL.href}`,
      );
    }

    return isolatedRow?.isolated_html ?? null;
  }

  private stripProtocol(href: string): string {
    return href.replace(/^https?:\/\//, '');
  }

  private indexURLCandidates(cardURL: URL): string[] {
    let href = cardURL.href.replace(/\?.*/, '');
    let candidates = [href].flatMap((url) => {
      // strip trailing slash, but keep root realm URLs that end with slash
      let trimmed = url.endsWith('/') ? url.slice(0, -1) : url;
      let withIndex = url.endsWith('/') ? `${trimmed}/index` : `${url}/index`;
      let withJson = `${url.replace(/\/?$/, '')}.json`;
      let withIndexJson = `${withIndex}.json`;
      return [url, trimmed, withIndex, withJson, withIndexJson];
    });

    return [...new Set(candidates)];
  }

  private indexCandidateExpressions(candidates: string[]): Expression {
    // Proxying means the apparent request URL will be http but in the database it’s https
    return addExplicitParens(
      any(
        candidates.flatMap((candidate) => [
          [
            "regexp_replace(url, '^https?://', '') =",
            param(this.stripProtocol(candidate)),
          ],
          [
            "regexp_replace(file_alias, '^https?://', '') =",
            param(this.stripProtocol(candidate)),
          ],
        ]),
      ) as Expression,
    ) as Expression;
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

  private injectHeadHTML(indexHTML: string, headHTML: string): string {
    return indexHTML.replace(
      /(<meta[^>]+data-boxel-head-start[^>]*>)([\s\S]*?)(<meta[^>]+data-boxel-head-end[^>]*>)/,
      `$1\n${headHTML}\n$3`,
    );
  }

  private injectIsolatedHTML(indexHTML: string, isolatedHTML: string): string {
    return indexHTML.replace(
      /(<script[^>]+id="boxel-isolated-start"[^>]*>\s*<\/script>)([\s\S]*?)(<script[^>]+id="boxel-isolated-end"[^>]*>\s*<\/script>)/,
      `$1\n${isolatedHTML}\n$3`,
    );
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
  }): Promise<{ realm: Realm; info: Partial<RealmInfo> }> => {
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

    let info = {
      name,
      ...(iconURL ? { iconURL } : {}),
      ...(backgroundURL ? { backgroundURL } : {}),
      publishable: true,
    };
    writeJSONSync(join(realmPath, '.realm.json'), info);
    writeJSONSync(join(realmPath, 'index.json'), {
      data: {
        type: 'card',
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/index',
            name: 'IndexCard',
          },
        },
        relationships: {
          cardsGrid: {
            links: {
              self: './cards-grid',
            },
          },
        },
      },
    });
    writeJSONSync(join(realmPath, 'cards-grid.json'), {
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

    let realm = this.createAndMountRealm(
      realmPath,
      url,
      username,
      undefined,
      undefined,
      userInitiatedPriority,
    );
    await realm.ensureSessionRoom(ownerUserId);

    return {
      realm,
      info,
    };
  };

  private createAndMountRealm = (
    path: string,
    url: string,
    username: string,
    copiedFromRealm?: URL,
    enableFileWatcher?: boolean,
    fromScratchIndexPriority?: number,
  ) => {
    let adapter = new NodeAdapter(
      resolve(path),
      enableFileWatcher ?? this.enableFileWatcher,
    );
    const realmOptions: {
      copiedFromRealm?: URL;
      fromScratchIndexPriority?: number;
    } = {};
    if (copiedFromRealm) {
      realmOptions.copiedFromRealm = copiedFromRealm;
    }
    if (fromScratchIndexPriority !== undefined) {
      realmOptions.fromScratchIndexPriority = fromScratchIndexPriority;
    }
    let realm = new Realm(
      {
        url,
        adapter,
        secretSeed: this.realmSecretSeed,
        virtualNetwork: this.virtualNetwork,
        dbAdapter: this.dbAdapter,
        queue: this.queue,
        matrix: {
          url: new URL(this.matrixClient.matrixURL),
          username,
        },
        realmServerMatrixClient: this.matrixClient,
        realmServerURL: this.serverURL.href,
        definitionLookup: this.definitionLookup,
        cardSizeLimitBytes: this.cardSizeLimitBytes,
      },
      Object.keys(realmOptions).length ? realmOptions : undefined,
    );
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
          let existingRealm = this.realms.find((realm) => realm.url === url);
          if (existingRealm) {
            realms.push(existingRealm);
            continue;
          }
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
            realmServerURL: this.serverURL.href,
            definitionLookup: this.definitionLookup,
            cardSizeLimitBytes: this.cardSizeLimitBytes,
          });
          this.virtualNetwork.mount(realm.handle);
          realms.push(realm);
        }
      }
    }

    let publishedRealms = await this.findPublishedRealms();
    return [...realms, ...publishedRealms];
  }

  private async findPublishedRealms() {
    let realms = [];
    try {
      this.log.info('Loading published realms…');

      let publishedRealms = (
        await query(this.dbAdapter, [
          `SELECT * FROM published_realms ORDER BY published_realm_url`,
        ])
      ).map((row) => ({
        id: row.id as string,
        owner_username: row.owner_username as string,
        source_realm_url: row.source_realm_url as string,
        published_realm_url: row.published_realm_url as string,
      }));

      this.log.info(
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

        this.log.info(
          `No ${PUBLISHED_DIRECTORY_NAME} directory found, skipping published realms`,
        );
        return [];
      }

      this.log.info(
        `Scanning ${PUBLISHED_DIRECTORY_NAME} directory: ${publishedDir}`,
      );

      let foundDirectories = new Set<string>();
      let publishedDirContents = readdirSync(publishedDir, {
        withFileTypes: true,
      });

      this.log.info(
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

          let existingRealm = this.realms.find(
            (realm) => realm.url === publishedRealmUrl,
          );
          if (existingRealm) {
            realms.push(existingRealm);
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
            realmServerURL: this.serverURL.href,
            definitionLookup: this.definitionLookup,
            cardSizeLimitBytes: this.cardSizeLimitBytes,
          });

          this.virtualNetwork.mount(realm.handle);
          realms.push(realm);

          this.log.info(
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

      this.log.info(
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

  private sendEvent = async (
    user: string,
    eventType: string,
    data?: Record<string, any>,
  ) => {
    let roomId = await fetchSessionRoom(
      this.dbAdapter,
      REALM_SERVER_REALM,
      user,
    );
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
