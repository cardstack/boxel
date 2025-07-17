import { Deferred } from './deferred';
import {
  makeCardTypeSummaryDoc,
  transformResultsToPrerenderedCardsDoc,
  type SingleCardDocument,
} from './document-types';
import { type CardResource } from './resource-types';
import { Loader } from './loader';
import { RealmPaths, LocalPath, join } from './paths';
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
  CardError,
  ErrorDetails,
} from './error';
import { v4 as uuidV4 } from 'uuid';
import { formatRFC7231 } from 'date-fns';
import {
  isCardResource,
  isModuleResource,
  executableExtensions,
  hasExecutableExtension,
  isNode,
  logger,
  fetchUserPermissions,
  insertPermissions,
  maybeHandleScopedCSSRequest,
  authorizationMiddleware,
  internalKeyFor,
  isValidPrerenderedHtmlFormat,
  type CodeRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
  type DBAdapter,
  type QueuePublisher,
  type FileMeta,
  type DirectoryMeta,
  userInitiatedPriority,
  userIdFromUsername,
} from './index';
import merge from 'lodash/merge';
import mergeWith from 'lodash/mergeWith';
import cloneDeep from 'lodash/cloneDeep';
import {
  fileContentToText,
  readFileAsText,
  getFileWithFallbacks,
  type TextFileRef,
} from './stream';
import { transpileJS } from './transpile';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
  AuthorizationError,
  Method,
  RouteTable,
  Router,
  SupportedMimeType,
  lookupRouteTable,
} from './router';
import { InvalidQueryError, assertQuery, parseQuery } from './query';
import type { Readable } from 'stream';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { createResponse } from './create-response';
import { mergeRelationships } from './merge-relationships';
import { MatrixClient, getMatrixUsername } from './matrix-client';

import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import RealmPermissionChecker from './realm-permission-checker';
import type { ResponseWithNodeStream, VirtualNetwork } from './virtual-network';

import { RealmAuthDataSource } from './realm-auth-data-source';
import { fetcher } from './fetcher';
import { RealmIndexQueryEngine } from './realm-index-query-engine';
import { RealmIndexUpdater } from './realm-index-updater';

import {
  MatrixBackendAuthentication,
  Utils,
} from './matrix-backend-authentication';

import type {
  RealmEventContent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import type { LintArgs, LintResult } from './lint';
import {
  AtomicOperation,
  AtomicOperationResult,
  AtomicPayloadValidationError,
  filterAtomicOperations,
} from './atomic-document';

export const REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME = 60 * 60 * 1000;

export interface RealmSession {
  canRead: boolean;
  canWrite: boolean;
}

export type RealmVisibility = 'private' | 'shared' | 'public';

export type RealmInfo = {
  name: string;
  backgroundURL: string | null;
  iconURL: string | null;
  showAsCatalog: boolean | null;
  visibility: RealmVisibility;
  realmUserId?: string;
};

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
  created: number;

  [key: symbol]: object;
}

export interface TokenClaims {
  user: string;
  realm: string;
  sessionRoom: string;
  permissions: RealmPermissions['user'];
}

export type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';

export interface RealmPermissions {
  [username: string]: RealmAction[] | null;
}

export interface FileWriteResult {
  path: string;
  lastModified: number;
  created: number;
  isNew: boolean;
}

export interface WriteOptions {
  clientRequestId?: string | null;
  serializeFile?: boolean | null;
}

export interface RealmAdapter {
  readdir(
    path: LocalPath,
    opts?: {
      create?: true;
    },
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void>;

  openFile(path: LocalPath): Promise<FileRef | undefined>;

  // this should return unix time as it's the finest resolution that we can rely
  // on across all envs
  lastModified(path: LocalPath): Promise<number | undefined>;

  exists(path: LocalPath): Promise<boolean>;

  write(path: LocalPath, contents: string): Promise<FileWriteResult>;

  remove(path: LocalPath): Promise<void>;

  createJWT(claims: TokenClaims, expiration: string, secret: string): string;

  // throws if token cannot be verified or expired
  verifyJWT(
    token: string,
    secret: string,
  ): TokenClaims & { iat: number; exp: number };

  createStreamingResponse(
    req: Request,
    requestContext: RequestContext,
    init: ResponseInit,
    cleanup: () => void,
  ): {
    response: Response;
    writable: WritableStream;
  };

  fileWatcherEnabled: boolean;

  subscribe(cb: (message: UpdateRealmEventContent) => void): Promise<void>;

  unsubscribe(): void;

  setLoader?(loader: Loader): void;

  broadcastRealmEvent(
    event: RealmEventContent,
    matrixClient: MatrixClient,
  ): Promise<void>;

  // optional, set this to override _lint endpoint behavior in tests
  lintStub?(
    request: Request,
    requestContext: RequestContext,
  ): Promise<LintResult>;
}

interface Options {
  disableModuleCaching?: true;
  copiedFromRealm?: URL;
  fullIndexOnStartup?: true;
}

interface UpdateItem {
  operation: 'add' | 'update' | 'removed';
  url: URL;
}

export interface MatrixConfig {
  url: URL;
  username: string;
}

export type RequestContext = { realm: Realm; permissions: RealmPermissions };

export class Realm {
  #startedUp = new Deferred<void>();
  #matrixClient: MatrixClient;
  #realmServerMatrixClient: MatrixClient;
  #realmIndexUpdater: RealmIndexUpdater;
  #realmIndexQueryEngine: RealmIndexQueryEngine;
  #adapter: RealmAdapter;
  #router: Router;
  #log = logger('realm');
  #perfLog = logger('perf');
  #updateItems: UpdateItem[] = [];
  #flushUpdateEvents: Promise<void> | undefined;
  #recentWrites: Map<string, number> = new Map();
  #realmSecretSeed: string;
  #disableModuleCaching = false;
  #fullIndexOnStartup = false;
  #realmServerMatrixUserId: string;

