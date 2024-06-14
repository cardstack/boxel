import { Deferred } from './deferred';
import { SearchIndex } from './search-index';
import { type SingleCardDocument } from './card-document';
import { Loader } from './loader';
import { RealmPaths, LocalPath, join } from './paths';
import {
  systemError,
  notFound,
  methodNotAllowed,
  badRequest,
  CardError,
} from './error';
import { v4 as uuidV4 } from 'uuid';
import { formatRFC7231 } from 'date-fns';
import {
  isCardResource,
  executableExtensions,
  hasExecutableExtension,
  isNode,
  isSingleCardDocument,
  assetsDir,
  logger,
  type CodeRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
  type DBAdapter,
  type Queue,
  type Indexer,
  fetchUserPermissions,
  addAuthorizationHeader,
} from './index';
import merge from 'lodash/merge';
import mergeWith from 'lodash/mergeWith';
import cloneDeep from 'lodash/cloneDeep';
import {
  fileContentToText,
  readFileAsText,
  getFileWithFallbacks,
  writeToStream,
  waitForClose,
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
import { parseQueryString } from './query';
import type { Readable } from 'stream';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { createResponse } from './create-response';
import { mergeRelationships } from './merge-relationships';
import type { LoaderType } from 'https://cardstack.com/base/card-api';
import { MatrixClient, waitForMatrixMessage } from './matrix-client';
import { Sha256 } from '@aws-crypto/sha256-js';

import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import RealmPermissionChecker from './realm-permission-checker';
import type { ResponseWithNodeStream, VirtualNetwork } from './virtual-network';

import { RealmAuthDataSource } from './realm-auth-data-source';

export interface RealmSession {
  canRead: boolean;
  canWrite: boolean;
}

export type RealmInfo = {
  name: string;
  backgroundURL: string | null;
  iconURL: string | null;
};

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
  [key: symbol]: object;
}

export interface TokenClaims {
  user: string;
  realm: string;
  permissions: ('read' | 'write')[];
}

export interface RealmPermissions {
  [username: string]: ('read' | 'write')[];
}

export interface RealmAdapter {
  readdir(
    path: LocalPath,
    opts?: {
      create?: true;
    },
  ): AsyncGenerator<{ name: string; path: LocalPath; kind: Kind }, void>;

  openFile(path: LocalPath): Promise<FileRef | undefined>;

  exists(path: LocalPath): Promise<boolean>;

  write(path: LocalPath, contents: string): Promise<{ lastModified: number }>;

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

  subscribe(cb: (message: UpdateEventData) => void): Promise<void>;

  unsubscribe(): void;

  setLoader?(loader: Loader): void;
}

interface Options {
  deferStartUp?: true;
  useTestingDomain?: true;
}

interface IndexHTMLOptions {
  realmsServed?: string[];
}

interface UpdateItem {
  operation: 'add' | 'update' | 'removed';
  url: URL;
}

type ServerEvents = UpdateEvent | IndexEvent | MessageEvent;

interface UpdateEvent {
  type: 'update';
  data: UpdateEventData;
  id?: string;
}

export interface MatrixConfig {
  url: URL;
  username: string;
  password: string;
}

export type UpdateEventData =
  | FileAddedEventData
  | FileUpdatedEventData
  | FileRemovedEventData;

interface FileAddedEventData {
  added: string;
}
interface FileUpdatedEventData {
  updated: string;
}
interface FileRemovedEventData {
  removed: string;
}

interface IndexEvent {
  type: 'index';
  data: IncrementalIndexEventData | FullIndexEventData;
  id?: string;
  clientRequestId?: string | null;
}
interface IncrementalIndexEventData {
  type: 'incremental';
  invalidations: string[];
  clientRequestId?: string | null;
}
interface FullIndexEventData {
  type: 'full';
}

interface MessageEvent {
  type: 'message';
  data: Record<string, string>;
  id?: string;
}

interface WriteResult {
  lastModified: number;
}

export type RequestContext = { realm: Realm; permissions: RealmPermissions };

export class Realm {
  #startedUp = new Deferred<void>();
  #matrixClient: MatrixClient;
  #searchIndex: SearchIndex;
  #adapter: RealmAdapter;
  #router: Router;
  #deferStartup: boolean;
  #useTestingDomain = false;
  #log = logger('realm');
  #perfLog = logger('perf');
  #startTime = Date.now();
  #getIndexHTML: () => Promise<string>;
  #updateItems: UpdateItem[] = [];
  #flushUpdateEvents: Promise<void> | undefined;
  #recentWrites: Map<string, number> = new Map();
  #realmSecretSeed: string;

