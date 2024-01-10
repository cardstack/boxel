import { Deferred } from './deferred';
import {
  SearchIndex,
  type IndexRunner,
  type RunnerOptionsManager,
} from './search-index';
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
import { md5 } from 'super-fast-md5';
import {
  isCardResource,
  executableExtensions,
  hasExecutableExtension,
  isNode,
  isSingleCardDocument,
  baseRealm,
  assetsDir,
  logger,
  type CodeRef,
  type LooseSingleCardDocument,
  type ResourceObjectWithId,
  type DirectoryEntryRelationship,
} from './index';
import merge from 'lodash/merge';
import flatMap from 'lodash/flatMap';
import mergeWith from 'lodash/mergeWith';
import cloneDeep from 'lodash/cloneDeep';
import {
  fileContentToText,
  readFileAsText,
  getFileWithFallbacks,
  writeToStream,
  waitForClose,
} from './stream';
import { preprocessEmbeddedTemplates } from '@cardstack/ember-template-imports/lib/preprocess-embedded-templates';
import * as babel from '@babel/core';
//@ts-ignore type import requires a newer Typescript with node16 moduleResolution
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation/browser';
import type { Options as EmberTemplatePluginOptions } from 'babel-plugin-ember-template-compilation/src/plugin';
import type { EmberTemplateCompiler } from 'babel-plugin-ember-template-compilation/src/ember-template-compiler';
import type { ExtendedPluginBuilder } from 'babel-plugin-ember-template-compilation/src/js-utils';
//@ts-ignore no types are available
import * as etc from 'ember-source/dist/ember-template-compiler';
import { loaderPlugin } from './loader-plugin';
//@ts-ignore no types are available
import glimmerTemplatePlugin from '@cardstack/ember-template-imports/src/babel-plugin';
//@ts-ignore no types are available
import decoratorsProposalPlugin from '@babel/plugin-proposal-decorators';
//@ts-ignore no types are available
import classPropertiesProposalPlugin from '@babel/plugin-proposal-class-properties';
//@ts-ignore ironically no types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
//@ts-ignore no types are available
import emberConcurrencyAsyncPlugin from 'ember-concurrency-async-plugin';
import { Router, SupportedMimeType } from './router';
import { parseQueryString } from './query';
//@ts-ignore service worker can't handle this
import type { Readable } from 'stream';
import { type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { createResponse } from './create-response';
import { mergeRelationships } from './merge-relationships';
import type { LoaderType } from 'https://cardstack.com/base/card-api';
import scopedCSSTransform from 'glimmer-scoped-css/ast-transform';
import { MatrixClient } from './matrix-client';
import { Sha256 } from '@aws-crypto/sha256-js';

export type RealmInfo = {
  name: string;
  backgroundURL: string | null;
  iconURL: string | null;
};

export interface FileRef {
  path: LocalPath;
  content: ReadableStream<Uint8Array> | Readable | Uint8Array | string;
  lastModified: number;
}

export interface ResponseWithNodeStream extends Response {
  nodeStream?: Readable;
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

  createStreamingResponse(
    unresolvedRealmURL: string,
    req: Request,
    init: ResponseInit,
    cleanup: () => void,
  ): {
    response: Response;
    writable: WritableStream;
  };

  subscribe(cb: (message: UpdateEventData) => void): Promise<void>;

  unsubscribe(): void;
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

type Operation = WriteOperation | DeleteOperation;

interface WriteResult {
  lastModified: number;
}

interface WriteOperation {
  type: 'write';
  path: LocalPath;
  contents: string;
  clientRequestId?: string | null; // Used for client to be able to see if the SSE event is a result of the client's own write
  deferred: Deferred<WriteResult>;
}

interface DeleteOperation {
  type: 'delete';
  path: LocalPath;
  deferred: Deferred<void>;
}

export class Realm {
  #startedUp = new Deferred<void>();
  #matrixClient: MatrixClient;
  #searchIndex: SearchIndex;
  #adapter: RealmAdapter;
  #router: Router;
  #deferStartup: boolean;
  #useTestingDomain = false;
  #transpileCache = new Map<string, string>();
  #log = logger('realm');
  #getIndexHTML: () => Promise<string>;
  #updateItems: UpdateItem[] = [];
  #flushUpdateEvents: Promise<void> | undefined;
  #recentWrites: Map<string, number> = new Map();
  #flushOperations: Promise<void> | undefined;
  #operationQueue: Operation[] = [];
  #realmSecretSeed: string;
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
    url: string,
    adapter: RealmAdapter,
    loader: Loader,
    indexRunner: IndexRunner,
    runnerOptsMgr: RunnerOptionsManager,
    getIndexHTML: () => Promise<string>,
    matrix: { url: URL; username: string; password: string },
    realmSecretSeed = uuidV4(),
    opts?: Options,
  ) {
    this.paths = new RealmPaths(url);
    let { username, password, url: matrixURL } = matrix;
    this.#matrixClient = new MatrixClient(matrixURL, username, password);
    this.#realmSecretSeed = realmSecretSeed;
    this.#getIndexHTML = getIndexHTML;
    this.#useTestingDomain = Boolean(opts?.useTestingDomain);
    this.loaderTemplate = loader;
    this.loaderTemplate.registerURLHandler(this.maybeHandle.bind(this));
    this.#adapter = adapter;
    this.#searchIndex = new SearchIndex(
      this,
      this.#adapter.readdir.bind(this.#adapter),
      this.readFileAsText.bind(this),
      indexRunner,
      runnerOptsMgr,
    );

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
      .get('/.*', SupportedMimeType.HTML, this.respondWithHTML.bind(this));

    this.#deferStartup = opts?.deferStartUp ?? false;
    if (!opts?.deferStartUp) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
  }

  // it's only necessary to call this when the realm is using a deferred startup
  async start() {
    if (this.#deferStartup) {
      this.#startedUp.fulfill((() => this.#startup())());
    }
    await this.ready;
  }

  async flushUpdateEvents() {
    return this.#flushUpdateEvents;
  }

  async flushOperations() {
    return this.#flushOperations;
  }

  // in order to prevent issues with concurrent index manipulation clobbering
  // each other we use a queue of operations to mutate realm state. We should
  // remove this queue when we move to a pg backed index
  private async drainOperations() {
    await this.#flushOperations;

    let operationsDrained: () => void;
    this.#flushOperations = new Promise<void>(
      (res) => (operationsDrained = res),
    );
    let operations = [...this.#operationQueue];
    this.#operationQueue = [];
    for (let operation of operations) {
      if (operation.type === 'write') {
        let result = await this.#write(
          operation.path,
          operation.contents,
          operation.clientRequestId,
        );
        operation.deferred.fulfill(result);
      } else {
        await this.#delete(operation.path);
        operation.deferred.fulfill();
      }
    }

    operationsDrained!();
  }

  async write(
    path: LocalPath,
    contents: string,
    clientRequestId?: string | null,
  ): Promise<WriteResult> {
    let deferred = new Deferred<WriteResult>();
    this.#operationQueue.push({
      type: 'write',
      path,
      contents,
      clientRequestId,
      deferred,
    });
    this.drainOperations();
    return deferred.promise;
  }

  async #write(
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
    let deferred = new Deferred<void>();
    this.#operationQueue.push({
      type: 'delete',
      path,
      deferred,
    });
    this.drainOperations();
    return deferred.promise;
  }

  async #delete(path: LocalPath): Promise<void> {
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
    await this.#matrixClient.login();
    await this.#warmUpCache();
    await this.#searchIndex.run();
    this.sendServerEvent({ type: 'index', data: { type: 'full' } });
  }

  // Take advantage of the fact that the base realm modules are static (for now)
  // and cache the transpiled js for all the base realm modules so that all
  // consuming realms can benefit from this work
  async #warmUpCache() {
    if (this.url !== baseRealm.url) {
      return;
    }

    let entries = await this.recursiveDirectoryEntries(new URL(this.url));
    let modules = flatMap(entries, (e) =>
      e.kind === 'file' && hasExecutableExtension(e.path) ? [e.path] : [],
    );
    for (let mod of modules) {
      let handle = await this.#adapter.openFile(mod);
      if (!handle) {
        this.#log.error(
          `cannot open file ${mod} when warming up transpilation cache`,
        );
        continue;
      }
      this.makeJS(await fileContentToText(handle), handle.path);
    }
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  async maybeHandle(request: Request): Promise<Response | null> {
    if (!this.paths.inRealm(new URL(request.url))) {
      return null;
    }
    return await this.internalHandle(request, true);
  }

  async handle(request: Request): Promise<ResponseWithNodeStream> {
    return this.internalHandle(request, false);
  }

  private async createSession(request: Request) {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest(this.url, `Request body is not valid JSON`);
    }
    let { user, challenge } = json as { user?: string; challenge?: string };
    if (!user) {
      return badRequest(this.url, `Request body missing 'user' property`);
    }

    if (!challenge) {
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
      await this.#matrixClient.sendRoomEvent(roomId, 'm.room.message', {
        body: `auth-challenge: ${hashedChallenge}`,
        msgtype: 'm.text',
      });
      return createResponse(
        this.url,
        JSON.stringify({
          room: roomId,
          challenge,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } else {
      // TODO in this scenario we need to check the DM with the user and confirm
      // if the user's challenge post in the DM has passed
    }
  }

  private async internalHandle(
    request: Request,
    isLocal: boolean,
  ): Promise<ResponseWithNodeStream> {
    // local requests are allowed to query the realm as the index is being built up
    if (!isLocal) {
      await this.ready;
    }
    if (!this.searchIndex) {
      return systemError(this.url, 'search index is not available');
    }
    if (this.#router.handles(request)) {
      return this.#router.handle(request);
    } else {
      return this.fallbackHandle(request);
    }
  }

  async fallbackHandle(request: Request) {
    let url = new URL(request.url);
    let localPath = this.paths.local(url);
    let maybeHandle = await this.getFileWithFallbacks(
      localPath,
      executableExtensions,
    );

    if (!maybeHandle) {
      return notFound(this.url, request, `${request.url} not found`);
    }

    let handle = maybeHandle;

    if (
      executableExtensions.some((extension) =>
        handle.path.endsWith(extension),
      ) &&
      !localPath.startsWith(assetsDir)
    ) {
      return this.makeJS(await fileContentToText(handle), handle.path);
    } else {
      return await this.serveLocalFile(handle);
    }
  }

  async getIndexHTML(opts?: IndexHTMLOptions): Promise<string> {
    let resolvedBaseRealmURL = this.#searchIndex.loader.resolve(
      baseRealm.url,
    ).href;
    let indexHTML = (await this.#getIndexHTML()).replace(
      /(<meta name="@cardstack\/host\/config\/environment" content=")([^"].*)(">)/,
      (_match, g1, g2, g3) => {
        let config = JSON.parse(decodeURIComponent(g2));
        config = merge({}, config, {
          ownRealmURL: this.url, // unresolved url
          resolvedBaseRealmURL,
          resolvedOwnRealmURL: this.#searchIndex.loader.resolve(this.url).href,
          hostsOwnAssets: !isNode,
          realmsServed: opts?.realmsServed,
        });
        return `${g1}${encodeURIComponent(JSON.stringify(config))}${g3}`;
      },
    );

    if (isNode) {
      // set the static public asset paths in index.html
      indexHTML = indexHTML.replace(/(src|href)="\//g, `$1="/${assetsDir}`);

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

  private async serveLocalFile(ref: FileRef): Promise<ResponseWithNodeStream> {
    if (
      ref.content instanceof ReadableStream ||
      ref.content instanceof Uint8Array ||
      typeof ref.content === 'string'
    ) {
      return createResponse(this.url, ref.content, {
        headers: {
          'last-modified': formatRFC7231(ref.lastModified),
        },
      });
    }

    if (!isNode) {
      throw new Error(`Cannot handle node stream in a non-node environment`);
    }

    // add the node stream to the response which will get special handling in the node env
    let response = createResponse(this.url, null, {
      headers: {
        'last-modified': formatRFC7231(ref.lastModified),
      },
    }) as ResponseWithNodeStream;
    response.nodeStream = ref.content;
    return response;
  }

  private async upsertCardSource(request: Request): Promise<Response> {
    let { lastModified } = await this.write(
      this.paths.local(request.url),
      await request.text(),
    );
    return createResponse(this.url, null, {
      status: 204,
      headers: { 'last-modified': formatRFC7231(lastModified) },
    });
  }

  private async getCardSourceOrRedirect(
    request: Request,
  ): Promise<ResponseWithNodeStream> {
    let localName = this.paths.local(request.url);
    let handle = await this.getFileWithFallbacks(localName, [
      ...executableExtensions,
      '.json',
    ]);
    if (!handle) {
      return notFound(this.url, request, `${localName} not found`);
    }

    if (handle.path !== localName) {
      return createResponse(this.url, null, {
        status: 302,
        headers: { Location: `${new URL(this.url).pathname}${handle.path}` },
      });
    }
    return await this.serveLocalFile(handle);
  }

  private async removeCardSource(request: Request): Promise<Response> {
    let localName = this.paths.local(request.url);
    let handle = await this.getFileWithFallbacks(localName, [
      ...executableExtensions,
      '.json',
    ]);
    if (!handle) {
      return notFound(this.url, request, `${localName} not found`);
    }
    await this.delete(handle.path);
    return createResponse(this.url, null, { status: 204 });
  }

  private transpileJS(content: string, debugFilename: string): string {
    let hash = md5(content);
    let cached = this.#transpileCache.get(hash);
    if (cached) {
      return cached;
    }
    content = preprocessEmbeddedTemplates(content, {
      relativePath: debugFilename,
      getTemplateLocals: etc._GlimmerSyntax.getTemplateLocals,
      templateTag: 'template',
      templateTagReplacement: '__GLIMMER_TEMPLATE',
      includeSourceMaps: true,
      includeTemplateTokens: true,
    }).output;

    let templateOptions: EmberTemplatePluginOptions = {
      compiler: etc as unknown as EmberTemplateCompiler,
      transforms: [scopedCSSTransform as ExtendedPluginBuilder],
    };

    let src = babel.transformSync(content, {
      filename: debugFilename,
      compact: false, // this helps for readability when debugging
      plugins: [
        glimmerTemplatePlugin,
        emberConcurrencyAsyncPlugin,
        [typescriptPlugin, { allowDeclareFields: true }],
        [decoratorsProposalPlugin, { legacy: true }],
        classPropertiesProposalPlugin,
        [makeEmberTemplatePlugin, templateOptions],
        loaderPlugin,
      ],
      highlightCode: false, // Do not output ANSI color codes in error messages so that the client can display them plainly
    })?.code;
    if (!src) {
      throw new Error('bug: should never get here');
    }

    // This assumes the base realm is static. We take advantage of the static
    // nature of the base realm such that we can cache the transpiled JS, which
    // is the slowest part of module loading (and base realm modules are
    // imported a lot by all realms)
    if (this.url === baseRealm.url) {
      this.#transpileCache.set(hash, src);
    }
    return src;
  }

  private makeJS(content: string, debugFilename: string): Response {
    try {
      content = this.transpileJS(content, debugFilename);
    } catch (err: any) {
      return createResponse(this.url, err.message, {
        // using "Not Acceptable" here because no text/javascript representation
        // can be made and we're sending text/html error page instead
        status: 406,
        headers: { 'content-type': 'text/html' },
      });
    }
    return createResponse(this.url, content, {
      status: 200,
      headers: { 'content-type': 'text/javascript' },
    });
  }

  // we bother with this because typescript is picky about allowing you to use
  // explicit file extensions in your source code
  private async getFileWithFallbacks(
    path: LocalPath,
    fallbackExtensions: string[],
  ): Promise<FileRef | undefined> {
    return getFileWithFallbacks(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      fallbackExtensions,
    );
  }

  private async createCard(request: Request): Promise<Response> {
    let body = await request.text();
    let json;
    try {
      json = JSON.parse(body);
    } catch (e) {
      return badRequest(this.url, `Request body is not valid card JSON-API`);
    }
    let { data: resource } = json;
    if (!isCardResource(resource)) {
      return badRequest(this.url, `Request body is not valid card JSON-API`);
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
    return createResponse(this.url, JSON.stringify(doc, null, 2), {
      status: 201,
      headers: {
        'content-type': SupportedMimeType.CardJson,
        ...lastModifiedHeader(doc),
      },
    });
  }

  private async patchCard(request: Request): Promise<Response> {
    let localPath = this.paths.local(request.url);
    if (localPath.startsWith('_')) {
      return methodNotAllowed(this.url, request);
    }

    let url = this.paths.fileURL(localPath);
    let originalMaybeError = await this.#searchIndex.card(url);
    if (!originalMaybeError) {
      return notFound(this.url, request);
    }
    if (originalMaybeError.type === 'error') {
      return systemError(
        `unable to patch card, cannot load original from index`,
        CardError.fromSerializableError(originalMaybeError.error),
      );
    }
    let { doc: original } = originalMaybeError;
    let originalClone = cloneDeep(original);
    delete originalClone.data.meta.lastModified;

    let patch = await request.json();
    if (!isSingleCardDocument(patch)) {
      return badRequest(this.url, `The request body was not a card document`);
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
    return createResponse(this.url, JSON.stringify(doc, null, 2), {
      headers: {
        'content-type': SupportedMimeType.CardJson,
        ...lastModifiedHeader(doc),
      },
    });
  }

  private async getCard(request: Request): Promise<Response> {
    let localPath = this.paths.local(request.url);
    if (localPath === '') {
      localPath = 'index';
    }

    let url = this.paths.fileURL(localPath.replace(/\.json$/, ''));
    let maybeError = await this.#searchIndex.card(url, { loadLinks: true });
    if (!maybeError) {
      return notFound(this.url, request);
    }
    if (maybeError.type === 'error') {
      return systemError(
        this.url,
        `cannot return card from index: ${maybeError.error.title} - ${maybeError.error.detail}`,
        CardError.fromSerializableError(maybeError.error),
      );
    }
    let { doc: card } = maybeError;
    card.data.links = { self: url.href };

    let foundPath = this.paths.local(url);
    if (localPath !== foundPath) {
      return createResponse(this.url, null, {
        status: 302,
        headers: { Location: `${new URL(this.url).pathname}${foundPath}` },
      });
    }

    return createResponse(this.url, JSON.stringify(card, null, 2), {
      headers: {
        'last-modified': formatRFC7231(card.data.meta.lastModified!),
        'content-type': SupportedMimeType.CardJson,
        ...lastModifiedHeader(card),
      },
    });
  }

  private async removeCard(request: Request): Promise<Response> {
    let reqURL = request.url.replace(/\.json$/, '');
    // strip off query params
    let url = new URL(new URL(reqURL).pathname, reqURL);
    let result = await this.#searchIndex.card(url);
    if (!result) {
      return notFound(this.url, request);
    }
    let path = this.paths.local(url) + '.json';
    await this.delete(path);
    return createResponse(this.url, null, { status: 204 });
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

  private async recursiveDirectoryEntries(
    url: URL,
  ): Promise<{ name: string; kind: Kind; path: LocalPath }[]> {
    let entries = await this.directoryEntries(url);
    if (!entries) {
      return [];
    }
    let nestedEntries: { name: string; kind: Kind; path: LocalPath }[] = [];
    for (let dirEntry of entries.filter((e) => e.kind === 'directory')) {
      nestedEntries.push(
        ...(await this.recursiveDirectoryEntries(
          new URL(`${url.href}${dirEntry.name}`),
        )),
      );
    }
    return [...entries, ...nestedEntries];
  }

  private async getDirectoryListing(request: Request): Promise<Response> {
    // a LocalPath has no leading nor trailing slash
    let localPath: LocalPath = this.paths.local(request.url);
    let url = this.paths.directoryURL(localPath);
    let entries = await this.directoryEntries(url);
    if (!entries) {
      this.#log.warn(`can't find directory ${url.href}`);
      return notFound(this.url, request);
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

    return createResponse(this.url, JSON.stringify({ data }, null, 2), {
      headers: { 'content-type': SupportedMimeType.DirectoryListing },
    });
  }

  private async readFileAsText(
    path: LocalPath,
    opts: { withFallbacks?: true } = {},
  ): Promise<{ content: string; lastModified: number } | undefined> {
    return readFileAsText(
      path,
      this.#adapter.openFile.bind(this.#adapter),
      opts,
    );
  }

  private async isIgnored(url: URL): Promise<boolean> {
    return this.#searchIndex.isIgnored(url);
  }

  private async search(request: Request): Promise<Response> {
    let doc = await this.#searchIndex.search(
      parseQueryString(new URL(request.url).search.slice(1)),
      { loadLinks: true },
    );
    return createResponse(this.url, JSON.stringify(doc, null, 2), {
      headers: { 'content-type': SupportedMimeType.CardJson },
    });
  }

  private async realmInfo(_request: Request): Promise<Response> {
    let fileURL = this.paths.fileURL(`.realm.json`);
    let localPath: LocalPath = this.paths.local(fileURL);
    let realmConfig = await this.readFileAsText(localPath);
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
    return createResponse(this.url, JSON.stringify(doc, null, 2), {
      headers: { 'content-type': SupportedMimeType.RealmInfo },
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

  private async subscribe(req: Request): Promise<Response> {
    let headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };

    let { response, writable } = this.#adapter.createStreamingResponse(
      this.url,
      req,
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
    this.#log.info(
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

  private async respondWithHTML() {
    return createResponse(
      this.url,
      await this.getIndexHTML(),
      {
        headers: { 'content-type': 'text/html' },
      },
      this.#useTestingDomain,
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