  #publicEndpoints: RouteTable<true> = new Map([
    [
      SupportedMimeType.Session,
      new Map([['POST' as Method, new Map([['/_session', true]])]]),
    ],
    [
      SupportedMimeType.JSONAPI,
      new Map([['GET' as Method, new Map([['/_readiness-check', true]])]]),
    ],
  ]);
  #dbAdapter: DBAdapter;
  #queue: QueuePublisher;

  // This loader is not meant to be used operationally, rather it serves as a
  // template that we clone for each indexing operation
  #loaderTemplate: Loader;
  readonly paths: RealmPaths;

  private visibilityPromise?: Promise<RealmVisibility>;

  get url(): string {
    return this.paths.url;
  }

  constructor(
    {
      url,
      adapter,
      matrix,
      secretSeed,
      dbAdapter,
      queue,
      virtualNetwork,
      realmServerMatrixClient,
    }: {
      url: string;
      adapter: RealmAdapter;
      matrix: MatrixConfig;
      secretSeed: string;
      dbAdapter: DBAdapter;
      queue: QueuePublisher;
      virtualNetwork: VirtualNetwork;
      realmServerMatrixClient: MatrixClient;
    },
    opts?: Options,
  ) {
    this.paths = new RealmPaths(new URL(url));
    let { username, url: matrixURL } = matrix;
    this.#realmSecretSeed = secretSeed;
    this.#dbAdapter = dbAdapter;
    this.#adapter = adapter;
    this.#queue = queue;
    this.#fullIndexOnStartup = opts?.fullIndexOnStartup ?? false;
    this.#realmServerMatrixClient = realmServerMatrixClient;
    this.#realmServerMatrixUserId = userIdFromUsername(
      realmServerMatrixClient.username,
      realmServerMatrixClient.matrixURL.href,
    );
    this.#matrixClient = new MatrixClient({
      matrixURL,
      username,
      seed: secretSeed,
    });
    this.#disableModuleCaching = Boolean(opts?.disableModuleCaching);
    let owner: string | undefined;
    let _fetch = fetcher(virtualNetwork.fetch, [
      // when we run cards directly in node we do so under the authority of the
      // realm server so that we can assume the user that owns this realm. this
      // logic will eventually go away after we refactor to running cards only
      // in headless chrome.
      async (req, next) => {
        if (!owner) {
          owner = await this.getRealmOwnerUserId();
        }
        req.headers.set('X-Boxel-Assume-User', owner);
        req.headers.set('X-Boxel-Disable-Module-Cache', 'true');
        return next(req);
      },
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
      async (request, next) => {
        if (!this.paths.inRealm(new URL(request.url))) {
          return next(request);
        }
        return await this.internalHandle(request, true);
      },
      authorizationMiddleware(
        // ditto with above, we run cards under the authority of the realm
        // server so that we can assume user that owns this realm. refactor this
        // back to using the realm's own matrix client after running cards in
        // headless chrome lands.
        new RealmAuthDataSource(this.#realmServerMatrixClient, () => _fetch),
      ),
    ]);

    let loader = new Loader(_fetch, virtualNetwork.resolveImport);
    adapter.setLoader?.(loader);
    this.#loaderTemplate = loader;

    this.#realmIndexUpdater = new RealmIndexUpdater({
      realm: this,
      dbAdapter,
      queue,
    });
    this.#realmIndexQueryEngine = new RealmIndexQueryEngine({
      realm: this,
      dbAdapter,
      fetch: _fetch,
    });

    this.#router = new Router(new URL(url))
      .get('/_info', SupportedMimeType.RealmInfo, this.realmInfo.bind(this))
      .query('/_lint', SupportedMimeType.JSON, this.lint.bind(this))
      .get('/_mtimes', SupportedMimeType.Mtimes, this.realmMtimes.bind(this))
      .get('/_search', SupportedMimeType.CardJson, this.search.bind(this))
      .query('/_search', SupportedMimeType.CardJson, this.search.bind(this))
      .get(
        '/_search-prerendered',
        SupportedMimeType.CardJson,
        this.searchPrerendered.bind(this),
      )
      .query(
        '/_search-prerendered',
        SupportedMimeType.CardJson,
        this.searchPrerendered.bind(this),
      )
      .get(
        '/_types',
        SupportedMimeType.CardTypeSummary,
        this.fetchCardTypeSummary.bind(this),
      )
      .get(
        '/_dependencies',
        SupportedMimeType.CardDependencies,
        this.getCardDependencies.bind(this),
      )
      .post(
        '/_session',
        SupportedMimeType.Session,
        this.createSession.bind(this),
      )
      .get(
        '/_permissions',
        SupportedMimeType.Permissions,
        this.getRealmPermissions.bind(this),
      )
      .patch(
        '/_permissions',
        SupportedMimeType.Permissions,
        this.patchRealmPermissions.bind(this),
      )
      .get(
        '/_readiness-check',
        SupportedMimeType.RealmInfo,
        this.readinessCheck.bind(this),
      )
      .post(
        '/_atomic',
        SupportedMimeType.JSONAPI,
        this.handleAtomicOperations.bind(this),
      )
      .post('(/|/.+/)', SupportedMimeType.CardJson, this.createCard.bind(this))
      .get(
        '/|/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.getCard.bind(this),
      )
      .patch(
        '/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.patchCardInstance.bind(this),
      )
      .delete(
        '/|/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.removeCard.bind(this),
      )
      .post(
        '/.*',
        SupportedMimeType.CardSource,
        this.upsertCardSource.bind(this),
      )
      .head(
        '/.*',
        SupportedMimeType.CardSource,
        this.getSourceOrRedirect.bind(this),
      )
      .get(
        '/.*',
        SupportedMimeType.CardSource,
        this.getSourceOrRedirect.bind(this),
      )
      .delete(
        '/.+',
        SupportedMimeType.CardSource,
        this.removeCardSource.bind(this),
      )
      .get(
        '.*/',
        SupportedMimeType.DirectoryListing,
        this.getDirectoryListing.bind(this),
      );

    Object.values(SupportedMimeType).forEach((mimeType) => {
      if (mimeType !== SupportedMimeType.CardSource) {
        this.#router.head('/.*', mimeType as SupportedMimeType, async () => {
          let requestContext = await this.createRequestContext();
          return createResponse({ init: { status: 200 }, requestContext });
        });
      }
    });
  }

  async logInToMatrix() {
    await this.#matrixClient.login();
  }

  private async readinessCheck(
    _request: Request,
    requestContext: RequestContext,
  ) {
    await this.#startedUp.promise;

    return createResponse({
      body: null,
      init: {
        headers: { 'content-type': 'text/html' },
        status: 200,
      },
      requestContext,
    });
  }

  get loaderTemplate() {
    return this.#loaderTemplate;
  }

  async indexing() {
    return this.#realmIndexUpdater.indexing();
  }

  async start() {
    this.#startedUp.fulfill((() => this.#startup())());

    if (this.#adapter.fileWatcherEnabled) {
      await this.startFileWatcher();
    }

    await this.#startedUp.promise;
  }

  async fullIndex() {
    await this.realmIndexUpdater.fullIndex();
  }

  async flushUpdateEvents() {
    return this.#flushUpdateEvents;
  }

  createJWT(claims: TokenClaims, expiration: string): string {
    return this.#adapter.createJWT(claims, expiration, this.#realmSecretSeed);
  }

  async write(
    path: LocalPath,
    contents: string,
    options?: WriteOptions,
  ): Promise<FileWriteResult> {
    let results = await this._batchWrite(new Map([[path, contents]]), options);
    return results[0];
  }

  async writeMany(
    files: Map<LocalPath, string>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
    return this._batchWrite(files, options);
  }

  private async _batchWrite(
    files: Map<LocalPath, string>,
    options?: WriteOptions,
  ): Promise<FileWriteResult[]> {
    await this.indexing();
    let results: FileWriteResult[] = [];
    let urls: URL[] = [];
    for (let [path, content] of files) {
      let url = this.paths.fileURL(path);
      this.sendIndexInitiationEvent(url.href);
      await this.trackOwnWrite(path);
      try {
        let doc = JSON.parse(content);
        if (isCardResource(doc.data) && options?.serializeFile) {
          let serialized = await this.fileSerialization(
            { data: merge(doc.data, { meta: { realmURL: this.url } }) },
            url,
          );
          content = JSON.stringify(serialized, null, 2);
        }
      } catch (e: any) {
        if (e.message.includes('not found')) {
          throw new Error(e);
        }
      }
      let { lastModified, created, isNew } = await this.#adapter.write(
        path,
        content,
      );
      results.push({ path, lastModified, created, isNew });
      urls.push(url);
    }
    await this.#realmIndexUpdater.update(urls, {
      onInvalidation: (invalidatedURLs: URL[]) => {
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: invalidatedURLs.map((u) => u.href),
          clientRequestId: options?.clientRequestId ?? null,
        });
      },
    });
    return results;
  }

  validate(json: any): AtomicPayloadValidationError[] {
    let operations = json['atomic:operations'];
    let title = 'Invalid atomic:operations format';
    let errors: AtomicPayloadValidationError[] = [];
    if (!operations || !Array.isArray(operations)) {
      let detail = `Request body must contain 'atomic:operations' array`;
      errors.push({
        title,
        detail,
        status: 400,
      });
      return errors;
    }
    for (let operation of operations) {
      if (operation.op !== 'add') {
        let detail = `You tried to use an unsupported operation type: '${operation.op}'. Only 'add' operations are currently supported`;
        errors.push({
          title,
          detail,
          status: 422,
        });
      }
      if (!operation.href) {
        let detail = `Request operation must contain 'href' property`;
        errors.push({
          title,
          detail,
          status: 400,
        });
      }
      if (
        operation.data &&
        !(operation.data.type == 'card' || operation.data.type == 'source')
      ) {
        let detail = `You tried to use an unsupported resource type: '${operation.data.type}'. Only 'card' and 'source' resource types are currently supported`;
        errors.push({
          title,
          detail,
          status: 422,
        });
      }
    }
    return errors;
  }

  // this method carefully checks before writing with the intent of
  // stopping failed operations that depend on others
  private async checkBeforeAtomicWrite(
    operations: AtomicOperation[],
  ): Promise<ErrorDetails[]> {
    let promises = [];
    for (let { href } of operations) {
      let localPath = this.paths.local(new URL(href, this.paths.url));
      promises.push(this.#adapter.exists(localPath));
    }
    let booleanFlags = await Promise.all(promises);
    return operations
      .filter((_, i) => booleanFlags[i])
      .map(({ href }) => {
        return {
          title: 'Resource already exists',
          detail: `Resource ${href} already exists`,
          status: 409,
        };
      });
  }

  private lowestStatusCode(errors: ErrorDetails[]): number {
    let statuses = errors
      .filter((e) => e.status)
      .map((e) => e.status) as number[];
    return Math.min(...statuses);
  }

  private async handleAtomicOperations(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return createResponse({
        body: JSON.stringify({
          errors: [
            {
              title: 'Invalid atomic:operations format',
              detail: `Request body is not valid JSON`,
            },
          ],
        }),
        init: {
          status: 400,
          headers: {
            'content-type': SupportedMimeType.JSONAPI,
          },
        },
        requestContext,
      });
    }
    let validationErrors = this.validate(json);
    if (validationErrors.length > 0) {
      return createResponse({
        body: JSON.stringify({ errors: validationErrors }),
        init: {
          status: 400,
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        }, //consolidate to 400
        requestContext,
      });
    }
    let operations = filterAtomicOperations(json['atomic:operations']);
    let atomicCheckErrors = await this.checkBeforeAtomicWrite(operations);
    if (atomicCheckErrors.length > 0) {
      return createResponse({
        body: JSON.stringify({ errors: atomicCheckErrors }),
        init: {
          status: this.lowestStatusCode(atomicCheckErrors),
          headers: { 'content-type': SupportedMimeType.JSONAPI },
        },
        requestContext,
      });
    }
    let files = new Map<LocalPath, string>();
    let writeResults: FileWriteResult[] = [];

    for (let operation of operations) {
      let resource = operation.data;
      let href = operation.href;
      let localPath = this.paths.local(new URL(href, this.paths.url));
      if (isModuleResource(resource)) {
        files.set(localPath, resource.attributes?.content ?? '');
      } else if (isCardResource(resource)) {
        let doc = {
          data: resource,
        };
        files.set(localPath, JSON.stringify(doc, null, 2));
      } else {
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                status: 400,
                title: 'Invalid resource',
                detail: `Operation data is not a valid card resource or module resource`,
              },
            ],
          }),
          init: {
            status: 400,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
          requestContext,
        });
      }
    }

    if (files.size > 0) {
      try {
        writeResults = await this.writeMany(files, {
          clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
          serializeFile: true,
        });
      } catch (e: any) {
        return createResponse({
          body: JSON.stringify({
            errors: [{ title: 'Write Error', detail: e.message }],
          }),
          init: {
            status: 500,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
          requestContext,
        });
      }
    }

    let results: AtomicOperationResult[] = writeResults.map(
      ({ path, created }) => ({
        data: {
          id: this.paths.fileURL(path).href,
        },
        meta: {
          created,
        },
      }),
    );
    return createResponse({
      body: JSON.stringify({ 'atomic:results': results }, null, 2),
      init: {
        status: 201,
        headers: {
          'content-type': SupportedMimeType.JSONAPI,
        },
      },
      requestContext,
    });
  }

  // we track our own writes so that we can eliminate echoes in the file watcher
  private async trackOwnWrite(path: LocalPath, opts?: { isDelete: true }) {
    let type = opts?.isDelete
      ? 'removed'
      : (await this.#adapter.exists(path))
        ? 'updated'
        : 'added';
    let recentWritesKey = this.constructRecentWritesKey(type, path);
    this.#recentWrites.set(
      recentWritesKey,
      setTimeout(() => {
        this.#recentWrites.delete(recentWritesKey);
      }, 500) as unknown as number, // don't use NodeJS Timeout type
    );
  }

  private constructRecentWritesKey(operation: string, path: string) {
    return `${operation}-${JSON.stringify({ [operation]: path })}`;
  }

  private getTrackedWrite(
    data: UpdateRealmEventContent,
  ): { isTracked: boolean; url: URL } | undefined {
    let file: string;
    let type: string | undefined;
    if ('updated' in data) {
      file = data.updated;
      type = 'updated';
    } else if ('added' in data) {
      file = data.added;
      type = 'added';
    } else if ('removed' in data) {
      file = data.removed;
      type = 'removed';
    } else {
      return;
    }
    let recentWritesKey = this.constructRecentWritesKey(type, file);
    let url = this.paths.fileURL(file);
    let timeout = this.#recentWrites.get(recentWritesKey);
    if (timeout) {
      // This is a best attempt to eliminate an echo here since it's unclear whether this update is one
      // that we wrote or one that was created outside of us
      clearTimeout(timeout);
      this.#recentWrites.delete(recentWritesKey);
      return { isTracked: true, url };
    }
    return { isTracked: false, url };
  }

  async delete(path: LocalPath): Promise<void> {
    let url = this.paths.fileURL(path);
    this.sendIndexInitiationEvent(url.href);
    await this.trackOwnWrite(path, { isDelete: true });
    await this.#adapter.remove(path);
    await this.#realmIndexUpdater.update([url], {
      delete: true,
      onInvalidation: (invalidatedURLs: URL[]) => {
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: invalidatedURLs.map((u) => u.href),
        });
      },
    });
  }

  private get loader() {
    // the current loader used by the search index will contain the latest
    // module updates as we obtain a new loader for each indexing run.
    if (isNode) {
      return this.realmIndexUpdater.loader;
    } else {
      // when we are under test (via browser) we are using a loader that was
      // pre-configured and handed to us which is shared between the host app
      // and the realm. in order for cards to run correctly and instance data
      // buckets not to be smeared across different loaders we need to continue
      // to use the same loader that we were handed in the test setup. Right now
      // we are using `isNode` as a heuristic to determine if we are running in
      // a test. This might need to change in the future if we want the Realm to
      // really run in teh browser in a non testing scenario.
      return this.loaderTemplate;
    }
  }

  __resetLoaderForTest() {
    this.#loaderTemplate = Loader.cloneLoader(this.#loaderTemplate);
  }

  get realmIndexUpdater() {
    return this.#realmIndexUpdater;
  }

  get realmIndexQueryEngine() {
    return this.#realmIndexQueryEngine;
  }

  async reindex() {
    await this.#realmIndexUpdater.fullIndex();
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'full',
    });
  }

  async #startup() {
    await Promise.resolve();
    let startTime = Date.now();
    let isNewIndex = await this.#realmIndexUpdater.isNewIndex();
    if (isNewIndex || this.#fullIndexOnStartup) {
      let promise = this.#realmIndexUpdater.fullIndex();
      if (isNewIndex) {
        // we only await the full indexing at boot if this is a brand new index
        await promise;
      }
      // not sure how useful this event is--nothing is currently listening for
      // it, and it may happen during or after the full index...
      this.broadcastRealmEvent({
        eventName: 'index',
        indexType: 'full',
      });
    }
    this.#perfLog.debug(
      `realm server ${this.url} startup in ${Date.now() - startTime} ms`,
    );
  }

  // TODO get rid of this
  maybeHandle = async (
    request: Request,
  ): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(new URL(request.url))) {
      return null;
    }
    return await this.internalHandle(request, true);
  };

  handle = async (request: Request): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(new URL(request.url))) {
      return null;
    }
    return await this.internalHandle(request, false);
  };

  async getRealmOwnerUserId(): Promise<string> {
    let permissions = await fetchUserPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let userIds = Object.entries(permissions)
      .filter(([_, permissions]) => permissions?.includes('realm-owner'))
      .map(([userId]) => userId);
    if (userIds.length > 1) {
      // we want to use the realm's human owner for the realm and not the bot
      userIds = userIds.filter((userId) => !userId.startsWith('@realm/'));
    }

    let [userId] = userIds;
    // real matrix user ID's always start with an '@', if it doesn't that
    // means we are testing
    if (userId?.startsWith('@')) {
      return userId;
    }
    // hard coded test URLs
    if ((globalThis as any).__environment === 'test') {
      switch (this.url) {
        case 'http://127.0.0.1:4441/':
          return '@base_realm:localhost';
        case 'http://127.0.0.1:4444/':
        case 'http://127.0.0.1:4445/':
        case 'http://127.0.0.1:4445/test/':
        case 'http://127.0.0.1:4446/demo/':
        case 'http://127.0.0.1:4448/':
          return '@node-test_realm:localhost';
        default:
          return '@test_realm:localhost';
      }
    }
    throw new Error(`Cannot determine realm owner for realm ${this.url}.`);
  }

  async getRealmOwnerUsername(): Promise<string> {
    let userId = await this.getRealmOwnerUserId();
    return getMatrixUsername(userId);
  }

  private async createSession(
    request: Request,
    requestContext: RequestContext,
  ) {
    let matrixBackendAuthentication = new MatrixBackendAuthentication(
      this.#matrixClient,
      this.#realmSecretSeed,
      {
        badRequest: function (message: string) {
          return badRequest({ message, requestContext });
        },
        createResponse: function (
          body: BodyInit | null,
          init: ResponseInit | undefined,
        ) {
          return createResponse({
            body,
            init,
            requestContext,
          });
        },
        createJWT: async (user: string, sessionRoom: string) => {
          let permissions = requestContext.permissions;

          let userPermissions = await new RealmPermissionChecker(
            permissions,
            this.#matrixClient,
          ).for(user);
          return this.#adapter.createJWT(
            {
              user,
              realm: this.url,
              sessionRoom,
              permissions: userPermissions,
            },
            '7d',
            this.#realmSecretSeed,
          );
        },
      } as Utils,
    );

    return await matrixBackendAuthentication.createSession(request);
  }

  private async internalHandle(
    request: Request,
    isLocal: boolean,
  ): Promise<ResponseWithNodeStream> {
    let redirectResponse = this.rootRealmRedirect(request);
    if (redirectResponse) {
      return redirectResponse;
    }

    if (
      request.method === 'POST' &&
      request.headers.get('X-HTTP-Method-Override') === 'QUERY'
    ) {
      request = new Request(request.url, {
        method: 'QUERY',
        headers: request.headers,
        body: await request.clone().text(),
      });
      request.headers.delete('X-HTTP-Method-Override');
    }

    let requestContext = await this.createRequestContext(); // Cache realm permissions for the duration of the request so that we don't have to fetch them multiple times

    try {
      // local requests are allowed to query the realm as the index is being built up
      if (!isLocal) {
        if (!request.headers.get('X-Boxel-Building-Index')) {
          let timeout = await Promise.race<void | Error>([
            this.#startedUp.promise,
            new Promise((resolve) =>
              setTimeout(() => {
                resolve(
                  new Error(
                    `Timeout waiting for realm ${this.url} to become ready`,
                  ),
                );
              }, 60 * 1000).unref?.(),
            ),
          ]);
          if (timeout) {
            return new Response(timeout.message, { status: 500 });
          }
        }

        let requiredPermission: RealmAction;
        if (['_permissions'].includes(this.paths.local(new URL(request.url)))) {
          requiredPermission = 'realm-owner';
        } else if (
          ['PUT', 'PATCH', 'POST', 'DELETE'].includes(request.method)
        ) {
          requiredPermission = 'write';
        } else {
          requiredPermission = 'read';
        }
        await this.checkPermission(request, requestContext, requiredPermission);
      }
      if (!this.#realmIndexQueryEngine) {
        return systemError({
          requestContext,
          message: 'search index is not available',
        });
      }
      if (this.#router.handles(request)) {
        return this.#router.handle(request, requestContext);
      } else {
        return this.fallbackHandle(request, requestContext);
      }
    } catch (e) {
      if (e instanceof AuthenticationError) {
        return createResponse({
          body: e.message,
          init: {
            status: 401,
            headers: {
              'X-Boxel-Realm-Url': requestContext.realm.url,
            },
          },
          requestContext,
        });
      }

      if (e instanceof AuthorizationError) {
        return new Response(`${e.message}`, {
          status: 403,
        });
      }

      throw e;
    }
  }

  // Requests for the root of the realm without a trailing slash aren't
  // technically inside the realm (as the realm includes the trailing '/'),
  // so issue a redirect in those scenarios.
  private rootRealmRedirect(request: Request) {
    let url = new URL(request.url);
    let urlWithoutQueryParams = url.protocol + '//' + url.host + url.pathname;
    if (`${urlWithoutQueryParams}/` === this.url) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: String(url.searchParams)
            ? `${this.url}?${url.searchParams}`
            : this.url,
        },
      });
    }
    return undefined;
  }

  private async fallbackHandle(
    request: Request,
    requestContext: RequestContext,
  ) {
    let start = Date.now();
    let url = new URL(request.url);
    let localPath = this.paths.local(url);
    if (
      !this.#disableModuleCaching &&
      !request.headers.get('X-Boxel-Disable-Module-Cache')
    ) {
      let useWorkInProgressIndex = Boolean(
        request.headers.get('X-Boxel-Building-Index'),
      );
      let module = await this.#realmIndexQueryEngine.module(url, {
        useWorkInProgressIndex,
      });
      if (module?.type === 'module') {
        try {
          if (
            module.lastModified != null &&
            request.headers.get('if-none-match') === String(module.lastModified)
          ) {
            return createResponse({
              body: null,
              init: { status: 304 },
              requestContext,
            });
          }

          return createResponse({
            body: module.executableCode,
            init: {
              status: 200,
              headers: {
                'content-type': 'text/javascript',
                ...(module.lastModified != null
                  ? {
                      etag: String(module.lastModified),
                      'cache-control': 'public, max-age=0', // instructs the browser to check with server before using cache
                    }
                  : {}),
              },
            },
            requestContext,
          });
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
      if (module?.type === 'error') {
        try {
          // using "Not Acceptable" here because no text/javascript representation
          // can be made and we're sending text/html error page instead
          return createResponse({
            body: JSON.stringify(module.error, null, 2),
            init: {
              status: 406,
              headers: { 'content-type': 'text/html' },
            },
            requestContext,
          });
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
    }
    return this.serveModuleFromDisk(localPath, start, request, requestContext);
  }
  private async serveModuleFromDisk(
    localPath: LocalPath,
    start: number,
    request: Request,
    requestContext: RequestContext,
  ) {
    try {
      let maybeFileRef = await this.getFileWithFallbacks(
        localPath,
        executableExtensions,
      );
      if (!maybeFileRef) {
        return notFound(request, requestContext, `${request.url} not found`);
      }

      let fileRef = maybeFileRef;
      if (hasExecutableExtension(fileRef.path)) {
        if (fileRef[Symbol.for('shimmed-module')]) {
          // this response is ultimately thrown away and only the symbol value
          // is preserved. so what is inside this response is not important
          let response = createResponse({ requestContext });
          (response as any)[Symbol.for('shimmed-module')] =
            fileRef[Symbol.for('shimmed-module')];
          return response;
        }
        // fallback to the file system only after trying the index. during the
        // initial index we need to use the API to run the indexer whose modules
        // would otherwise live in index (this conundrum would go away if the
        // API could be statically loaded and not come from the base realm.)
        return this.makeJS(
          await fileContentToText(fileRef),
          fileRef.path,
          requestContext,
        );
      }
      return await this.serveLocalFile(request, fileRef, requestContext);
    } finally {
      this.#logRequestPerformance(request, start, 'cache miss');
    }
  }

  private async serveLocalFile(
    request: Request,
    ref: FileRef,
    requestContext: RequestContext,
    options?: {
      defaultHeaders?: Record<string, string>;
    },
  ): Promise<ResponseWithNodeStream> {
    if (
      ref.lastModified != null &&
      request.headers.get('if-none-match') === String(ref.lastModified)
    ) {
      return createResponse({
        body: null,
        init: { status: 304 },
        requestContext,
      });
    }
    let headers = {
      ...(options?.defaultHeaders || {}),
      'x-created': formatRFC7231(ref.created * 1000),
      'last-modified': formatRFC7231(ref.lastModified * 1000),
      ...(Symbol.for('shimmed-module') in ref
        ? { 'X-Boxel-Shimmed-Module': 'true' }
        : {}),
      etag: String(ref.lastModified),
      'cache-control': 'public, max-age=0', // instructs the browser to check with server before using cache
    };
    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === 'string'
    ) {
      return createResponse({
        body: ref.content,
        init: { headers },
        requestContext,
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = createResponse({
      body: null,
      init: { headers },
      requestContext,
    }) as ResponseWithNodeStream;

    response.nodeStream = ref.content;
    return response;
  }

  private async checkPermission(
    request: Request,
    requestContext: RequestContext,
    requiredPermission: 'read' | 'write' | 'realm-owner',
  ) {
    let realmPermissions = requestContext.permissions;
    if (
      requiredPermission !== 'realm-owner' &&
      (lookupRouteTable(this.#publicEndpoints, this.paths, request) ||
        request.method === 'HEAD' ||
        // If the realm is public readable or writable, do not require a JWT
        (requiredPermission === 'read' &&
          realmPermissions['*']?.includes('read')) ||
        (requiredPermission === 'write' &&
          realmPermissions['*']?.includes('write')))
    ) {
      return;
    }

    let authorizationString = request.headers.get('Authorization');
    if (!authorizationString) {
      throw new AuthenticationError(
        AuthenticationErrorMessages.MissingAuthHeader,
      );
    }
    let tokenString = authorizationString.replace('Bearer ', ''); // Parse the JWT

    let token: TokenClaims;

    try {
      token = this.#adapter.verifyJWT(tokenString, this.#realmSecretSeed);

      let realmPermissionChecker = new RealmPermissionChecker(
        realmPermissions,
        this.#matrixClient,
      );

      let user = token.user;
      let assumedUser = request.headers.get('X-Boxel-Assume-User');
      let didAssumeUser = false;
      if (
        assumedUser &&
        (await realmPermissionChecker.can(user, 'assume-user'))
      ) {
        user = assumedUser;
        didAssumeUser = true;
      }

      // if the client is the realm matrix user then we permit all actions
      if (user === this.#matrixClient.getUserId()) {
        return;
      }

      let userPermissions = await realmPermissionChecker.for(user);
      if (
        !didAssumeUser &&
        JSON.stringify(token.permissions?.sort()) !==
          JSON.stringify(userPermissions.sort())
      ) {
        throw new AuthenticationError(
          AuthenticationErrorMessages.PermissionMismatch,
        );
      }

      if (!(await realmPermissionChecker.can(user, requiredPermission))) {
        throw new AuthorizationError(
          'Insufficient permissions to perform this action',
        );
      }
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

  private async upsertCardSource(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let { lastModified } = await this.write(
      this.paths.local(new URL(request.url)),
      await request.text(),
      {
        clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
        serializeFile: false,
      },
    );
    return createResponse({
      body: null,
      init: {
        status: 204,
        headers: { 'last-modified': formatRFC7231(lastModified * 1000) },
      },
      requestContext,
    });
  }

  private async getSourceOrRedirect(
    request: Request,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
    if (!request.headers.get('X-Boxel-Building-Index')) {
      let indexedSource = await this.getSourceFromIndex(new URL(request.url));
      if (indexedSource) {
        let { canonicalURL, lastModified, source } = indexedSource;
        if (request.url !== canonicalURL.href) {
          return createResponse({
            body: null,
            init: {
              status: 302,
              headers: {
                Location: `${new URL(this.url).pathname}${this.paths.local(
                  canonicalURL,
                )}`,
              },
            },
            requestContext,
          });
        }
        return createResponse({
          body: source,
          init: {
            headers: {
              ...(lastModified != null
                ? { 'last-modified': formatRFC7231(lastModified * 1000) }
                : {}),
            },
          },
          requestContext,
        });
      }
    }

    // fallback to file system if there is an error document or this is the
    // first time index
    let localName = this.paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName, [
      ...executableExtensions,
      '.json',
    ]);
    let start = Date.now();
    try {
      if (!handle) {
        return notFound(request, requestContext, `${localName} not found`);
      }

      if (handle.path !== localName) {
        return createResponse({
          body: null,
          init: {
            status: 302,
            headers: {
              Location: `${new URL(this.url).pathname}${handle.path}`,
            },
          },
          requestContext,
        });
      }

      return await this.serveLocalFile(request, handle, requestContext, {
        defaultHeaders: {
          'content-type': 'text/plain; charset=utf-8',
        },
      });
    } finally {
      this.#logRequestPerformance(request, start);
    }
  }

  private async getSourceFromIndex(url: URL): Promise<
    | {
        source: string;
        lastModified: number | null;
        canonicalURL: URL;
      }
    | undefined
  > {
    let [module, instance] = await Promise.all([
      this.#realmIndexQueryEngine.module(url),
      this.#realmIndexQueryEngine.instance(url),
    ]);
    if (module?.type === 'module' || instance?.type === 'instance') {
      let canonicalURL =
        module?.type === 'module'
          ? module.canonicalURL
          : instance?.type === 'instance'
            ? instance.canonicalURL
            : undefined;
      let source =
        module?.type === 'module'
          ? module.source
          : instance?.type === 'instance'
            ? instance.source
            : undefined;
      let lastModified =
        module?.type === 'module'
          ? module.lastModified
          : instance?.type === 'instance'
            ? instance.lastModified
            : null;
      if (canonicalURL == null || source == null) {
        throw new Error(
          `missing 'canonicalURL' and/or 'source' from index entry ${
            url.href
          }, where type is ${
            module?.type === 'module' ? 'module' : 'instance'
          }`,
        );
      }
      return { canonicalURL: new URL(canonicalURL), lastModified, source };
    }
    return undefined;
  }

  private async removeCardSource(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localName = this.paths.local(new URL(request.url));
    let handle = await this.getFileWithFallbacks(localName, [
      ...executableExtensions,
      '.json',
    ]);
    if (!handle) {
      return notFound(request, requestContext, `${localName} not found`);
    }
    await this.delete(handle.path);
    return createResponse({
      body: null,
      init: { status: 204 },
      requestContext,
    });
  }

  private makeJS(
    content: string,
    debugFilename: string,
    requestContext: RequestContext,
  ): Response {
    try {
      content = transpileJS(content, debugFilename);
    } catch (err: any) {
      // using "Not Acceptable" here because no text/javascript representation
      // can be made and we're sending text/html error page instead
      return createResponse({
        body: err.message,
        init: {
          status: 406,
          headers: { 'content-type': 'text/html' },
        },
        requestContext,
      });
    }
    return createResponse({
      body: content,
      init: {
        status: 200,
        headers: { 'content-type': 'text/javascript' },
      },
      requestContext,
    });
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getFileWithFallbacks(
    path: LocalPath,
    fallbackExtensions: string[] = [],
  ): Promise<FileRef | undefined> {
    return getFileWithFallbacks(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      fallbackExtensions,
    );
  }

  private async createCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest({
        message: `Request body is not valid card JSON-API`,
        requestContext,
      });
    }
    let { data: primaryResource, included: maybeIncluded } = json;
    if (!isCardResource(primaryResource)) {
      return badRequest({
        message: `Request body is not valid card JSON-API`,
        requestContext,
      });
    }
    if (maybeIncluded) {
      if (!Array.isArray(maybeIncluded)) {
        return badRequest({
          message: `Request body is not valid card JSON-API: included is not array`,
          requestContext,
        });
      }
      for (let sideLoadedResource of maybeIncluded) {
        if (!isCardResource(sideLoadedResource)) {
          return badRequest({
            message: `Request body is not valid card JSON-API: side-loaded data is not a valid card resource`,
            requestContext,
          });
        }
      }
    }
    let files = new Map<LocalPath, string>();
    let included = (maybeIncluded ?? []) as CardResource[];
    let resources = [primaryResource, ...included];
    let primaryResourceURL: URL | undefined;
    for (let [i, resource] of resources.entries()) {
      if (
        (i > 0 && typeof resource.lid !== 'string') ||
        (resource.meta.realmURL && resource.meta.realmURL !== this.url)
      ) {
        continue;
      }
      let name =
        'name' in resource.meta.adoptsFrom
          ? resource.meta.adoptsFrom.name
          : 'cards';

      let fileURL = this.paths.fileURL(
        `/${join(new URL(request.url).pathname, name, (resource.lid ?? uuidV4()) + '.json')}`,
      );
      if (i === 0) {
        primaryResourceURL = fileURL;
      }

      promoteLocalIdsToRemoteIds({
        resource,
        included,
        realmURL: new URL(this.url),
      });
      let fileSerialization: LooseSingleCardDocument | undefined;
      try {
        fileSerialization = await this.fileSerialization(
          { data: merge(resource, { meta: { realmURL: request.url } }) },
          fileURL,
        );
      } catch (err: any) {
        if (err.message.startsWith('field validation error')) {
          return badRequest({
            message: err.message,
            requestContext,
            lid: resource.lid,
          });
        } else {
          return systemError({
            requestContext,
            message: err.message,
            additionalError: err,
            lid: resource.lid,
          });
        }
      }
      let localPath = this.paths.local(fileURL);
      files.set(localPath, JSON.stringify(fileSerialization, null, 2));
    }
    if (!primaryResourceURL) {
      return systemError({
        requestContext,
        message: `unable to determine URL of the primary resource from request payload`,
        lid: primaryResource.lid,
      });
    }
    let [{ lastModified }] = await this.writeMany(files, {
      clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
    });

    let newURL = primaryResourceURL.href.replace(/\.json$/, '');
    let entry = await this.#realmIndexQueryEngine.cardDocument(
      new URL(newURL),
      {
        loadLinks: true,
      },
    );
    if (!entry || entry?.type === 'error') {
      let err = entry
        ? CardError.fromSerializableError(entry.error)
        : undefined;
      return systemError({
        requestContext,
        message: `Unable to index newly created card: ${newURL}, can't find new instance in index`,
        additionalError: err,
        id: newURL,
      });
    }
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: newURL },
        meta: { lastModified },
      },
    });
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        status: 201,
        headers: {
          'content-type': SupportedMimeType.CardJson,
          ...lastModifiedHeader(doc),
        },
      },
      requestContext,
    });
  }

  private async patchCardInstance(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (localPath.startsWith('_')) {
      return methodNotAllowed(request, requestContext);
    }

    let url = this.paths.fileURL(localPath);
    let instanceURL = url.href.replace(/\.json$/, '');
    let originalMaybeError =
      await this.#realmIndexQueryEngine.cardDocument(url);
    if (!originalMaybeError) {
      return notFound(request, requestContext);
    }
    if (originalMaybeError.type === 'error') {
      return systemError({
        requestContext,
        message: `unable to patch card, cannot load original from index`,
        additionalError: CardError.fromSerializableError(
          originalMaybeError.error,
        ),
        id: instanceURL,
      });
    }
    let { doc: original } = originalMaybeError;
    let originalClone = cloneDeep(original.data);
    delete originalClone.meta.lastModified;

    let { data: patch, included: maybeIncluded } = await request.json();
    if (!isCardResource(patch)) {
      return badRequest({
        message: `The request body was not a card document`,
        requestContext,
      });
    }
    if (maybeIncluded) {
      if (!Array.isArray(maybeIncluded)) {
        return badRequest({
          message: `Request body is not valid card JSON-API: included is not array`,
          requestContext,
        });
      }
      for (let sideLoadedResource of maybeIncluded) {
        if (!isCardResource(sideLoadedResource)) {
          return badRequest({
            message: `Request body is not valid card JSON-API: side-loaded data is not a valid card resource`,
            requestContext,
          });
        }
      }
    }
    if (
      internalKeyFor(patch.meta.adoptsFrom, url) !==
      internalKeyFor(originalClone.meta.adoptsFrom, url)
    ) {
      return badRequest({
        message: `Cannot change card instance type to ${JSON.stringify(
          patch.meta.adoptsFrom,
        )}`,
        requestContext,
        id: instanceURL,
      });
    }
    let included = (maybeIncluded ?? []) as CardResource[];

    delete (patch as any).type;
    delete (patch as any).meta.realmInfo;
    delete (patch as any).meta.realmURL;

    promoteLocalIdsToRemoteIds({
      resource: patch,
      included,
      realmURL: new URL(this.url),
    });

    let primaryResource = mergeWith(
      originalClone,
      patch,
      (_objectValue: any, sourceValue: any) => {
        // a patched array should overwrite the original array instead of merging
        // into an original array, otherwise we won't be able to remove items in
        // the original array
        return Array.isArray(sourceValue) ? sourceValue : undefined;
      },
    );

    if (primaryResource.relationships || patch.relationships) {
      let merged = mergeRelationships(
        primaryResource.relationships,
        patch.relationships,
      );

      if (merged && Object.keys(merged).length !== 0) {
        primaryResource.relationships = merged;
      }
    }

    delete (primaryResource as any).id; // don't write the ID to the file
    let files = new Map<LocalPath, string>();
    let resources = [primaryResource, ...included];
    for (let [i, resource] of resources.entries()) {
      if (
        (i > 0 && typeof resource.lid !== 'string') ||
        (resource.meta.realmURL && resource.meta.realmURL !== this.url)
      ) {
        continue;
      }
      let name =
        'name' in resource.meta.adoptsFrom
          ? resource.meta.adoptsFrom.name
          : 'cards';
      let fileURL =
        i === 0
          ? new URL(`${url}.json`)
          : this.paths.fileURL(
              `/${join(new URL(this.url).pathname, name, (resource.lid ?? uuidV4()) + '.json')}`,
            );
      // we already did this one
      if (i !== 0) {
        promoteLocalIdsToRemoteIds({
          resource,
          included,
          realmURL: new URL(this.url),
        });
      }
      let fileSerialization: LooseSingleCardDocument | undefined;
      try {
        fileSerialization = await this.fileSerialization(
          {
            data: merge(resource, { meta: { realmURL: this.url } }),
          },
          fileURL,
        );
      } catch (err: any) {
        if (err.message.startsWith('field validation error')) {
          return badRequest({
            message: err.message,
            requestContext,
            id: instanceURL,
          });
        } else {
          return systemError({
            requestContext,
            message: err.message,
            additionalError: err,
            id: instanceURL,
          });
        }
      }
      let path = this.paths.local(fileURL);
      files.set(path, JSON.stringify(fileSerialization, null, 2));
    }
    let [{ lastModified }] = await this.writeMany(files, {
      clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
    });
    let entry = await this.#realmIndexQueryEngine.cardDocument(
      new URL(instanceURL),
      {
        loadLinks: true,
      },
    );
    if (!entry || entry?.type === 'error') {
      return systemError({
        requestContext,
        message: `Unable to index card: can't find patched instance, ${instanceURL} in index`,
        id: instanceURL,
        additionalError: entry
          ? CardError.fromSerializableError(entry.error)
          : undefined,
      });
    }
    let doc: SingleCardDocument = merge({}, entry.doc, {
      data: {
        links: { self: instanceURL },
        meta: { lastModified },
      },
    });
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: {
          'content-type': SupportedMimeType.CardJson,
          ...lastModifiedHeader(doc),
        },
      },
      requestContext,
    });
  }

  private async getCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (localPath === '') {
      localPath = 'index';
    }

    let useWorkInProgressIndex = Boolean(
      request.headers.get('X-Boxel-Building-Index'),
    );

    let url = this.paths.fileURL(localPath.replace(/\.json$/, ''));
    let maybeError = await this.#realmIndexQueryEngine.cardDocument(url, {
      loadLinks: true,
      useWorkInProgressIndex,
    });
    let start = Date.now();
    try {
      if (!maybeError) {
        return notFound(request, requestContext);
      }
      if (maybeError.type === 'error') {
        return systemError({
          requestContext,
          message: `cannot return card, ${request.url}, from index: ${maybeError.error.errorDetail.title} - ${maybeError.error.errorDetail.message}`,
          id: request.url,
          additionalError: CardError.fromSerializableError(maybeError.error),
          // This is based on https://jsonapi.org/format/#errors
          body: {
            id: url.href,
            status: maybeError.error.errorDetail.status,
            title: maybeError.error.errorDetail.title,
            message: maybeError.error.errorDetail.message,
            // note that this is actually available as part of the response
            // header too--it's just easier for clients when it is here
            realm: this.url,
            meta: {
              lastKnownGoodHtml: maybeError.error.lastKnownGoodHtml,
              cardTitle: maybeError.error.cardTitle,
              scopedCssUrls: maybeError.error.scopedCssUrls,
              stack: maybeError.error.errorDetail.stack,
            },
          },
        });
      }
      let { doc: card } = maybeError;
      card.data.links = { self: url.href };

      let foundPath = this.paths.local(url);
      if (localPath !== foundPath) {
        return createResponse({
          requestContext,
          body: null,
          init: {
            status: 302,
            headers: { Location: `${new URL(this.url).pathname}${foundPath}` },
          },
        });
      }

      return createResponse({
        body: JSON.stringify(card, null, 2),
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            ...lastModifiedHeader(card),
          },
        },
        requestContext,
      });
    } finally {
      this.#logRequestPerformance(request, start);
    }
  }

  private async removeCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let reqURL = request.url.replace(/\.json$/, '');
    // strip off query params
    let url = new URL(new URL(reqURL).pathname, reqURL);
    let result = await this.#realmIndexQueryEngine.cardDocument(url);
    if (!result) {
      return notFound(request, requestContext);
    }
    let path = this.paths.local(url) + '.json';
    await this.delete(path);
    return createResponse({
      body: null,
      init: { status: 204 },
      requestContext,
    });
  }

  private async directoryEntries(
    url: URL,
  ): Promise<{ name: string; kind: Kind; path: LocalPath }[] | undefined> {
    if (await this.isIgnored(url)) {
      return undefined;
    }
    let path = this.paths.local(url);
    if (!(await this.#adapter.exists(path))) {
      return undefined;
    }
    let entries: { name: string; kind: Kind; path: LocalPath }[] = [];

    for await (let entry of this.#adapter.readdir(path)) {
      let innerPath = join(path, entry.name);
      let innerURL =
        entry.kind === 'directory'
          ? this.paths.directoryURL(innerPath)
          : this.paths.fileURL(innerPath);
      if (await this.isIgnored(innerURL)) {
        continue;
      }
      entries.push(entry);
    }
    return entries;
  }

  private async getDirectoryListing(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = this.paths.local(new URL(request.url));
    let url = this.paths.directoryURL(localPath);
    let entries = await this.directoryEntries(url);
    if (!entries) {
      this.#log.warn(`can't find directory ${url.href}`);
      return notFound(request, requestContext);
    }

    let data: ResourceObjectWithId = {
      id: url.href,
      type: 'directory',
      relationships: {},
    };

    let dir = this.paths.local(url);
    // the entries are sorted such that the parent directory always
    // appears before the children
    entries.sort((a, b) =>
      `/${join(dir, a.name)}`.localeCompare(`/${join(dir, b.name)}`),
    );
    for (let entry of entries) {
      let meta: FileMeta | DirectoryMeta;
      if (entry.kind === 'file') {
        let innerPath = this.paths.local(
          new URL(`${this.paths.directoryURL(dir).href}${entry.name}`),
        );
        meta = {
          kind: 'file',
          lastModified: (await this.#adapter.lastModified(innerPath)) ?? null,
        };
      } else {
        meta = { kind: 'directory' };
      }
      let relationship: DirectoryEntryRelationship = {
        links: {
          related:
            entry.kind === 'directory'
              ? this.paths.directoryURL(join(dir, entry.name)).href
              : this.paths.fileURL(join(dir, entry.name)).href,
        },
        meta,
      };

      data.relationships![
        entry.name + (entry.kind === 'directory' ? '/' : '')
      ] = relationship;
    }

    return createResponse({
      body: JSON.stringify({ data }, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.DirectoryListing },
      },
      requestContext,
    });
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {},
  ): Promise<TextFileRef | undefined> {
    return readFileAsText(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      opts,
    );
  }

  private async isIgnored(url: URL): Promise<boolean> {
    return this.#realmIndexUpdater.isIgnored(url);
  }

  private async search(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let useWorkInProgressIndex = Boolean(
      request.headers.get('X-Boxel-Building-Index'),
    );
    let cardsQuery;
    if (request.method === 'QUERY') {
      cardsQuery = await request.json();
    } else {
      cardsQuery = parseQuery(new URL(request.url).search.slice(1));
    }

    try {
      assertQuery(cardsQuery);
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                status: '400',
                title: 'Invalid Query',
                message: `Invalid query: ${e.message}`,
              },
            ],
          }),
          init: {
            status: 400,
            headers: { 'content-type': SupportedMimeType.CardJson },
          },
          requestContext,
        });
      }
      // Re-throw other errors
      throw e;
    }

    let doc = await this.#realmIndexQueryEngine.search(cardsQuery, {
      loadLinks: true,
      useWorkInProgressIndex,
    });
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.CardJson },
      },
      requestContext,
    });
  }

  private async lint(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let result;
    // eslint does not work well in a browser environment, so our TestRealmAdapter supplies a replaceable stub
    if (this.#adapter.lintStub) {
      result = await this.#adapter.lintStub(request, requestContext);
    } else {
      let source = await request.text();
      let job = await this.#queue.publish<LintResult>({
        jobType: `lint-source`,
        concurrencyGroup: `lint:${this.url}:${Math.random().toString().slice(-1)}`,
        timeout: 10,
        priority: userInitiatedPriority,
        args: { source } satisfies LintArgs,
      });
      result = await job.done;
    }
    return createResponse({
      body: JSON.stringify(result),
      init: {
        headers: { 'content-type': SupportedMimeType.JSON },
      },
      requestContext,
    });
  }

  private async searchPrerendered(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let useWorkInProgressIndex = Boolean(
      request.headers.get('X-Boxel-Building-Index'),
    );

    let payload;
    let htmlFormat;
    let cardUrls;
    let renderType;

    // Handle QUERY method
    if (request.method === 'QUERY') {
      payload = await request.json();
      htmlFormat = payload.prerenderedHtmlFormat;
      cardUrls = payload.cardUrls;
      renderType = payload.renderType;
    } else {
      // Handle GET method (existing logic)
      let href = new URL(request.url).search.slice(1);
      payload = parseQuery(href);
      htmlFormat = payload.prerenderedHtmlFormat;
      cardUrls = payload.cardUrls;
      renderType = payload.renderType;
    }

    if (!isValidPrerenderedHtmlFormat(htmlFormat)) {
      return createResponse({
        body: JSON.stringify({
          errors: [
            {
              status: '400',
              title: 'Bad Request',
              message:
                "Must include a 'prerenderedHtmlFormat' parameter with a value of 'embedded' or 'atom' to use this endpoint",
            },
          ],
        }),
        init: {
          status: 400,
          headers: { 'content-type': SupportedMimeType.CardJson },
        },
        requestContext,
      });
    }

    // prerenderedHtmlFormat and cardUrls are special parameters only for this endpoint
    delete payload.prerenderedHtmlFormat;
    delete payload.cardUrls;
    delete payload.renderType;

    let cardsQuery = payload;

    try {
      assertQuery(cardsQuery);
    } catch (e) {
      if (e instanceof InvalidQueryError) {
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                status: '400',
                title: 'Invalid Query',
                message: `Invalid query: ${e.message}`,
              },
            ],
          }),
          init: {
            status: 400,
            headers: { 'content-type': SupportedMimeType.CardJson },
          },
          requestContext,
        });
      }
      throw e;
    }

    let results = await this.#realmIndexQueryEngine.searchPrerendered(
      cardsQuery,
      {
        useWorkInProgressIndex,
        htmlFormat,
        cardUrls,
        renderType,
        includeErrors: true,
      },
    );

    let doc = transformResultsToPrerenderedCardsDoc(results);

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.CardJson },
      },
      requestContext,
    });
  }

  private async fetchCardTypeSummary(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let results = await this.#realmIndexQueryEngine.fetchCardTypeSummary();

    let doc = makeCardTypeSummaryDoc(results);

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.CardJson },
      },
      requestContext,
    });
  }

  private async getCardDependencies(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let href = new URL(request.url).search.slice(1);
    let payload = parseQuery(href);
    if (!payload.url) {
      return badRequest({
        message: `The request body is missing the url parameter`,
        requestContext,
      });
    }
    let url = Array.isArray(payload.url)
      ? String(payload.url[0])
      : String(payload.url);

    try {
      const deps = await this.#realmIndexQueryEngine.getCardDependencies(
        new URL(url),
      );

      return createResponse({
        body: JSON.stringify(deps, null, 2),
        init: {
          headers: { 'content-type': SupportedMimeType.CardDependencies },
        },
        requestContext,
      });
    } catch (e) {
      if (e instanceof Error) {
        return notFound(request, requestContext);
      }
      throw e;
    }
  }

  private async realmMtimes(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let mtimes: { [path: string]: number } = {};
    let traverse = async (currentPath = '') => {
      const entries = this.#adapter.readdir(currentPath);

      for await (const entry of entries) {
        let innerPath = join(currentPath, entry.name);
        let innerURL =
          entry.kind === 'directory'
            ? this.paths.directoryURL(innerPath)
            : this.paths.fileURL(innerPath);
        if (await this.isIgnored(innerURL)) {
          continue;
        }
        if (entry.kind === 'directory') {
          await traverse(innerPath);
        } else if (entry.kind === 'file') {
          let mtime = await this.#adapter.lastModified(innerPath);
          if (mtime != null) {
            mtimes[innerURL.href] = mtime;
          }
        }
      }
    };

    await traverse();

    return createResponse({
      body: JSON.stringify(
        {
          data: {
            id: this.url,
            type: 'mtimes',
            attributes: {
              mtimes,
            },
          },
        },
        null,
        2,
      ),
      init: {
        headers: { 'content-type': SupportedMimeType.Mtimes },
      },
      requestContext,
    });
  }

  private async getRealmPermissions(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let permissions = await fetchUserPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let doc = {
      data: {
        id: this.url,
        type: 'permissions',
        attributes: { permissions },
      },
    };
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.Permissions },
      },
      requestContext,
    });
  }

  private async patchRealmPermissions(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let json: { data?: { attributes?: { permissions?: RealmPermissions } } };
    try {
      json = await request.json();
    } catch (e: any) {
      return badRequest({
        message: `The request body was not json: ${e.message}`,
        requestContext,
      });
    }
    let patch = json.data?.attributes?.permissions;
    if (!patch) {
      return badRequest({
        message: `The request body was missing permissions`,
        requestContext,
      });
    }
    try {
      assertRealmPermissions(patch);
    } catch (e: any) {
      return badRequest({
        message: `The request body does not specify realm permissions correctly: ${e.message}`,
        requestContext,
      });
    }

    let currentPermissions = await fetchUserPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );
    for (let [user, permissions] of Object.entries(patch)) {
      if (currentPermissions[user]?.includes('realm-owner')) {
        return badRequest({
          message: `cannot modify permissions of the realm owner ${user}`,
          requestContext,
        });
      }
      if (permissions?.includes('realm-owner')) {
        return badRequest({
          message: `cannot create new realm owner ${user}`,
          requestContext,
        });
      }
    }

    await insertPermissions(this.#dbAdapter, new URL(this.url), patch);
    return await this.getRealmPermissions(request, requestContext);
  }

  private async parseRealmInfo(): Promise<RealmInfo> {
    let fileURL = this.paths.fileURL(`.realm.json`);
    let localPath: LocalPath = this.paths.local(fileURL);
    let realmConfig = await this.readFileAsText(localPath, undefined);
    let realmInfo = {
      name: 'Unnamed Workspace',
      backgroundURL: null,
      iconURL: null,
      showAsCatalog: null,
      visibility: await this.visibility(),
      realmUserId:
        this.#matrixClient.getUserId()! || this.#matrixClient.username,
    };
    if (!realmConfig) {
      return realmInfo;
    }

    if (realmConfig) {
      try {
        let realmConfigJson = JSON.parse(realmConfig.content);
        realmInfo.name = realmConfigJson.name ?? realmInfo.name;
        realmInfo.backgroundURL =
          realmConfigJson.backgroundURL ?? realmInfo.backgroundURL;
        realmInfo.iconURL = realmConfigJson.iconURL ?? realmInfo.iconURL;
        realmInfo.showAsCatalog =
          realmConfigJson.showAsCatalog ?? realmInfo.showAsCatalog;
        realmInfo.realmUserId =
          realmConfigJson.realmUserId ??
          (this.#matrixClient.getUserId()! || this.#matrixClient.username);
      } catch (e) {
        this.#log.warn(`failed to parse realm config: ${e}`);
      }
    }
    return realmInfo;
  }

  private async realmInfo(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let realmInfo = await this.parseRealmInfo();

    let doc = {
      data: {
        id: this.url,
        type: 'realm-info',
        attributes: realmInfo,
      },
    };
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.RealmInfo },
      },
      requestContext,
    });
  }

  private async fileSerialization(
    doc: LooseSingleCardDocument,
    relativeTo: URL,
  ): Promise<LooseSingleCardDocument> {
    let api = await this.loader.import<typeof CardAPI>(
      'https://cardstack.com/base/card-api',
    );
    let card = (await api.createFromSerialized(doc.data, doc, relativeTo, {
      ignoreBrokenLinks: true,
    })) as CardDef;
    await api.flushLogs();
    let data: LooseSingleCardDocument = api.serializeCard(card); // this strips out computeds
    delete data.data.id; // the ID is derived from the filename, so we don't serialize it on disk
    delete data.data.lid;
    delete data.included;
    for (let relationship of Object.values(data.data.relationships ?? {})) {
      delete relationship.data;
    }
    return data;
  }

  private async startFileWatcher() {
    await this.#adapter.subscribe((data) => {
      let tracked = this.getTrackedWrite(data);
      if (!tracked || tracked.isTracked) {
        return;
      }
      this.broadcastRealmEvent(data);
      this.#updateItems.push({
        operation: ('added' in data
          ? 'add'
          : 'updated' in data
            ? 'update'
            : 'removed') as UpdateItem['operation'],
        url: tracked.url,
      });
      this.drainUpdates();
    });
  }

  unsubscribe() {
    this.#adapter.unsubscribe();
  }

  private async drainUpdates() {
    await this.#flushUpdateEvents;
    let itemsDrained: () => void;
    this.#flushUpdateEvents = new Promise((res) => (itemsDrained = res));
    let items = [...this.#updateItems];
    this.#updateItems = [];
    for (let { operation, url } of items) {
      this.sendIndexInitiationEvent(url.href);
      await this.#realmIndexUpdater.update([url], {
        onInvalidation: (invalidatedURLs: URL[]) => {
          this.broadcastRealmEvent({
            eventName: 'index',
            indexType: 'incremental',
            invalidations: invalidatedURLs.map((u) => u.href),
          });
        },
        ...(operation === 'removed' ? { delete: true } : {}),
      });
    }
    itemsDrained!();
  }

  private sendIndexInitiationEvent(updatedFile: string) {
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'incremental-index-initiation',
      updatedFile,
    });
  }

  private async broadcastRealmEvent(event: RealmEventContent): Promise<void> {
    this.#adapter.broadcastRealmEvent(event, this.#matrixClient);
  }

  private async createRequestContext(): Promise<RequestContext> {
    let permissions = {
      [this.#realmServerMatrixUserId]: ['assume-user'] as RealmAction[],
      ...(await fetchUserPermissions(this.#dbAdapter, new URL(this.url))),
    };
    return {
      realm: this,
      permissions,
    };
  }

  private async visibility(): Promise<RealmVisibility> {
    if (this.visibilityPromise) {
      return this.visibilityPromise;
    }

    this.visibilityPromise = (async () => {
      let permissions = await fetchUserPermissions(
        this.#dbAdapter,
        new URL(this.url),
      );

      let usernames = Object.keys(permissions).filter(
        (username) => !username.startsWith('@realm/'),
      );
      if (usernames.includes('*')) {
        return 'public';
      } else if (usernames.includes('users')) {
        return 'shared';
      } else if (usernames.length > 1) {
        return 'shared';
      } else {
        return 'private';
      }
    })();

    return this.visibilityPromise;
  }

  #logRequestPerformance(
    request: Request,
    startTime: number,
    prefix = 'serve time',
  ) {
    this.#perfLog.debug(
      `${prefix}: ${Date.now() - startTime}ms - ${request.method} ${
        request.url
      } ${request.headers.get('Accept') ?? ''}`,
    );
  }
}

