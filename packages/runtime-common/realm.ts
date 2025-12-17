import { Deferred } from './deferred';
import {
  makeCardTypeSummaryDoc,
  transformResultsToPrerenderedCardsDoc,
  type SingleCardDocument,
} from './document-types';
import { isMeta, type CardResource } from './resource-types';
import type { LocalPath } from './paths';
import { RealmPaths, ensureTrailingSlash, join } from './paths';
import { persistFileMeta, removeFileMeta, getCreatedTime } from './file-meta';
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
  CardError,
  formattedError,
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
  fetchRealmPermissions,
  baseRealm,
  maybeURL,
  insertPermissions,
  maybeHandleScopedCSSRequest,
  authorizationMiddleware,
  internalKeyFor,
  query,
  param,
  isValidPrerenderedHtmlFormat,
  type CodeRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
  type DBAdapter,
  type QueuePublisher,
  type FileMeta,
  type DirectoryMeta,
  type ResolvedCodeRef,
  type FieldDefinition,
  type RealmPermissions,
  type RealmAction,
  type LintArgs,
  type LintResult,
  codeRefWithAbsoluteURL,
  userInitiatedPriority,
  systemInitiatedPriority,
  userIdFromUsername,
  isCardDocumentString,
  isBrowserTestEnv,
} from './index';
import { visitModuleDeps } from './code-ref';
import merge from 'lodash/merge';
import mergeWith from 'lodash/mergeWith';
import cloneDeep from 'lodash/cloneDeep';
import { z } from 'zod';
import type { CardFields } from './resource-types';
import {
  fileContentToText,
  readFileAsText,
  getFileWithFallbacks,
  type TextFileRef,
} from './stream';
import { transpileJS } from './transpile';
import type { Method, RouteTable } from './router';
import {
  AuthenticationError,
  AuthenticationErrorMessages,
  AuthorizationError,
  Router,
  SupportedMimeType,
  lookupRouteTable,
} from './router';
import { InvalidQueryError, assertQuery, parseQuery } from './query';
import type { Readable } from 'stream';
import { createResponse } from './create-response';
import { mergeRelationships } from './merge-relationships';
import { getCardDirectoryName } from './helpers/card-directory-name';
import {
  MatrixClient,
  ensureFullMatrixUserId,
  getMatrixUsername,
} from './matrix-client';
import { PACKAGES_FAKE_ORIGIN } from './package-shim-handler';

import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import RealmPermissionChecker from './realm-permission-checker';
import type { ResponseWithNodeStream, VirtualNetwork } from './virtual-network';

import { RealmAuthDataSource } from './realm-auth-data-source';
import { AliasCache } from './cache/alias-cache';
import { fetcher } from './fetcher';
import { RealmIndexQueryEngine } from './realm-index-query-engine';
import { RealmIndexUpdater } from './realm-index-updater';
import serialize from './file-serializer';

import type { Utils } from './matrix-backend-authentication';
import { MatrixBackendAuthentication } from './matrix-backend-authentication';

import type {
  RealmEventContent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import type {
  AtomicOperation,
  AtomicOperationResult,
  AtomicPayloadValidationError,
} from './atomic-document';
import { filterAtomicOperations } from './atomic-document';
import {
  isFilterRefersToNonexistentTypeError,
  type DefinitionLookup,
} from './definition-lookup';
import {
  fetchSessionRoom,
  upsertSessionRoom,
} from './db-queries/session-room-queries';
import {
  analyzeRealmPublishability,
  type ResourceIndexEntry,
} from './publishability';

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
  interactHome: string | null;
  hostHome: string | null;
  visibility: RealmVisibility;
  realmUserId?: string;
  publishable: boolean | null;
  lastPublishedAt: string | Record<string, string> | null;
};

const PROTECTED_REALM_CONFIG_PROPERTIES = ['showAsCatalog'];

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;

  [key: symbol]: object;
}

const CACHE_HEADER = 'X-Boxel-Cache';
const CACHE_HIT_VALUE = 'hit';
const CACHE_MISS_VALUE = 'miss';
const MODULE_ETAG_VARIANT = 'module';
const SOURCE_ETAG_VARIANT = 'source';

type CachedSourceFileEntry = {
  type: 'file';
  ref: FileRef;
  defaultHeaders: Record<string, string>;
  canonicalPath: LocalPath;
};

type CachedSourceRedirectEntry = {
  type: 'redirect';
  status: number;
  headers: Record<string, string>;
  canonicalPath: LocalPath;
};

type SourceCacheEntry = CachedSourceFileEntry | CachedSourceRedirectEntry;

type ModuleCacheEntry = {
  canonicalPath: LocalPath;
  body: string;
  headers: Record<string, string>;
};

type ModuleLoadResult =
  | { kind: 'not-found'; response: ResponseWithNodeStream }
  | { kind: 'non-module'; response: ResponseWithNodeStream }
  | { kind: 'shimmed'; response: ResponseWithNodeStream }
  | {
      kind: 'not-modified';
      canonicalPath: LocalPath;
      headers: Record<string, string>;
    }
  | {
      kind: 'module';
      canonicalPath: LocalPath;
      body: string;
      headers: Record<string, string>;
    };

function buildEtag(
  lastModified: number | undefined,
  variant?: string,
): string | undefined {
  if (lastModified == null) {
    return undefined;
  }
  let base = String(lastModified);
  return variant ? `${base}:${variant}` : base;
}

export interface TokenClaims {
  user: string;
  realm: string;
  sessionRoom: string;
  permissions: RealmPermissions['user'];
}

export interface AdapterWriteResult {
  path: string;
  lastModified: number;
}

export interface FileWriteResult extends AdapterWriteResult {
  path: string;
  lastModified: number;
  created: number | null;
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

  write(path: LocalPath, contents: string): Promise<AdapterWriteResult>;

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