  #onIndexer: ((indexer: Indexer) => Promise<void>) | undefined;
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
  #assetsURL: URL;
  #dbAdapter: DBAdapter;

  // This loader is not meant to be used operationally, rather it serves as a
  // template that we clone for each indexing operation
  readonly loaderTemplate: Loader;
  readonly paths: RealmPaths;

  get url(): string {
    return this.paths.url;
  }

  get writableFileExtensions(): string[] {
    // We include .json (card instance data) because we want to allow the
    // card instance data to be overwritten directly (by the code editor) and not go
    // through the card API which tries to fetch the instance data from the index and patch it.
    // The card instance in the index could be broken so we want to have a way to overwrite it directly.
    return [...executableExtensions, '.json'];
  }

  constructor(
    {
      url,
      adapter,
      getIndexHTML,
      matrix,
      realmSecretSeed,
      dbAdapter,
      queue,
      virtualNetwork,
      onIndexer,
      assetsURL,
    }: {
      url: string;
      adapter: RealmAdapter;
      getIndexHTML: () => Promise<string>;
      matrix: MatrixConfig;
      realmSecretSeed: string;
      dbAdapter: DBAdapter;
      queue: Queue;
      virtualNetwork: VirtualNetwork;
      onIndexer?: (indexer: Indexer) => Promise<void>;
      assetsURL: URL;
    },
    opts?: Options,
  ) {
    this.paths = new RealmPaths(new URL(url));
    let { username, password, url: matrixURL } = matrix;
    this.#matrixClient = new MatrixClient(matrixURL, username, password);
    this.#realmSecretSeed = realmSecretSeed;
    this.#getIndexHTML = getIndexHTML;
    this.#useTestingDomain = Boolean(opts?.useTestingDomain);
    this.#assetsURL = assetsURL;

    let loader = virtualNetwork.createLoader();
    adapter.setLoader?.(loader);

    this.loaderTemplate = loader;
    this.loaderTemplate.registerURLHandler(
      addAuthorizationHeader(
        loader,
        new RealmAuthDataSource(
          this.#matrixClient,
          this.loaderTemplate,
          this.url,
        ),
      ),
    );
    this.loaderTemplate.registerURLHandler(this.maybeHandle.bind(this));

    this.#adapter = adapter;
    this.#onIndexer = onIndexer;
    this.#searchIndex = new SearchIndex({
      realm: this,
      dbAdapter,
      queue,
    });

    this.#dbAdapter = dbAdapter;

    this.#router = new Router(new URL(url))
      .post('/', SupportedMimeType.CardJson, this.createCard.bind(this))
      .patch(
        '/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.patchCard.bind(this),
      )
      .get('/_info', SupportedMimeType.RealmInfo, this.realmInfo.bind(this))
      .get('/_search', SupportedMimeType.CardJson, this.search.bind(this))
      .post(
        '/_session',
        SupportedMimeType.Session,
        this.createSession.bind(this),
      )
      .get(
        '/|/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.getCard.bind(this),
      )
      .delete(
        '/|/.+(?<!.json)',
        SupportedMimeType.CardJson,
        this.removeCard.bind(this),
      )
      .post(
        `/.+(${this.writableFileExtensions.map((e) => '\\' + e).join('|')})`,
        SupportedMimeType.CardSource,
        this.upsertCardSource.bind(this),
      )
      .get(
        '/.*',
        SupportedMimeType.CardSource,
        this.getCardSourceOrRedirect.bind(this),
      )
      .delete(
        '/.+',
        SupportedMimeType.CardSource,
        this.removeCardSource.bind(this),
      )
      .get(
        '/_message',
        SupportedMimeType.EventStream,
        this.subscribe.bind(this),
      )
      .get(
        '.*/',
        SupportedMimeType.DirectoryListing,
        this.getDirectoryListing.bind(this),
      )
      .get('/.*', SupportedMimeType.HTML, this.respondWithHTML.bind(this))
      .get(
        '/_readiness-check',
        SupportedMimeType.RealmInfo,
        this.readinessCheck.bind(this),
      );

    Object.values(SupportedMimeType).forEach((mimeType) => {
      this.#router.head('/.*', mimeType as SupportedMimeType, async () => {
        let requestContext = await this.createRequestContext();
        return createResponse({ init: { status: 200 }, requestContext });
      });
    });

    this.#deferStartup = opts?.deferStartUp ?? false;
    if (!opts?.deferStartUp) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
  }

  private async readinessCheck(
    _request: Request,
    requestContext: RequestContext,
  ) {
    await this.ready;

    return createResponse({
      body: null,
      init: {
        headers: { 'content-type': 'text/html' },
        status: 200,
      },
      requestContext,
    });
  }

  // it's only necessary to call this when the realm is using a deferred startup
  async start() {
    if (this.#deferStartup) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
    await this.ready;
  }

  async fullIndex() {
    await this.searchIndex.fullIndex();
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
    clientRequestId?: string | null,
  ): Promise<WriteResult> {
    await this.trackOwnWrite(path);
    let results = await this.#adapter.write(path, contents);
    await this.#searchIndex.update(this.paths.fileURL(path), {
      onInvalidation: (invalidatedURLs: URL[]) => {
        this.sendServerEvent({
          type: 'index',
          data: {
            type: 'incremental',
            invalidations: invalidatedURLs.map((u) => u.href),
            clientRequestId: clientRequestId ?? null, // use null instead of undefined for valid JSON serialization
          },
        });
      },
    });
    return results;
  }

  // we track our own writes so that we can eliminate echoes in the file watcher
  private async trackOwnWrite(path: LocalPath, opts?: { isDelete: true }) {
    let type = opts?.isDelete
      ? 'removed'
      : (await this.#adapter.exists(path))
      ? 'updated'
      : 'added';
    let messageHash = `${type}-${JSON.stringify({ [type]: path })}`;
    this.#recentWrites.set(
      messageHash,
      setTimeout(() => {
        this.#recentWrites.delete(messageHash);
      }, 500) as unknown as number, // don't use NodeJS Timeout type
    );
  }

  private getTrackedWrite(
    data: UpdateEventData,
  ): { isTracked: boolean; url: URL } | undefined {
    let file: string | undefined;
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
    let messageHash = `${type}-${JSON.stringify(data)}`;
    let url = this.paths.fileURL(file);
    let timeout = this.#recentWrites.get(messageHash);
    if (timeout) {
      // This is a best attempt to eliminate an echo here since it's unclear whether this update is one
      // that we wrote or one that was created outside of us
      clearTimeout(timeout);
      this.#recentWrites.delete(messageHash);
      return { isTracked: true, url };
    }
    return { isTracked: false, url };
  }

  async delete(path: LocalPath): Promise<void> {
    await this.trackOwnWrite(path, { isDelete: true });
    await this.#adapter.remove(path);
    await this.#searchIndex.update(this.paths.fileURL(path), {
      delete: true,
      onInvalidation: (invalidatedURLs: URL[]) => {
        this.sendServerEvent({
          type: 'index',
          data: {
            type: 'incremental',
            invalidations: invalidatedURLs.map((u) => u.href),
          },
        });
      },
    });
  }

  get loader() {
    // the current loader used by the search index will contain the latest
    // module updates as we obtain a new loader for each indexing run.
    if (isNode) {
      return this.searchIndex.loader;
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

  get searchIndex() {
    return this.#searchIndex;
  }

  async reindex() {
    await this.#searchIndex.run();
    this.sendServerEvent({ type: 'index', data: { type: 'full' } });
  }

  async #startup() {
    await Promise.resolve();
    await this.#searchIndex.run(this.#onIndexer);
    this.sendServerEvent({ type: 'index', data: { type: 'full' } });
    this.#perfLog.debug(
      `realm server startup in ${Date.now() - this.#startTime}ms`,
    );
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  maybeHandle = async (
    request: Request,
  ): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(new URL(request.url))) {
      return null;
    }
    return await this.internalHandle(request, true);
  };

  // This is scaffolding that should be deleted once we can finish the isolated
  // loader refactor
  maybeExternalHandle = async (
    request: Request,
  ): Promise<ResponseWithNodeStream | null> => {
    if (!this.paths.inRealm(new URL(request.url))) {
      return null;
    }
    return await this.internalHandle(request, false);
  };

  async handle(request: Request): Promise<ResponseWithNodeStream> {
    return this.internalHandle(request, false);
  }

  private async createSession(
    request: Request,
    requestContext: RequestContext,
  ) {
    if (!(await this.#matrixClient.isTokenValid())) {
      await this.#matrixClient.login();
    }
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest(
        JSON.stringify({ errors: [`Request body is not valid JSON`] }),
        requestContext,
      );
    }
    let { user, challenge } = json as { user?: string; challenge?: string };
    if (!user) {
      return badRequest(
        JSON.stringify({ errors: [`Request body missing 'user' property`] }),
        requestContext,
      );
    }

    if (challenge) {
      return await this.verifyChallenge(user, requestContext);
    } else {
      return await this.createChallenge(user, requestContext);
    }
  }

  private async createChallenge(user: string, requestContext: RequestContext) {
    let dmRooms =
      (await this.#matrixClient.getAccountData<Record<string, string>>(
        'boxel.session-rooms',
      )) ?? {};
    let roomId = dmRooms[user];
    if (!roomId) {
      roomId = await this.#matrixClient.createDM(user);
      dmRooms[user] = roomId;
      await this.#matrixClient.setAccountData('boxel.session-rooms', dmRooms);
    }

    let challenge = uuidV4();
    let hash = new Sha256();
    hash.update(challenge);
    hash.update(this.#realmSecretSeed);
    let hashedChallenge = uint8ArrayToHex(await hash.digest());
    await this.#matrixClient.sendEvent(roomId, 'm.room.message', {
      body: `auth-challenge: ${hashedChallenge}`,
      msgtype: 'm.text',
    });

    return createResponse({
      body: JSON.stringify({
        room: roomId,
        challenge,
      }),
      init: {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      requestContext,
    });
  }

  private async verifyChallenge(user: string, requestContext: RequestContext) {
    let dmRooms =
      (await this.#matrixClient.getAccountData<Record<string, string>>(
        'boxel.session-rooms',
      )) ?? {};
    let roomId = dmRooms[user];
    if (!roomId) {
      return badRequest(
        JSON.stringify({
          errors: [`No challenge previously issued for user ${user}`],
        }),
        requestContext,
      );
    }

    // The messages look like this:
    // --- Matrix Room Messages ---:
    // realm1
    // auth-challenge: 7cb8f904a2a53d256687c2aeb374a686a26cfd66af5fcc09a366d49644a3e2ba
    // realm2
    // auth-response: 342c5854-e716-4bda-9b31-eba83d24e25d
    // ----------------------------

    // This is a best-effort type of implementation - we don't know when the messages will appear in the room so we just wait for a bit.
    // This is not a problem when the realms are on the same matrix server but when they are on different (federated) servers the latencies and
    // race conditions can cause delays in the messages appearing in the room.
    let oneMinuteAgo = Date.now() - 60000;

    let latestAuthChallengeMessage = await waitForMatrixMessage(
      this.#matrixClient,
      roomId,
      (m) => {
        return (
          m.type === 'm.room.message' &&
          m.sender === this.#matrixClient.getUserId() &&
          m.content.body.startsWith('auth-challenge:') &&
          m.origin_server_ts > oneMinuteAgo
        );
      },
    );

    let latestAuthResponseMessage = await waitForMatrixMessage(
      this.#matrixClient,
      roomId,
      (m) => {
        return (
          m.type === 'm.room.message' &&
          m.sender === user &&
          m.content.body.startsWith('auth-response:') &&
          m.origin_server_ts > oneMinuteAgo
        );
      },
    );

    if (!latestAuthChallengeMessage) {
      return badRequest(
        JSON.stringify({ errors: [`No challenge found for user ${user}`] }),
        requestContext,
      );
    }

    if (!latestAuthResponseMessage) {
      return badRequest(
        JSON.stringify({
          errors: [`No challenge response response found for user ${user}`],
        }),
        requestContext,
      );
    }

    let challenge = latestAuthChallengeMessage.content.body.replace(
      'auth-challenge: ',
      '',
    );
    let response = latestAuthResponseMessage.content.body.replace(
      'auth-response: ',
      '',
    );
    let hash = new Sha256();
    hash.update(response);
    hash.update(this.#realmSecretSeed);
    let hashedResponse = uint8ArrayToHex(await hash.digest());
    if (hashedResponse === challenge) {
      let permissions = requestContext.permissions;

      let userPermissions = await new RealmPermissionChecker(
        permissions,
        this.#matrixClient,
      ).for(user);

      let jwt = this.#adapter.createJWT(
        {
          user,
          realm: this.url,
          permissions: userPermissions,
        },
        '7d',
        this.#realmSecretSeed,
      );
      return createResponse({
        body: null,
        init: {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            Authorization: jwt,
          },
        },
        requestContext,
      });
    } else {
      return createResponse({
        body: JSON.stringify({
          errors: [
            `user ${user} failed auth challenge: latest challenge message: "${JSON.stringify(
              latestAuthChallengeMessage,
            )}", latest response message: "${JSON.stringify(
              latestAuthResponseMessage,
            )}"`,
          ],
        }),
        init: {
          status: 401,
        },
        requestContext,
      });
    }
  }

  private async internalHandle(
    request: Request,
    isLocal: boolean,
  ): Promise<ResponseWithNodeStream> {
    let redirectResponse = this.rootRealmRedirect(request);
    if (redirectResponse) {
      return redirectResponse;
    }

    let requestContext = await this.createRequestContext(); // Cache realm permissions for the duration of the request so that we don't have to fetch them multiple times

    try {
      // local requests are allowed to query the realm as the index is being built up
      if (!isLocal) {
        let timeout = await Promise.race<void | Error>([
          this.ready,
          new Promise((resolve) =>
            setTimeout(() => {
              resolve(
                new Error(
                  `Timeout waiting for realm ${this.url} to become ready`,
                ),
              );
            }, 60 * 1000),
          ),
        ]);
        if (timeout) {
          return new Response(timeout.message, { status: 500 });
        }

        let isWrite = ['PUT', 'PATCH', 'POST', 'DELETE'].includes(
          request.method,
        );
        await this.checkPermission(
          request,
          requestContext,
          isWrite ? 'write' : 'read',
        );
      }
      if (!this.searchIndex) {
        return systemError(requestContext, 'search index is not available');
      }
      if (this.#router.handles(request)) {
        return this.#router.handle(request, requestContext);
      } else {
        return this.fallbackHandle(request, requestContext);
      }
    } catch (e) {
      if (e instanceof AuthenticationError) {
        return new Response(`${e.message}`, {
          status: 401,
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

  async fallbackHandle(request: Request, requestContext: RequestContext) {
    let start = Date.now();
    let url = new URL(request.url);
    let localPath = this.paths.local(url);

    if (!localPath.startsWith(assetsDir)) {
      let useWorkInProgressIndex = Boolean(
        request.headers.get('X-Boxel-Use-WIP-Index'),
      );
      let module = await this.#searchIndex.module(url, {
        useWorkInProgressIndex,
      });
      if (module?.type === 'module') {
        try {
          return createResponse({
            body: module.executableCode,
            init: {
              status: 200,
              headers: { 'content-type': 'text/javascript' },
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

    try {
      let maybeFileRef = await this.getFileWithFallbacks(
        localPath,
        executableExtensions,
      );
      if (!maybeFileRef) {
        return notFound(request, requestContext, `${request.url} not found`);
      }

      let fileRef = maybeFileRef;
      if (
        hasExecutableExtension(fileRef.path) &&
        !localPath.startsWith(assetsDir)
      ) {
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
      return await this.serveLocalFile(fileRef, requestContext);
    } finally {
      this.#logRequestPerformance(request, start, 'cache miss');
    }
  }

  async getIndexHTML(opts?: IndexHTMLOptions): Promise<string> {
    let indexHTML = (await this.#getIndexHTML()).replace(
      /(<meta name="@cardstack\/host\/config\/environment" content=")([^"].*)(">)/,
      (_match, g1, g2, g3) => {
        let config = JSON.parse(decodeURIComponent(g2));
        config = merge({}, config, {
          ownRealmURL: this.url, // unresolved url
          resolvedOwnRealmURL: this.url,
          hostsOwnAssets: !isNode,
          realmsServed: opts?.realmsServed,
          assetsURL: this.#assetsURL.href,
        });
        return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
      },
    );

    if (isNode) {
      indexHTML = indexHTML.replace(
        /(src|href)="\//g,
        `$1="${this.#assetsURL.href}`,
      );

      // this installs an event listener to allow a test driver to introspect
      // the DOM from a different localhost:4205 origin (the test driver's
      // origin)
      if (this.#useTestingDomain) {
        indexHTML = `
          ${indexHTML}
          <script>
            window.addEventListener('message', (event) => {
              console.log('received event in realm index HTML', event);
              if ([
                  'http://localhost:4205',
                  'http://localhost:7357',
                  'http://127.0.0.1:4205',
                  'http://127.0.0.1:7357'
                ].includes(event.origin)) {
                if (event.data === 'location') {
                  event.source.postMessage(document.location.href, event.origin);
                  return;
                }

                let { data: { querySelector, querySelectorAll, click, fillInput, uuid } } = event;
                let response;
                if (querySelector) {
                  let element = document.querySelector(querySelector);
                  response = element ? element.outerHTML : null;
                } else if (querySelectorAll) {
                  response = [...document.querySelectorAll(querySelectorAll)].map(el => el.outerHTML);
                } else if (click) {
                  let el = document.querySelector(click);
                  if (el) {
                    el.click();
                    response = null;
                  } else {
                    response = "cannot click on element: could not find '" + click + "'";
                  }
                } else if (fillInput) {
                  let [ target, text ] = fillInput;
                  let el = document.querySelector(target);
                  if (el && text != undefined) {
                    el.value = text;
                    el.dispatchEvent(new Event('input'));
                    response = null;
                  } else if (text == undefined) {
                    response = "Must provide '" + text + "' when calling 'fillIn'.)";
                  } else {
                    response =
                      "Element not found when calling 'fillInput(" + target + ")'.";
                  }
                } else if (uuid) {
                  // this can be ignored
                  response = null
                } else {
                  response = 'Do not know how to handle event data: ' + JSON.stringify(event.data);
                }
                console.log('event response:', response);
                event.source.postMessage(response, event.origin);
              }
            });
          </script>
          </
        `;
      }
    }
    return indexHTML;
  }

  private async serveLocalFile(
    ref: FileRef,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === 'string'
    ) {
      return createResponse({
        body: ref.content,
        init: {
          headers: {
            'last-modified': formatRFC7231(ref.lastModified),
          },
        },
        requestContext,
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = createResponse({
      body: null,
      init: {
        headers: {
          'last-modified': formatRFC7231(ref.lastModified),
        },
      },
      requestContext,
    }) as ResponseWithNodeStream;

    response.nodeStream = ref.content;
    return response;
  }

  private async checkPermission(
    request: Request,
    requestContext: RequestContext,
    neededPermission: 'read' | 'write',
  ) {
    let realmPermissions = requestContext.permissions;
    if (
      lookupRouteTable(this.#publicEndpoints, this.paths, request) ||
      request.method === 'HEAD' ||
      // If the realm is public readable or writable, do not require a JWT
      (neededPermission === 'read' &&
        realmPermissions['*']?.includes('read')) ||
      (neededPermission === 'write' && realmPermissions['*']?.includes('write'))
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

      let userPermissions = await realmPermissionChecker.for(token.user);
      if (
        JSON.stringify(token.permissions.sort()) !==
        JSON.stringify(userPermissions.sort())
      ) {
        throw new AuthenticationError(
          AuthenticationErrorMessages.PermissionMismatch,
        );
      }

      if (!(await realmPermissionChecker.can(token.user, neededPermission))) {
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
    );
    return createResponse({
      body: null,
      init: {
        status: 204,
        headers: { 'last-modified': formatRFC7231(lastModified) },
      },
      requestContext,
    });
  }

  private async getCardSourceOrRedirect(
    request: Request,
    requestContext: RequestContext,
  ): Promise<ResponseWithNodeStream> {
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
      return await this.serveLocalFile(handle, requestContext);
    } finally {
      this.#logRequestPerformance(request, start);
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

  private makeJS(
    content: string,
    debugFilename: string,
    requestContext: RequestContext,
  ): Response {
    try {
      if (content.match(/^\s*$/)) {
        throw new Error('File is empty');
      }
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
      return badRequest(
        `Request body is not valid card JSON-API`,
        requestContext,
      );
    }
    let { data: resource } = json;
    if (!isCardResource(resource)) {
      return badRequest(
        `Request body is not valid card JSON-API`,
        requestContext,
      );
    }

    let name: string;
    if ('name' in resource.meta.adoptsFrom) {
      // new instances are created in a folder named after the card if it has an
      // exported name
      name = resource.meta.adoptsFrom.name;
    } else {
      name = 'cards';
    }

    let fileURL = this.paths.fileURL(
      `/${join(new URL(this.url).pathname, name, uuidV4() + '.json')}`,
    );
    let localPath = this.paths.local(fileURL);
    let { lastModified } = await this.write(
      localPath,
      JSON.stringify(
        await this.fileSerialization(
          merge(json, { data: { meta: { realmURL: this.url } } }),
          fileURL,
        ),
        null,
        2,
      ),
    );
    let newURL = fileURL.href.replace(/\.json$/, '');
    let entry = await this.#searchIndex.card(new URL(newURL), {
      loadLinks: true,
    });
    if (!entry || entry?.type === 'error') {
      let err = entry
        ? CardError.fromSerializableError(entry.error)
        : undefined;
      return systemError(
        requestContext,
        `Unable to index new card, can't find new instance in index`,
        err,
      );
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

  private async patchCard(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let localPath = this.paths.local(new URL(request.url));
    if (localPath.startsWith('_')) {
      return methodNotAllowed(request, requestContext);
    }

    let url = this.paths.fileURL(localPath);
    let originalMaybeError = await this.#searchIndex.card(url);
    if (!originalMaybeError) {
      return notFound(request, requestContext);
    }
    if (originalMaybeError.type === 'error') {
      return systemError(
        requestContext,
        `unable to patch card, cannot load original from index`,
        CardError.fromSerializableError(originalMaybeError.error),
      );
    }
    let { doc: original } = originalMaybeError;
    let originalClone = cloneDeep(original);
    delete originalClone.data.meta.lastModified;

    let patch = await request.json();
    if (!isSingleCardDocument(patch)) {
      return badRequest(
        `The request body was not a card document`,
        requestContext,
      );
    }
    // prevent the client from changing the card type or ID in the patch
    delete (patch as any).data.meta;
    delete (patch as any).data.type;

    let card = mergeWith(
      originalClone,
      patch,
      (_objectValue: any, sourceValue: any) => {
        // a patched array should overwrite the original array instead of merging
        // into an original array, otherwise we won't be able to remove items in
        // the original array
        return Array.isArray(sourceValue) ? sourceValue : undefined;
      },
    );

    if (card.data.relationships || patch.data.relationships) {
      let merged = mergeRelationships(
        card.data.relationships,
        patch.data.relationships,
      );

      if (merged && Object.keys(merged).length !== 0) {
        card.data.relationships = merged;
      }
    }

    delete (card as any).data.id; // don't write the ID to the file
    let path: LocalPath = `${localPath}.json`;
    let { lastModified } = await this.write(
      path,
      JSON.stringify(
        await this.fileSerialization(
          merge(card, { data: { meta: { realmURL: this.url } } }),
          url,
        ),
        null,
        2,
      ),
      request.headers.get('X-Boxel-Client-Request-Id'),
    );
    let instanceURL = url.href.replace(/\.json$/, '');
    let entry = await this.#searchIndex.card(new URL(instanceURL), {
      loadLinks: true,
    });
    if (!entry || entry?.type === 'error') {
      return systemError(
        requestContext,
        `Unable to index card: can't find patched instance in index`,
        entry ? CardError.fromSerializableError(entry.error) : undefined,
      );
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
      request.headers.get('X-Boxel-Use-WIP-Index'),
    );

    let url = this.paths.fileURL(localPath.replace(/\.json$/, ''));
    let maybeError = await this.#searchIndex.card(url, {
      loadLinks: true,
      useWorkInProgressIndex,
    });
    let start = Date.now();
    try {
      if (!maybeError) {
        return notFound(request, requestContext);
      }
      if (maybeError.type === 'error') {
        return systemError(
          requestContext,
          `cannot return card from index: ${maybeError.error.title} - ${maybeError.error.detail}`,
          CardError.fromSerializableError(maybeError.error),
        );
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
    let result = await this.#searchIndex.card(url);
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
      let relationship: DirectoryEntryRelationship = {
        links: {
          related:
            entry.kind === 'directory'
              ? this.paths.directoryURL(join(dir, entry.name)).href
              : this.paths.fileURL(join(dir, entry.name)).href,
        },
        meta: {
          kind: entry.kind as 'directory' | 'file',
        },
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
    return this.#searchIndex.isIgnored(url);
  }

  private async search(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let useWorkInProgressIndex = Boolean(
      request.headers.get('X-Boxel-Use-WIP-Index'),
    );
    let doc = await this.#searchIndex.search(
      parseQueryString(new URL(request.url).search.slice(1)),
      { loadLinks: true, useWorkInProgressIndex },
    );
    return createResponse({
      body: JSON.stringify(doc, null, 2),
      init: {
        headers: { 'content-type': SupportedMimeType.CardJson },
      },
      requestContext,
    });
  }

  private async realmInfo(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let fileURL = this.paths.fileURL(`.realm.json`);
    let localPath: LocalPath = this.paths.local(fileURL);
    let realmConfig = await this.readFileAsText(localPath, undefined);
    let realmInfo: RealmInfo = {
      name: 'Unnamed Workspace',
      backgroundURL: null,
      iconURL: null,
    };

    if (realmConfig) {
      try {
        let realmConfigJson = JSON.parse(realmConfig.content);
        realmInfo.name = realmConfigJson.name ?? realmInfo.name;
        realmInfo.backgroundURL =
          realmConfigJson.backgroundURL ?? realmInfo.backgroundURL;
        realmInfo.iconURL = realmConfigJson.iconURL ?? realmInfo.iconURL;
      } catch (e) {
        this.#log.warn(`failed to parse realm config: ${e}`);
      }
    }
    let doc = {
      data: {
        id: this.paths.url.toString(),
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
    let card = (await api.createFromSerialized(
      doc.data,
      doc,
      relativeTo,
      this.loader as unknown as LoaderType,
    )) as CardDef;
    await api.flushLogs();
    let data: LooseSingleCardDocument = api.serializeCard(card); // this strips out computeds
    delete data.data.id; // the ID is derived from the filename, so we don't serialize it on disk
    delete data.included;
    for (let relationship of Object.values(data.data.relationships ?? {})) {
      delete relationship.data;
    }
    return data;
  }

  private listeningClients: WritableStream[] = [];

  private async subscribe(
    request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    let headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

    let { response, writable } = this.#adapter.createStreamingResponse(
      request,
      requestContext,
      {
        status: 200,
        headers,
      },
      () => {
        this.listeningClients = this.listeningClients.filter(
          (w) => w !== writable,
        );
        this.sendServerEvent({
          type: 'message',
          data: { cleanup: `${this.listeningClients.length} clients` },
        });
        if (this.listeningClients.length === 0) {
          this.#adapter.unsubscribe();
        }
      },
    );

    if (this.listeningClients.length === 0) {
      await this.#adapter.subscribe((data) => {
        let tracked = this.getTrackedWrite(data);
        if (!tracked || tracked.isTracked) {
          return;
        }
        this.sendServerEvent({ type: 'update', data });
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

    this.listeningClients.push(writable);
    this.sendServerEvent({
      type: 'message',
      data: { count: `${this.listeningClients.length} clients` },
    });

    // TODO: We may need to store something else here to do cleanup to keep
    // tests consistent
    waitForClose(writable);

    return response;
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
      await this.#searchIndex.update(url, {
        onInvalidation: (invalidatedURLs: URL[]) => {
          this.sendServerEvent({
            type: 'index',
            data: {
              type: 'incremental',
              invalidations: invalidatedURLs.map((u) => u.href),
            },
          });
        },
        ...(operation === 'removed' ? { delete: true } : {}),
      });
    }
    itemsDrained!();
  }

  private async sendServerEvent(event: ServerEvents): Promise<void> {
    this.#log.debug(
      `sending updates to ${this.listeningClients.length} clients`,
    );
    let { type, data, id } = event;
    let chunkArr = [];
    for (let item in data) {
      chunkArr.push(`"${item}": ${JSON.stringify((data as any)[item])}`);
    }
    let chunk = sseToChunkData(type, `{${chunkArr.join(', ')}}`, id);
    await Promise.all(
      this.listeningClients.map((client) => writeToStream(client, chunk)),
    );
  }

  private async respondWithHTML(
    _request: Request,
    requestContext: RequestContext,
  ): Promise<Response> {
    return createResponse({
      body: await this.getIndexHTML(),
      init: {
        headers: { 'content-type': 'text/html' },
      },
      relaxDocumentDomain: this.#useTestingDomain,
      requestContext,
    });
  }

  private async createRequestContext(): Promise<RequestContext> {
    let permissions = await fetchUserPermissions(
      this.#dbAdapter,
      new URL(this.url),
    );
    return {
      realm: this,
      permissions,
    };
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
      ? { 'last-modified': formatRFC7231(card.data.meta.lastModified) }
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

function sseToChunkData(type: string, data: string, id?: string): string {
  let info = [`event: ${type}`, `data: ${data}`];
  if (id) {
    info.push(`id: ${id}`);
  }
  return info.join('\n') + '\n\n';
}

function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}