export type Kind = 'file' | 'directory';

function lastModifiedHeader(
  card: LooseSingleCardDocument,
): {} | { 'last-modified': string } {
  return (
    card.data.meta.lastModified != null
      ? { 'last-modified': formatRFC7231(card.data.meta.lastModified * 1000) }
      : {}
  ) as {} | { 'last-modified': string };
}

export type ErrorReporter = (error: Error) => void;

let globalWithErrorReporter = global as typeof globalThis & {
  __boxelErrorReporter: ErrorReporter;
};

export function setErrorReporter(reporter: ErrorReporter) {
  globalWithErrorReporter.__boxelErrorReporter = reporter;
}

export function reportError(error: Error) {
  if (globalWithErrorReporter.__boxelErrorReporter) {
    globalWithErrorReporter.__boxelErrorReporter(error);
  }
}

export interface CardDefinitionResource {
  id: string;
  type: 'card-definition';
  attributes: {
    cardRef: CodeRef;
  };
  relationships: {
    [fieldName: string]: {
      links: {
        related: string;
      };
      meta: {
        type: 'super' | 'contains' | 'containsMany';
        ref: CodeRef;
      };
    };
  };
}

function promoteLocalIdsToRemoteIds({
  resource,
  realmURL,
  included,
}: {
  resource: CardResource;
  included: CardResource[];
  realmURL: URL;
}) {
  if (!resource.relationships) {
    return;
  }
  let relationships = resource.relationships;

  function makeSelfLink(field: string, lid: string) {
    let sideLoadedResource = included.find((i) => i.lid === lid);
    if (!sideLoadedResource) {
      throw new Error(`Could not find local id ${lid} in "included" resources`);
    }
    if (
      sideLoadedResource.meta.realmURL &&
      sideLoadedResource.meta.realmURL !== realmURL.href
    ) {
      return;
    }
    let name =
      'name' in sideLoadedResource.meta.adoptsFrom
        ? sideLoadedResource.meta.adoptsFrom.name
        : 'cards';
    relationships[field].links = {
      self: paths.fileURL(`${name}/${lid}`).href,
    };
  }

  let paths = new RealmPaths(realmURL);
  for (let [fieldName, value] of Object.entries(resource.relationships)) {
    if ('data' in value && value.data) {
      if (Array.isArray(value.data)) {
        for (let [i, item] of value.data.entries()) {
          if ('lid' in item) {
            makeSelfLink(`${fieldName}.${i}`, item.lid);
          }
        }
      } else if ('lid' in value.data) {
        makeSelfLink(fieldName, value.data.lid);
      }
    }
  }
}

function assertRealmPermissions(
  realmPermissions: any,
): asserts realmPermissions is RealmPermissions {
  if (typeof realmPermissions !== 'object') {
    throw new Error(`permissions must be an object`);
  }
  for (let [user, permissions] of Object.entries(realmPermissions)) {
    if (typeof user !== 'string') {
      throw new Error(`user ${user} must be a string`); // could be a symbol
    }
    if (!Array.isArray(permissions) && permissions !== null) {
      throw new Error(`permissions must be an array or null`);
    }
    if (permissions && permissions.length > 0) {
      for (let permission of permissions) {
        if (!['read', 'write', 'realm-owner'].includes(permission)) {
          throw new Error(`'${permission}' is not a valid permission`);
        }
      }
    }
  }
}