  broadcastRealmEvent(
    event: RealmEventContent,
    realmUrl: string,
    matrixClient: MatrixClient,
    dbAdapter: DBAdapter,
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
  fromScratchIndexPriority?: number;
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
  #fromScratchIndexPriority = systemInitiatedPriority;
  #realmServerMatrixUserId: string;
  #definitionLookup: DefinitionLookup;
  #copiedFromRealm: URL | undefined;
  #sourceCache = new AliasCache<SourceCacheEntry>();
  #moduleCache = new AliasCache<ModuleCacheEntry>();

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
  readonly __fetchForTesting: typeof globalThis.fetch;
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
      definitionLookup,
    }: {
      url: string;
      adapter: RealmAdapter;
      matrix: MatrixConfig;
      secretSeed: string;
      dbAdapter: DBAdapter;
      queue: QueuePublisher;
      virtualNetwork: VirtualNetwork;
      realmServerMatrixClient: MatrixClient;
      definitionLookup: DefinitionLookup;
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
    this.#fromScratchIndexPriority =
      opts?.fromScratchIndexPriority ?? systemInitiatedPriority;
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
    this.#copiedFromRealm = opts?.copiedFromRealm;
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

    // Wrap to retain realm context for definition lookups
    this.#definitionLookup = definitionLookup.forRealm(this);

    this.__fetchForTesting = _fetch;

    this.#realmIndexUpdater = new RealmIndexUpdater({
      realm: this,
      dbAdapter,
      queue,
    });
    this.#realmIndexQueryEngine = new RealmIndexQueryEngine({
      realm: this,
      dbAdapter,
      fetch: _fetch,
      definitionLookup: this.#definitionLookup,
    });

    this.#router = new Router(new URL(url))
      .get('/_info', SupportedMimeType.RealmInfo, this.realmInfo.bind(this))
      .patch(
        '/_config',
        SupportedMimeType.JSON,
        this.patchRealmConfig.bind(this),
      )
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
        SupportedMimeType.JSONAPI,
        this.getDependencies.bind(this),
      )
      .get(
        '/_publishability',
        SupportedMimeType.JSONAPI,
        this.publishability.bind(this),
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

  async ensureSessionRoom(matrixUserId: string): Promise<string> {
    let sessionRoom = await fetchSessionRoom(
      this.#dbAdapter,
      this.url,
      matrixUserId,
    );

    if (!sessionRoom) {
      await this.#matrixClient.login();
      sessionRoom = await this.#matrixClient.createDM(matrixUserId);
      await upsertSessionRoom(
        this.#dbAdapter,
        this.url,
        matrixUserId,
        sessionRoom,
      );
    }

    return sessionRoom;
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

  async fullIndex(priority?: number) {
    await this.realmIndexUpdater.fullIndex(priority);
  }

  async flushUpdateEvents() {
    return this.#flushUpdateEvents;
  }

  __testOnlyClearCaches() {
    this.#sourceCache.clear();
    this.#moduleCache.clear();
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
    let urls: URL[] = [];
    // Collect write results for all files we wrote
    let results: { path: LocalPath; lastModified: number }[] = [];
    let fileMetaRows: { path: LocalPath }[] = [];
    let lastWriteType: 'module' | 'instance' | undefined;
    let invalidations: Set<string> = new Set();
    let clientRequestId: string | null = options?.clientRequestId ?? null;
    let performIndex = async () => {
      await this.#realmIndexUpdater.update(urls, {
        clientRequestId,
        onInvalidation: async (invalidatedURLs: URL[]) => {
          await this.handleExecutableInvalidations(invalidatedURLs);
          invalidations = new Set([
            ...invalidations,
            ...invalidatedURLs.map((u) => u.href),
          ]);
        },
      });
    };

    for (let [path, content] of files) {
      let url = this.paths.fileURL(path);
      let currentWriteType: 'module' | 'instance' | undefined =
        hasExecutableExtension(path)
          ? 'module'
          : path.endsWith('.json') && isCardDocumentString(content)
            ? 'instance'
            : undefined;
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
        if (
          e.message?.includes?.('not found') ||
          isFilterRefersToNonexistentTypeError(e)
        ) {
          throw e;
        }
      }
      let existingFile = await readFileAsText(path, (p) =>
        this.#adapter.openFile(p),
      );
      if (existingFile?.content === content) {
        results.push({ path, lastModified: existingFile.lastModified });
        fileMetaRows.push({ path });
        continue;
      }
      if (lastWriteType === 'module' && currentWriteType === 'instance') {
        // we need to generate/update possible definition in order for
        // instance file serialization that may depend on the included module to
        // work. TODO: we could be more precise here and keep track of what
        // modules the instances depend on and only flush the modules to index
        // when you you see that you have an instance that you are about to
        // write to disk that depends on a module that is part of this
        // operation.
        await performIndex();
        urls = [];
      }
      this.sendIndexInitiationEvent(url.href);
      await this.trackOwnWrite(path);
      let { lastModified } = await this.#adapter.write(path, content);
      this.#sourceCache.invalidate(path);
      if (hasExecutableExtension(path)) {
        this.#moduleCache.invalidate(path);
      }
      results.push({ path, lastModified });
      fileMetaRows.push({ path });
      urls.push(url);
      lastWriteType = currentWriteType ?? lastWriteType;
    }

    // persist file meta (created_at) to DB independent of index and retrieve created
    let createdMap = await this.persistFileMeta(fileMetaRows);
    if (urls.length > 0) {
      await performIndex();
    }
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [...invalidations],
      clientRequestId,
    });
    return results.map(({ path, lastModified }) => ({
      path,
      lastModified,
      created: createdMap.get(path) ?? null,
    }));
  }

  // persist created_at into realm_file_meta table using db adapter
  private async persistFileMeta(
    rows: { path: LocalPath }[],
  ): Promise<Map<LocalPath, number>> {
    if (!this.#dbAdapter || rows.length === 0) return new Map();
    const createdMap = await persistFileMeta(
      this.#dbAdapter,
      this.url,
      rows.map((r) => r.path),
    );
    // maintain LocalPath typing on keys
    return new Map(
      Array.from(createdMap.entries()).map(([p, c]) => [p as LocalPath, c]),
    );
  }

  // remove file meta rows for deleted paths
  private async removeFileMeta(paths: LocalPath[]): Promise<void> {
    if (!this.#dbAdapter || paths.length === 0) return;
    await removeFileMeta(this.#dbAdapter, this.url, paths);
  }

  private lowestStatusCode(errors: AtomicPayloadValidationError[]): number {
    let statuses = errors
      .map((e) => e.status)
      .filter((status) => typeof status === 'number') as number[];
    return statuses.length > 0 ? Math.min(...statuses) : 400;
  }

  private async checkBeforeAtomicWrite(
    operations: AtomicOperation[],
  ): Promise<AtomicPayloadValidationError[]> {
    let errors: AtomicPayloadValidationError[] = [];
    await Promise.all(
      operations.map(async (operation) => {
        if (
          (operation.op !== 'add' && operation.op !== 'update') ||
          !operation.href
        ) {
          return;
        }

        let localPath: LocalPath;
        try {
          localPath = this.paths.local(new URL(operation.href, this.paths.url));
        } catch (error: any) {
          errors.push({
            title: 'Invalid atomic:operations format',
            detail:
              error?.message ??
              `Request operation contains invalid href '${operation.href}'`,
            status: error?.status ?? 400,
          });
          return;
        }

        let exists = await this.#adapter.exists(localPath);
        if (operation.op === 'add' && exists) {
          errors.push({
            title: 'Resource already exists',
            detail: `Resource ${operation.href} already exists`,
            status: 409,
          });
        } else if (operation.op === 'update' && !exists) {
          errors.push({
            title: 'Resource does not exist',
            detail: `Resource ${operation.href} does not exist`,
            status: 404,
          });
        }
      }),
    );
    return errors;
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
      if (operation.op !== 'add' && operation.op !== 'update') {
        let detail = `You tried to use an unsupported operation type: '${operation.op}'. Only 'add' and 'update' operations are currently supported`;
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
    let atomicOperations = json['atomic:operations'] as AtomicOperation[];
    let atomicCheckErrors = await this.checkBeforeAtomicWrite(atomicOperations);
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

    let operations = filterAtomicOperations(atomicOperations);
    let files = new Map<LocalPath, string>();
    let writeResults: FileWriteResult[] = [];

    for (let operation of operations) {
      let resource = operation.data;
      let href = operation.href;
      let localPath = this.paths.local(new URL(href, this.paths.url));
      let exists = await this.#adapter.exists(localPath);
      if (operation.op === 'add' && exists) {
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                title: 'Resource already exists',
                detail: `Resource ${href} already exists`,
                status: 409,
              },
            ],
          }),
          init: {
            status: 409,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
          requestContext,
        });
      }
      if (operation.op === 'update' && !exists) {
        return createResponse({
          body: JSON.stringify({
            errors: [
              {
                title: 'Resource does not exist',
                detail: `Resource ${href} does not exist`,
                status: 404,
              },
            ],
          }),
          init: {
            status: 404,
            headers: { 'content-type': SupportedMimeType.JSONAPI },
          },
          requestContext,
        });
      }
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
    this.#sourceCache.invalidate(path);
    if (hasExecutableExtension(path)) {
      this.#moduleCache.invalidate(path);
    }
    // Remove file meta for this path
    await this.removeFileMeta([path]);
    await this.#realmIndexUpdater.update([url], {
      delete: true,
      onInvalidation: async (invalidatedURLs: URL[]) => {
        await this.handleExecutableInvalidations(invalidatedURLs);
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: invalidatedURLs.map((u) => u.href),
        });
      },
    });
  }

  async deleteAll(paths: LocalPath[]): Promise<void> {
    let urls: URL[] = [];
    let trackPromises: Promise<void>[] = [];
    let removePromises: Promise<void>[] = [];

    for (let path of paths) {
      let url = this.paths.fileURL(path);
      urls.push(url);
      this.sendIndexInitiationEvent(url.href);
      trackPromises.push(this.trackOwnWrite(path, { isDelete: true }));
      removePromises.push(this.#adapter.remove(path));
      this.#sourceCache.invalidate(path);
      if (hasExecutableExtension(path)) {
        this.#moduleCache.invalidate(path);
      }
    }

    await Promise.all(trackPromises);
    await Promise.all(removePromises);
    // Remove file meta for all deleted paths
    await this.removeFileMeta(paths);
    await this.#realmIndexUpdater.update(urls, {
      delete: true,
      onInvalidation: async (invalidatedURLs: URL[]) => {
        await this.handleExecutableInvalidations(invalidatedURLs);
        this.broadcastRealmEvent({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: invalidatedURLs.map((u) => u.href),
        });
      },
    });
  }

  get realmIndexUpdater() {
    return this.#realmIndexUpdater;
  }

  get realmIndexQueryEngine() {
    return this.#realmIndexQueryEngine;
  }

  async reindex() {
    await this.#realmIndexUpdater.fullIndex();
    await this.#definitionLookup.invalidate(this.url);
    this.#moduleCache.clear();
    this.broadcastRealmEvent({
      eventName: 'index',
      indexType: 'full',
    });
  }

  async #startup() {
    await Promise.resolve();
    let startTime = Date.now();
    if (this.#copiedFromRealm) {
      await this.#realmIndexUpdater.copy(this.#copiedFromRealm);
      this.broadcastRealmEvent({
        eventName: 'index',
        indexType: 'copy',
        sourceRealmURL: this.#copiedFromRealm.href,
      });
    } else {
      let isNewIndex = await this.#realmIndexUpdater.isNewIndex();
      if (isNewIndex || this.#fullIndexOnStartup) {
        let promise = this.#realmIndexUpdater.fullIndex(
          this.#fromScratchIndexPriority,
        );
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
    let permissions = await fetchRealmPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );

    let userIds = Object.entries(permissions)
      .filter(([_, realmActions]) => realmActions.includes('realm-owner'))
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
              sessionRoom,
              permissions: userPermissions,
              realm: this.url,
            },
            '7d',
            this.#realmSecretSeed,
          );
        },
        ensureSessionRoom: async (userId: string) =>
          this.ensureSessionRoom(userId),
        setSessionRoom: (userId: string, roomId: string) =>
          upsertSessionRoom(this.#dbAdapter, this.url, userId, roomId),
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
    let localPath = this.paths.local(new URL(request.url));

    try {
      if (!isLocal) {
        let requiredPermission: RealmAction;
        if (
          ['_permissions'].includes(localPath) ||
          (localPath === '_config' && request.method === 'PATCH')
        ) {
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
    let moduleCachingDisabled =
      this.#disableModuleCaching ||
      Boolean(request.headers.get('X-Boxel-Disable-Module-Cache'));

    if (!moduleCachingDisabled) {
      let cached = this.#moduleCache.get(localPath);
      if (cached) {
        try {
          let etag = cached.headers.etag;
          if (etag && request.headers.get('if-none-match') === etag) {
            let headers: Record<string, string> = {
              [CACHE_HEADER]: CACHE_HIT_VALUE,
            };
            for (let [key, value] of Object.entries(cached.headers)) {
              if (key.toLowerCase() === 'content-type') {
                continue;
              }
              headers[key] = value;
            }
            return createResponse({
              body: null,
              init: {
                status: 304,
                headers,
              },
              requestContext,
            });
          }

          return createResponse({
            body: cached.body,
            init: {
              status: 200,
              headers: {
                ...cached.headers,
                [CACHE_HEADER]: CACHE_HIT_VALUE,
              },
            },
            requestContext,
          });
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
    }

    let response: ResponseWithNodeStream;
    try {
      let result = await this.loadModuleFromDisk(
        localPath,
        request,
        requestContext,
      );
      switch (result.kind) {
        case 'module': {
          if (!moduleCachingDisabled) {
            this.#moduleCache.set(localPath, {
              canonicalPath: result.canonicalPath,
              body: result.body,
              headers: result.headers,
            });
          }
          response = createResponse({
            body: result.body,
            init: {
              status: 200,
              headers: {
                ...result.headers,
                [CACHE_HEADER]: CACHE_MISS_VALUE,
              },
            },
            requestContext,
          });
          break;
        }
        case 'not-modified': {
          response = createResponse({
            body: null,
            init: {
              status: 304,
              headers: {
                ...result.headers,
                [CACHE_HEADER]: CACHE_MISS_VALUE,
              },
            },
            requestContext,
          });
          break;
        }
        case 'not-found':
        case 'non-module':
        case 'shimmed': {
          response = result.response;
          break;
        }
      }
    } catch (err) {
      this.#logRequestPerformance(request, start, 'cache miss');
      return this.moduleErrorResponse(url.href, err, requestContext);
    }

    this.#logRequestPerformance(request, start, 'cache miss');
    return response;
  }
  private async loadModuleFromDisk(
    localPath: LocalPath,
    request: Request,
    requestContext: RequestContext,
  ): Promise<ModuleLoadResult> {
    let maybeFileRef = await this.getFileWithFallbacks(
      localPath,
      executableExtensions,
    );
    if (!maybeFileRef) {
      return {
        kind: 'not-found',
        response: notFound(request, requestContext, `${request.url} not found`),
      };
    }

    let fileRef = maybeFileRef;
    if (!hasExecutableExtension(fileRef.path)) {
      return {
        kind: 'non-module',
        response: await this.serveLocalFile(request, fileRef, requestContext),
      };
    }

    if (fileRef[Symbol.for('shimmed-module')]) {
      let response = createResponse({
        requestContext,
        init: {
          headers: {
            'X-Boxel-Canonical-Path': fileRef.path,
          },
        },
      }) as ResponseWithNodeStream;
      (response as any)[Symbol.for('shimmed-module')] =
        fileRef[Symbol.for('shimmed-module')];
      return { kind: 'shimmed', response };
    }

    let etag = buildEtag(fileRef.lastModified, MODULE_ETAG_VARIANT);
    if (etag && request.headers.get('if-none-match') === etag) {
      let headers: Record<string, string> = {
        'cache-control': 'public, max-age=0',
      };
      headers.etag = etag;
      if (fileRef.lastModified != null) {
        headers['last-modified'] = formatRFC7231(fileRef.lastModified * 1000);
      }
      headers['X-Boxel-Canonical-Path'] = fileRef.path;
      return {
        kind: 'not-modified',
        canonicalPath: fileRef.path,
        headers,
      };
    }

    let fileWithContent = await this.materializeFileRef(fileRef);
    let source = await fileContentToText(fileWithContent);
    let transpiled: string;
    try {
      transpiled = await transpileJS(source, fileWithContent.path);
    } catch (err: any) {
      let cardError =
        err instanceof CardError
          ? err
          : new CardError(err?.message ?? 'Module transpilation failed', {
              status: 406,
              title: 'Module transpilation failed',
            });
      cardError.stack = err?.stack ?? cardError.stack;
      throw cardError;
    }

    let headers: Record<string, string> = {
      'content-type': 'text/javascript',
      'cache-control': 'public, max-age=0',
    };
    if (etag) {
      headers.etag = etag;
    }
    if (fileRef.lastModified != null) {
      headers['last-modified'] = formatRFC7231(fileRef.lastModified * 1000);
    }
    headers['X-Boxel-Canonical-Path'] = fileRef.path;

    return {
      kind: 'module',
      canonicalPath: fileRef.path,
      body: transpiled,
      headers,
    };
  }

  private moduleErrorResponse(
    url: string,
    error: unknown,
    requestContext: RequestContext,
  ): Response {
    let cardError =
      error instanceof CardError
        ? error
        : new CardError(
            error instanceof Error ? error.message : String(error),
            { status: 406, title: 'Module transpilation failed' },
          );
    let errorJSON = formattedError(url, undefined, cardError);
    return createResponse({
      body: JSON.stringify(errorJSON),
      init: {
        status: 406,
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  private async serveLocalFile(
    request: Request,
    ref: FileRef,
    requestContext: RequestContext,
    options?: {
      defaultHeaders?: Record<string, string>;
      etagVariant?: string;
    },
  ): Promise<ResponseWithNodeStream> {
    let etag = buildEtag(ref.lastModified, options?.etagVariant);
    if (etag && request.headers.get('if-none-match') === etag) {
      return createResponse({
        body: null,
        init: { status: 304 },
        requestContext,
      });
    }
    let createdFromDb = await this.getCreatedTime(ref.path);
    let headers: Record<string, string> = {
      ...(options?.defaultHeaders || {}),
      'last-modified': formatRFC7231(ref.lastModified * 1000),
      ...(Symbol.for('shimmed-module') in ref
        ? { 'X-Boxel-Shimmed-Module': 'true' }
        : {}),
      ...(etag ? { etag } : {}),
      'cache-control': 'public, max-age=0', // instructs the browser to check with server before using cache
    };
    if (createdFromDb != null) {
      headers['x-created'] = formatRFC7231(createdFromDb * 1000);
    }
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
      this.#log.warn(
        `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) missing auth header`,
      );
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
        this.#log.warn(
          `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), for user ${user} token permissions do not match realm permissions for user. token permissions: ${JSON.stringify(token.permissions?.sort())}, user's realm permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthenticationError(
          AuthenticationErrorMessages.PermissionMismatch,
        );
      }

      if (!(await realmPermissionChecker.can(user, requiredPermission))) {
        this.#log.warn(
          `auth failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}), for user ${user} permissions insufficient. requires ${requiredPermission}, but user permissions: ${JSON.stringify(userPermissions.sort())}`,
        );
        throw new AuthorizationError(
          'Insufficient permissions to perform this action',
        );
      }
    } catch (e: any) {
      if (e instanceof TokenExpiredError) {
        this.#log.warn(
          `JWT verification failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}, expired at ${e.expiredAt}`,
        );
        throw new AuthenticationError(AuthenticationErrorMessages.TokenExpired);
      }
      if (e instanceof JsonWebTokenError) {
        this.#log.warn(
          `JWT verification failed for ${request.method} ${request.url} (accept: ${request.headers.get('accept')}) with token string ${tokenString}. ${e.message}`,
        );
        throw new AuthenticationError(AuthenticationErrorMessages.TokenInvalid);
      }
      throw e;
    }
  }

  private async upsertCardSource(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let { lastModified, created } = await this.write(
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
        headers: {
          'last-modified': formatRFC7231(lastModified * 1000),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  private async getSourceOrRedirect(
    request: Request,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
    let url = new URL(request.url);
    let bypassCache =
      url.searchParams.has('noCache') ||
      (!url.pathname.endsWith('.json') &&
        !hasExecutableExtension(url.pathname));
    let localName = this.paths.local(url);
    if (bypassCache) {
      let cachedEntry = this.#sourceCache.get(localName);
      if (cachedEntry) {
        this.#sourceCache.invalidate(cachedEntry.canonicalPath);
      }
    } else {
      let cached = this.#sourceCache.get(localName);
      if (cached) {
        let start = Date.now();
        try {
          if (cached.type === 'redirect') {
            return createResponse({
              body: null,
              init: {
                status: cached.status,
                headers: {
                  ...cached.headers,
                  [CACHE_HEADER]: CACHE_HIT_VALUE,
                },
              },
              requestContext,
            });
          }
          return await this.serveLocalFile(
            request,
            cached.ref,
            requestContext,
            {
              defaultHeaders: {
                ...cached.defaultHeaders,
                [CACHE_HEADER]: CACHE_HIT_VALUE,
              },
              etagVariant: SOURCE_ETAG_VARIANT,
            },
          );
        } finally {
          this.#logRequestPerformance(request, start, 'cache hit');
        }
      }
    }

    let start = Date.now();
    try {
      let handle = await this.getFileWithFallbacks(localName, [
        ...executableExtensions,
        '.json',
      ]);
      if (!handle) {
        return notFound(request, requestContext, `${localName} not found`);
      }

      if (handle.path !== localName) {
        let headers = {
          Location: `${new URL(this.url).pathname}${handle.path}`,
          [CACHE_HEADER]: CACHE_MISS_VALUE,
        };
        let response = createResponse({
          body: null,
          init: {
            status: 302,
            headers,
          },
          requestContext,
        });
        if (!bypassCache) {
          this.#sourceCache.set(localName, {
            type: 'redirect',
            status: 302,
            headers,
            canonicalPath: handle.path,
          });
        }
        return response;
      }

      let createdAt = await this.getCreatedTime(handle.path);
      let defaultHeaders: Record<string, string> = {
        'content-type': 'text/plain; charset=utf-8',
        ...(createdAt != null
          ? { 'x-created': formatRFC7231(createdAt * 1000) }
          : {}),
        [CACHE_HEADER]: CACHE_MISS_VALUE,
      };
      if (bypassCache) {
        return await this.serveLocalFile(request, handle, requestContext, {
          defaultHeaders,
          etagVariant: SOURCE_ETAG_VARIANT,
        });
      } else {
        let cachedRef = await this.materializeFileRef(handle);
        this.#sourceCache.set(localName, {
          type: 'file',
          ref: cachedRef,
          defaultHeaders,
          canonicalPath: handle.path,
        });
        return await this.serveLocalFile(request, cachedRef, requestContext, {
          defaultHeaders,
          etagVariant: SOURCE_ETAG_VARIANT,
        });
      }
    } finally {
      this.#logRequestPerformance(request, start, 'cache miss');
    }
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

  private cloneFileRefWithContent(
    ref: FileRef,
    content: string | Uint8Array,
  ): FileRef {
    let clone: FileRef = {
      path: ref.path,
      content,
      lastModified: ref.lastModified,
    };
    for (let symbol of Object.getOwnPropertySymbols(ref)) {
      (clone as any)[symbol] = (ref as any)[symbol];
    }
    return clone;
  }

  private async materializeFileRef(ref: FileRef): Promise<FileRef> {
    let content = ref.content;
    if (typeof content === 'string') {
      return this.cloneFileRefWithContent(ref, content);
    }
    if (content instanceof Uint8Array) {
      return this.cloneFileRefWithContent(ref, content);
    }
    if (
      typeof ReadableStream !== 'undefined' &&
      content instanceof ReadableStream
    ) {
      let text = await fileContentToText({ content });
      return this.cloneFileRefWithContent(ref, text);
    }
    if (isNode && typeof (content as any)?.pipe === 'function') {
      let text = await fileContentToText({ content } as Pick<
        FileRef,
        'content'
      >);
      return this.cloneFileRefWithContent(ref, text);
    }
    let text = await fileContentToText(ref);
    return this.cloneFileRefWithContent(ref, text);
  }

  private async handleExecutableInvalidations(
    invalidatedURLs: URL[],
  ): Promise<void> {
    let definitionsInvalidated = false;
    for (const invalidatedURL of invalidatedURLs) {
      if (hasExecutableExtension(invalidatedURL.href)) {
        definitionsInvalidated = true;
        this.#moduleCache.invalidate(this.paths.local(invalidatedURL));
      }
    }
    if (definitionsInvalidated) {
      await this.#definitionLookup.invalidate(this.url);
    }
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
        (resource.meta.realmURL &&
          ensureTrailingSlash(resource.meta.realmURL) !== this.url)
      ) {
        continue;
      }
      let name = getCardDirectoryName(resource.meta?.adoptsFrom, this.paths);

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
    let [{ lastModified, created }] = await this.writeMany(files, {
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
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
        },
      },
      requestContext,
    });
  }

  private async patchCardInstance(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let primarySerialization: LooseSingleCardDocument | undefined;
    let localPath = this.paths.local(new URL(request.url));
    if (localPath.startsWith('_')) {
      return methodNotAllowed(request, requestContext);
    }

    let url = this.paths.fileURL(localPath);
    let instanceURL = url.href.replace(/\.json$/, '');
    let indexEntry = await this.#realmIndexQueryEngine.instance(url, {
      includeErrors: true,
    });
    if (!indexEntry) {
      return notFound(request, requestContext);
    }

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
    let originalClone = cloneDeep(
      indexEntry.instance ?? {
        type: 'card',
        meta: { adoptsFrom: patch.meta.adoptsFrom },
      },
    ) as CardResource;
    originalClone.meta ??= { adoptsFrom: patch.meta.adoptsFrom };
    originalClone.meta.adoptsFrom =
      originalClone.meta.adoptsFrom ?? patch.meta.adoptsFrom;
    delete originalClone.meta.lastModified;

    if (
      originalClone.meta?.adoptsFrom &&
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
      let name = getCardDirectoryName(resource.meta?.adoptsFrom, this.paths);
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
        visitModuleDeps(resource, (moduleURL, setModuleURL) => {
          setModuleURL(new URL(moduleURL, instanceURL).href);
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
      if (i === 0) {
        primarySerialization = fileSerialization;
      }
    }
    let [{ lastModified, created }] = await this.writeMany(files, {
      clientRequestId: request.headers.get('X-Boxel-Client-Request-Id'),
    });
    let entry = await this.#realmIndexQueryEngine.cardDocument(
      new URL(instanceURL),
      {
        loadLinks: true,
      },
    );
    let doc: SingleCardDocument;
    if (!entry || entry?.type === 'error') {
      if (
        primarySerialization &&
        isBrowserTestEnv() &&
        !(globalThis as any).__emulateServerPatchFailure
      ) {
        doc = merge({}, primarySerialization, {
          data: {
            id: instanceURL,
            links: { self: instanceURL },
            meta: {
              ...(primarySerialization.data.meta ?? {}),
              lastModified,
            },
          },
        }) as SingleCardDocument;
      } else {
        return systemError({
          requestContext,
          message: `Unable to index card: can't find patched instance, ${instanceURL} in index`,
          id: instanceURL,
          additionalError: entry
            ? CardError.fromSerializableError(entry.error)
            : undefined,
        });
      }
    } else {
      doc = merge({}, entry.doc, {
        data: {
          links: { self: instanceURL },
          meta: { lastModified },
        },
      });
    }
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: {
          'content-type': SupportedMimeType.CardJson,
          ...lastModifiedHeader(doc),
          ...(created ? { 'x-created': formatRFC7231(created * 1000) } : {}),
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

    let url = this.paths.fileURL(localPath.replace(/\.json$/, ''));
    let maybeError = await this.#realmIndexQueryEngine.cardDocument(url, {
      loadLinks: true,
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

      // Prefer created_at from DB for instance JSON
      let pathForDb = this.paths.local(url) + '.json';
      let createdAt = await this.getCreatedTime(pathForDb);
      return createResponse({
        body: JSON.stringify(card, null, 2),
        init: {
          headers: {
            'content-type': SupportedMimeType.CardJson,
            ...lastModifiedHeader(card),
            ...(createdAt != null
              ? { 'x-created': formatRFC7231(createdAt * 1000) }
              : {}),
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

  // Look up created_at for a given file path from realm_file_meta
  private async getCreatedTime(path: LocalPath): Promise<number | undefined> {
    if (!this.#dbAdapter) return undefined;
    return getCreatedTime(this.#dbAdapter, this.url, path);
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
        let createdFromDb = await this.getCreatedTime(innerPath);
        meta = {
          kind: 'file',
          lastModified: (await this.#adapter.lastModified(innerPath)) ?? null,
          ...(createdFromDb != null
            ? { resourceCreatedAt: createdFromDb }
            : {}),
        } as FileMeta;
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
      // Get source from plain text request body
      const source = await request.text();
      const filename = request.headers.get('X-Filename') || 'input.gts';

      if (!source || source.trim() === '') {
        return createResponse({
          body: JSON.stringify({
            error: 'Empty source code provided',
          }),
          init: {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
          requestContext,
        });
      }

      let job = await this.#queue.publish<LintResult>({
        jobType: `lint-source`,
        concurrencyGroup: `lint:${this.url}:${Math.random().toString().slice(-1)}`,
        timeout: 10,
        priority: userInitiatedPriority,
        args: { source, filename } satisfies LintArgs,
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

  private async getDependencies(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let href = new URL(request.url).search.slice(1);
    let payload = parseQuery(href);
    if (!payload.url) {
      return badRequest({
        message: `The request is missing the url query parameter`,
        requestContext,
      });
    }
    let resourceUrl = Array.isArray(payload.url)
      ? String(payload.url[0])
      : String(payload.url);

    let rows = (await query(this.#dbAdapter, [
      `SELECT url, realm_url, deps FROM boxel_index WHERE (url =`,
      param(resourceUrl),
      `OR file_alias =`,
      param(resourceUrl),
      `) AND (is_deleted IS NULL OR is_deleted = FALSE)`,
    ])) as { url: string; realm_url: string; deps: unknown }[];

    let entries = rows.map((row) => ({
      canonicalUrl: row.url,
      realmUrl: ensureTrailingSlash(row.realm_url),
      dependencies: parseDeps(row.deps),
    }));

    let doc = {
      data: entries.map((entry) => ({
        type: 'dependencies',
        id: entry.canonicalUrl,
        attributes: {
          canonicalUrl: entry.canonicalUrl,
          realmUrl: entry.realmUrl,
          dependencies: entry.dependencies,
        },
      })),
    };

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
  }

  private async publishability(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let sourceRealmURL = ensureTrailingSlash(this.url);
    let resourceEntries = new Map<string, ResourceIndexEntry[]>();
    let visibilityCache = new Map<string, RealmVisibility>();
    let remoteRealmBaseCache = new Map<string, URL>();
    let remoteResourceFetches = new Map<
      string,
      Promise<ResourceIndexEntry[]>
    >();

    let instanceRows = (await query(this.#dbAdapter, [
      `SELECT url FROM boxel_index WHERE realm_url =`,
      param(sourceRealmURL),
      `AND type = 'instance'`,
      `AND (is_deleted IS NULL OR is_deleted = FALSE)`,
    ])) as { url: string }[];

    let rootResources = Array.from(new Set(instanceRows.map((row) => row.url)));

    let queue: string[] = [...rootResources];
    let queued = new Set(queue);

    let resolveRealmVisibility = async (realmUrl: string) => {
      let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
      if (visibilityCache.has(normalizedRealmUrl)) {
        return visibilityCache.get(normalizedRealmUrl)!;
      }

      let visibility: RealmVisibility;
      if (normalizedRealmUrl === sourceRealmURL) {
        visibility = await this.visibility();
      } else {
        let permissions = await fetchRealmPermissions(
          this.#dbAdapter,
          new URL(normalizedRealmUrl),
        );
        if (Object.keys(permissions).length === 0) {
          visibility =
            (await fetchRemoteRealmVisibility(normalizedRealmUrl)) ?? 'private';
        } else {
          let usernames = Object.keys(permissions).filter(
            (username) => !username.startsWith('@realm/'),
          );
          if (usernames.includes('*')) {
            visibility = 'public';
          } else if (usernames.includes('users') || usernames.length > 1) {
            visibility = 'shared';
          } else {
            visibility = 'private';
          }
        }
      }

      visibilityCache.set(normalizedRealmUrl, visibility);
      return visibility;
    };

    let fetchRemoteRealmVisibility = async (
      realmUrl: string,
    ): Promise<RealmVisibility | undefined> => {
      try {
        let infoURL = new URL('_info', realmUrl);
        let response = await this.__fetchForTesting(infoURL, {
          headers: { Accept: SupportedMimeType.RealmInfo },
        });
        if (!response.ok) {
          return undefined;
        }
        let doc = (await response.json()) as {
          data?: { attributes?: { visibility?: RealmVisibility } };
        };
        return doc.data?.attributes?.visibility;
      } catch (error: any) {
        this.#log.warn(
          `failed to fetch remote realm visibility for ${realmUrl}: ${error?.message ?? error}`,
        );
        return undefined;
      }
    };

    let loadLocalResourceEntries = async (
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[]> => {
      if (isGloballyPublicDependency(resourceUrl)) {
        return [];
      }
      let rows = (await query(this.#dbAdapter, [
        `SELECT url, realm_url, deps FROM boxel_index WHERE (url =`,
        param(resourceUrl),
        `OR file_alias =`,
        param(resourceUrl),
        `) AND (is_deleted IS NULL OR is_deleted = FALSE)`,
      ])) as { url: string; realm_url: string; deps: unknown }[];

      if (rows.length === 0) {
        return [];
      }

      return rows.map((row) => ({
        canonicalUrl: row.url,
        realmUrl: ensureTrailingSlash(row.realm_url),
        dependencies: parseDeps(row.deps),
      }));
    };

    let tryFetchRemoteEntriesFromBase = async (
      base: URL,
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[] | undefined> => {
      let endpoint = new URL('_dependencies', base);
      endpoint.searchParams.set('url', resourceUrl);
      let response: Response;
      try {
        response = await this.__fetchForTesting(endpoint, {
          headers: { Accept: SupportedMimeType.JSONAPI },
        });
      } catch (error: any) {
        this.#log.warn(
          `failed to fetch remote resource index for ${resourceUrl} via ${endpoint.href}: ${error?.message ?? error}`,
        );
        return undefined;
      }

      if (response.status === 404) {
        return undefined;
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch remote resource index for ${resourceUrl} (${response.status})`,
        );
      }
      let payload = (await response.json()) as {
        data?: Array<{
          id?: string;
          attributes?: {
            canonicalUrl?: string;
            realmUrl?: string;
            dependencies?: unknown;
          };
        }>;
      };
      let normalized = (payload.data ?? [])
        .map((resource) => {
          let realmUrl = resource.attributes?.realmUrl;
          let canonicalUrl = resource.attributes?.canonicalUrl ?? resource.id;
          if (!realmUrl || !canonicalUrl) {
            return undefined;
          }

          let dependencies = Array.isArray(resource.attributes?.dependencies)
            ? resource.attributes.dependencies.filter(
                (dep): dep is string => typeof dep === 'string',
              )
            : [];

          return {
            canonicalUrl,
            realmUrl: ensureTrailingSlash(realmUrl),
            dependencies,
          };
        })
        .filter((entry): entry is ResourceIndexEntry => Boolean(entry));
      let remoteRealm = normalized[0]?.realmUrl;
      if (remoteRealm) {
        remoteRealmBaseCache.set(remoteRealm, base);
      }
      return normalized;
    };

    let tryFetchUsingKnownRealm = async (resourceUrl: string) => {
      for (let [realmUrl, base] of remoteRealmBaseCache.entries()) {
        if (resourceUrl.startsWith(realmUrl)) {
          return await tryFetchRemoteEntriesFromBase(base, resourceUrl);
        }
      }
      return undefined;
    };

    let fetchRemoteResourceEntries = async (
      resourceUrl: string,
    ): Promise<ResourceIndexEntry[]> => {
      if (isGloballyPublicDependency(resourceUrl)) {
        return [];
      }
      if (remoteResourceFetches.has(resourceUrl)) {
        return remoteResourceFetches.get(resourceUrl)!;
      }
      let fetchPromise = (async () => {
        let existing = await tryFetchUsingKnownRealm(resourceUrl);
        if (existing !== undefined) {
          return existing;
        }
        let parsed = maybeURL(resourceUrl);
        if (!parsed) {
          return [];
        }
        let normalizeToDirectory = (url: URL) =>
          url.pathname.endsWith('/') ? url : new URL('./', url);
        let current = normalizeToDirectory(parsed);
        let visited = new Set<string>();

        while (!visited.has(current.href)) {
          visited.add(current.href);

          let result = await tryFetchRemoteEntriesFromBase(
            current,
            resourceUrl,
          );

          if (result !== undefined) {
            return result;
          }

          let parent = new URL('../', current);

          if (parent.href === current.href) {
            break;
          }

          current = normalizeToDirectory(parent);
        }

        return [];
      })().finally(() => {
        remoteResourceFetches.delete(resourceUrl);
      });
      remoteResourceFetches.set(resourceUrl, fetchPromise);
      return fetchPromise;
    };

    let loadResourceEntries = async (resourceUrl: string) => {
      let entries = await loadLocalResourceEntries(resourceUrl);
      if (
        (entries == null || entries.length === 0) &&
        !isGloballyPublicDependency(resourceUrl) &&
        maybeURL(resourceUrl)
      ) {
        entries = await fetchRemoteResourceEntries(resourceUrl);
      }
      return entries ?? [];
    };

    while (queue.length > 0) {
      let resourceUrl = queue.shift()!;
      queued.delete(resourceUrl);

      if (resourceEntries.has(resourceUrl)) {
        continue;
      }

      let entries = await loadResourceEntries(resourceUrl);

      resourceEntries.set(resourceUrl, entries);
      let canonical = entries[0]?.canonicalUrl;
      if (canonical && !resourceEntries.has(canonical)) {
        resourceEntries.set(canonical, entries);
      }

      if (entries.length === 0) {
        continue;
      }

      for (let entry of entries) {
        await resolveRealmVisibility(ensureTrailingSlash(entry.realmUrl));
        for (let dependency of entry.dependencies) {
          if (!resourceEntries.has(dependency) && !queued.has(dependency)) {
            queue.push(dependency);
            queued.add(dependency);
          }
        }
      }
    }

    await resolveRealmVisibility(sourceRealmURL);

    let result = await analyzeRealmPublishability({
      sourceRealmURL,
      resources: rootResources,
      resourceEntries,
      realmVisibility: visibilityCache,
      isResourceInherentlyPublic: (resourceUrl) =>
        isGloballyPublicDependency(resourceUrl),
    });

    let doc = {
      data: {
        type: 'has-private-dependencies',
        id: sourceRealmURL,
        attributes: {
          publishable: result.publishable,
          realmURL: sourceRealmURL,
          violations: result.violations,
        },
      },
    };

    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      },
      requestContext,
    });
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
    let permissions = await fetchRealmPermissions(
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

    let currentPermissions = await fetchRealmPermissions(
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

  private async getLastPublishedAt(): Promise<
    string | Record<string, string> | null
  > {
    try {
      // First check if this realm is a published realm
      let publishedRealmData = await this.queryPublishedRealm();
      if (publishedRealmData) {
        return publishedRealmData.last_published_at;
      }

      // If not published, check if this is a source realm with published versions
      let publishedVersions = await this.querySourceRealmPublications();
      if (publishedVersions.length > 0) {
        return (
          Object.fromEntries(
            publishedVersions.map((p) => [
              p.published_realm_url,
              p.last_published_at,
            ]),
          ) ?? null
        );
      }

      return null; // Never published
    } catch (error) {
      this.#log.warn(`Failed to get lastPublishedAt: ${error}`);
      return null;
    }
  }

  private async queryPublishedRealm(): Promise<{
    last_published_at: string;
  } | null> {
    try {
      let results = (await query(this.#dbAdapter, [
        `SELECT last_published_at FROM published_realms WHERE published_realm_url =`,
        param(this.url),
      ])) as { last_published_at: string }[];

      return results.length > 0 ? results[0] : null;
    } catch (error) {
      this.#log.warn(`Failed to query published realm: ${error}`);
      return null;
    }
  }

  private async querySourceRealmPublications(): Promise<
    { published_realm_url: string; last_published_at: string }[]
  > {
    try {
      let results = (await query(this.#dbAdapter, [
        `SELECT published_realm_url, last_published_at FROM published_realms WHERE source_realm_url =`,
        param(this.url),
      ])) as { published_realm_url: string; last_published_at: string }[];

      return results;
    } catch (error) {
      this.#log.warn(`Failed to query source realm publications: ${error}`);
      return [];
    }
  }

  private async parseRealmInfo(): Promise<RealmInfo> {
    let fileURL = this.paths.fileURL(`.realm.json`);
    let localPath: LocalPath = this.paths.local(fileURL);
    let realmConfig = await this.readFileAsText(localPath, undefined);
    let lastPublishedAt = await this.getLastPublishedAt();
    let realmInfo = {
      name: 'Unnamed Workspace',
      backgroundURL: null,
      iconURL: null,
      showAsCatalog: null,
      interactHome: null,
      hostHome: null,
      visibility: await this.visibility(),
      realmUserId: ensureFullMatrixUserId(
        this.#matrixClient.getUserId()! || this.#matrixClient.username,
        this.#matrixClient.matrixURL.href,
      ),
      publishable: null,
      lastPublishedAt,
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
        realmInfo.interactHome =
          realmConfigJson.interactHome ?? realmInfo.interactHome;
        realmInfo.hostHome = realmConfigJson.hostHome ?? realmInfo.hostHome;
        realmInfo.realmUserId = ensureFullMatrixUserId(
          realmConfigJson.realmUserId ??
            (this.#matrixClient.getUserId()! || this.#matrixClient.username),
          this.#matrixClient.matrixURL.href,
        );
        realmInfo.publishable =
          realmConfigJson.publishable ?? realmInfo.publishable;
        realmInfo.lastPublishedAt =
          realmConfigJson.lastPublishedAt || realmInfo.lastPublishedAt;
      } catch (e) {
        this.#log.warn(`failed to parse realm config: ${e}`);
      }
    }
    return realmInfo;
  }

  private async patchRealmConfig(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let json: unknown;
    try {
      json = await request.json();
    } catch (e: any) {
      return badRequest({
        message: `The request body was not json: ${e.message}`,
        requestContext,
      });
    }

    const realmConfigPatchSchema = z.object({
      data: z.object({
        type: z.literal('realm-config'),
        attributes: z.record(z.unknown()),
      }),
    });

    let parsed = realmConfigPatchSchema.safeParse(json);
    if (!parsed.success) {
      let message =
        parsed.error.issues.map((issue: any) => issue.message).join(', ') ||
        'The request body was invalid';
      return badRequest({ message, requestContext });
    }

    let { attributes } = parsed.data.data;

    if (Object.keys(attributes).length === 0) {
      return badRequest({
        message: 'At least one property must be provided',
        requestContext,
      });
    }

    let emptyProperty = Object.keys(attributes).find(
      (property) => property.trim().length === 0,
    );
    if (emptyProperty !== undefined) {
      return badRequest({
        message: 'Property names cannot be empty',
        requestContext,
      });
    }

    let protectedProperty = Object.keys(attributes).find((property) =>
      PROTECTED_REALM_CONFIG_PROPERTIES.includes(property),
    );

    if (protectedProperty) {
      return badRequest({
        message: `${protectedProperty} cannot be updated`,
        requestContext,
      });
    }

    let fileURL = this.paths.fileURL(`.realm.json`);
    let realmConfigPath: LocalPath = this.paths.local(fileURL);
    let realmConfig: Record<string, unknown> = {};
    let existingConfig = await this.readFileAsText(realmConfigPath, undefined);
    if (existingConfig?.content) {
      try {
        realmConfig = JSON.parse(existingConfig.content);
      } catch (e: any) {
        return systemError({
          requestContext,
          message: `Unable to parse existing realm config: ${e.message}`,
        });
      }
    }

    Object.assign(realmConfig, attributes);
    let serializedConfig = JSON.stringify(realmConfig, null, 2) + '\n';
    await this.write(realmConfigPath, serializedConfig);

    let realmInfo = await this.parseRealmInfo();
    let doc = {
      data: {
        id: this.url,
        type: 'realm-config',
        attributes: realmInfo,
      },
    };
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.JSON },
      },
      requestContext,
    });
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
    let absoluteCodeRef = codeRefWithAbsoluteURL(
      doc.data.meta.adoptsFrom,
      relativeTo,
    ) as ResolvedCodeRef;
    let definition =
      await this.#definitionLookup.lookupDefinition(absoluteCodeRef);
    if (!definition) {
      throw new Error(
        `Could not find card definition for: ${JSON.stringify(absoluteCodeRef)}`,
      );
    }

    let customFieldDefinitions: Record<string, FieldDefinition> = {};
    if (doc.data.meta?.fields) {
      await this.buildCustomFieldDefinitions(
        doc.data.meta.fields,
        '',
        customFieldDefinitions,
        relativeTo,
      );
    }

    return serialize({
      doc,
      definition,
      relativeTo,
      customFieldDefinitions,
    });
  }

  private async buildCustomFieldDefinitions(
    fields: CardFields,
    basePath: string,
    customFieldDefinitions: Record<string, FieldDefinition>,
    relativeTo: URL,
  ): Promise<void> {
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      const fieldPath = basePath ? `${basePath}.${fieldName}` : fieldName;
      if (isMeta(fieldValue) && fieldValue?.fields) {
        // if we have nested fields, we need to recurse into them
        await this.buildCustomFieldDefinitions(
          fieldValue.fields,
          fieldPath,
          customFieldDefinitions,
          relativeTo,
        );
        continue;
      }
      if (Array.isArray(fieldValue)) {
        for (const item of fieldValue) {
          if (item.adoptsFrom) {
            let absoluteCodeRef = codeRefWithAbsoluteURL(
              item.adoptsFrom,
              relativeTo,
            ) as ResolvedCodeRef;
            let fieldDefinition =
              await this.#definitionLookup.lookupDefinition(absoluteCodeRef);
            if (fieldDefinition) {
              for (const [subFieldName, subFieldDefinition] of Object.entries(
                fieldDefinition.fields,
              )) {
                const prefixedFieldPath = `${fieldPath}.${subFieldName}`;
                customFieldDefinitions[prefixedFieldPath] = subFieldDefinition;
              }
            }
          }
          if (item.fields) {
            await this.buildCustomFieldDefinitions(
              item.fields,
              fieldPath,
              customFieldDefinitions,
              relativeTo,
            );
          }
        }
      } else if (fieldValue.adoptsFrom) {
        let absoluteCodeRef = codeRefWithAbsoluteURL(
          fieldValue.adoptsFrom,
          relativeTo,
        ) as ResolvedCodeRef;
        let fieldDefinition =
          await this.#definitionLookup.lookupDefinition(absoluteCodeRef);
        if (fieldDefinition) {
          for (const [subFieldName, subFieldDefinition] of Object.entries(
            fieldDefinition.fields,
          )) {
            const prefixedFieldPath = `${fieldPath}.${subFieldName}`;
            customFieldDefinitions[prefixedFieldPath] = subFieldDefinition;
          }
        }
        if (fieldValue.fields) {
          await this.buildCustomFieldDefinitions(
            fieldValue.fields,
            fieldPath,
            customFieldDefinitions,
            relativeTo,
          );
        }
      }
    }
  }

  private async startFileWatcher() {
    await this.#adapter.subscribe(async (data) => {
      let tracked = this.getTrackedWrite(data);
      if (!tracked || tracked.isTracked) {
        return;
      }

      let localPath = this.paths.local(tracked.url);
      this.#sourceCache.invalidate(localPath);

      if (hasExecutableExtension(localPath)) {
        this.#moduleCache.invalidate(localPath);
        await this.#definitionLookup.invalidate(this.url);
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
        onInvalidation: async (invalidatedURLs: URL[]) => {
          await this.handleExecutableInvalidations(invalidatedURLs);
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
    this.#adapter.broadcastRealmEvent(
      event,
      this.url,
      this.#matrixClient,
      this.#dbAdapter,
    );
  }

  private async createRequestContext(): Promise<RequestContext> {
    let permissions = {
      [this.#realmServerMatrixUserId]: ['assume-user'] as RealmAction[],
      ...(await fetchRealmPermissions(this.#dbAdapter, new URL(this.url))),
    };
    return {
      realm: this,
      permissions,
    };
  }

  public async visibility(): Promise<RealmVisibility> {
    if (this.visibilityPromise) {
      return this.visibilityPromise;
    }

    this.visibilityPromise = (async () => {
      let permissions = await fetchRealmPermissions(
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

function parseDeps(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch (_e) {
      return [];
    }
  }

  if (value instanceof Buffer) {
    return parseDeps(value.toString());
  }

  if (value instanceof Uint8Array) {
    return parseDeps(Buffer.from(value).toString());
  }

  return [];
}

function isGloballyPublicDependency(resourceUrl: string): boolean {
  if (resourceUrl.startsWith('data:')) {
    return true;
  }
  if (
    resourceUrl.startsWith('@cardstack/boxel-icons') ||
    resourceUrl.startsWith('@cardstack/boxel-ui') ||
    resourceUrl.startsWith('@cardstack/boxel-host/commands') ||
    resourceUrl.startsWith(PACKAGES_FAKE_ORIGIN)
  ) {
    return true;
  }
  let parsed = maybeURL(resourceUrl);
  if (!parsed) {
    return false;
  }
  if (parsed.hostname === 'boxel-icons.boxel.ai') {
    return true;
  }
  if (
    parsed.hostname === 'packages' &&
    (parsed.pathname.startsWith('/@cardstack/boxel-ui') ||
      parsed.pathname.startsWith('/@cardstack/boxel-host/commands'))
  ) {
    return true;
  }
  return baseRealm.inRealm(parsed);
}

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
    let name = getCardDirectoryName(sideLoadedResource.meta?.adoptsFrom, paths);
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
