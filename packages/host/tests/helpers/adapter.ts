import type Owner from '@ember/owner';

import {
  Loader,
  LocalPath,
  RealmAdapter,
  RealmPaths,
  baseRealm,
  createResponse,
  hasExecutableExtension,
  Deferred,
  unixTime,
  FileWriteResult,
} from '@cardstack/runtime-common';

import { LintResult } from '@cardstack/runtime-common/lint';
import { type MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import {
  FileRef,
  Kind,
  RequestContext,
  TokenClaims,
} from '@cardstack/runtime-common/realm';

import type {
  FileAddedEventContent,
  FileUpdatedEventContent,
  RealmEventContent,
  UpdateRealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

import { WebMessageStream, messageCloseHandler } from './stream';

import { createJWT, testRealmURL } from '.';

import type { MockUtils } from './mock-matrix/_utils';

interface Dir {
  kind: 'directory';
  contents: { [name: string]: File | Dir };
}

interface File {
  kind: 'file';
  content: string | object;
}

type CardAPI = typeof import('https://cardstack.com/base/card-api');

class TokenExpiredError extends Error {}
class JsonWebTokenError extends Error {}

interface TestAdapterContents {
  [path: string]: string | object;
}

let shimmedModuleIndicator = '// this file is shimmed';

export class TestRealmAdapter implements RealmAdapter {
  #files: Dir = { kind: 'directory', contents: {} };
  #lastModified: Map<string, number> = new Map();
  #resourceCreatedAt: Map<string, number> = new Map();
  #paths: RealmPaths;
  #subscriber: ((message: UpdateRealmEventContent) => void) | undefined;
  #loader: Loader | undefined; // Will be set in the realm's constructor - needed for openFile for shimming purposes
  #ready = new Deferred<void>();
  #potentialModulesAndInstances: { content: any; url: URL }[] = [];
  #mockMatrixUtils: MockUtils;

  owner?: Owner;

  constructor(
    contents: TestAdapterContents,
    realmURL = new URL(testRealmURL),
    mockMatrixUtils: MockUtils,
    owner?: Owner,
  ) {
    this.owner = owner;
    this.#paths = new RealmPaths(realmURL);
    this.#mockMatrixUtils = mockMatrixUtils;

    let now = unixTime(Date.now());

    for (let [path, content] of Object.entries(contents)) {
      let segments = path.split('/');
      let last = segments.pop()!;
      let dir = this.#traverse(segments, 'directory');
      if (dir.kind === 'file') {
        throw new Error(`tried to use file as directory`);
      }
      let url = this.#paths.fileURL(path);
      this.#lastModified.set(url.href, now);
      this.#resourceCreatedAt.set(url.href, now);
      dir.contents[last] = { kind: 'file', content };
      if (typeof content === 'object') {
        this.#potentialModulesAndInstances.push({ content, url });
      }
    }
  }

  get realmPath() {
    return this.#paths;
  }

  get ready() {
    return this.#ready.promise;
  }

  async broadcastRealmEvent(
    event: RealmEventContent,
    matrixClient: MatrixClient,
  ) {
    if (!this.owner) {
      return;
    }

    let { getRoomIds, simulateRemoteMessage } = this.#mockMatrixUtils;

    let realmMatrixUsername = matrixClient.username;

    let targetRoomIds = getRoomIds().filter((rid) =>
      rid.replace('test-session-room-realm-', '').startsWith(this.#paths.url),
    );

    for (let roomId of targetRoomIds) {
      simulateRemoteMessage(roomId, realmMatrixUsername, event, {
        type: APP_BOXEL_REALM_EVENT_TYPE,
      });
    }
  }

  // We are eagerly establishing shims and preparing instances to be able to be
  // serialized as our test realm needs to be able to serve these via the HTTP
  // API (internally) in order to index itself at boot
  private async prepareInstances() {
    if (!this.#loader) {
      throw new Error('bug: loader needs to be set in test adapter');
    }

    let cardApi = await this.#loader.import<CardAPI>(
      `${baseRealm.url}card-api`,
    );
    for (let { content, url } of this.#potentialModulesAndInstances) {
      if (cardApi.isCard(content)) {
        cardApi.setCardAsSavedForTest(
          content,
          `${url.href.replace(/\.json$/, '')}`,
        );
        continue;
      }
      for (let [name, fn] of Object.entries(content)) {
        if (typeof fn === 'function' && typeof name === 'string') {
          this.#loader.shimModule(url.href, content);
          continue;
        }
      }
    }
    this.#ready.fulfill();
  }

  setLoader(loader: Loader) {
    // Should remove this once CS-6720 is finished
    this.#loader = loader;
    this.prepareInstances();
  }

  createJWT(claims: TokenClaims, expiration: string, secret: string) {
    return createJWT(claims, expiration, secret);
  }

  verifyJWT(
    token: string,
    secret: string,
  ): TokenClaims & { iat: number; exp: number } {
    let [_header, payload, signature] = token.split('.');
    if (signature === secret) {
      let claims = JSON.parse(atob(payload)) as {
        iat: number;
        exp: number;
      } & TokenClaims;
      let expiration = claims.exp;
      if (expiration > unixTime(Date.now())) {
        throw new TokenExpiredError(`JWT token expired at ${expiration}`);
      }
      return claims;
    }
    throw new JsonWebTokenError(`unable to verify JWT: ${token}`);
  }

  get lastModifiedMap() {
    return this.#lastModified;
  }

  get resourceCreatedAtMap() {
    return this.#resourceCreatedAt;
  }

  async lastModified(path: string): Promise<number | undefined> {
    return this.#lastModified.get(this.#paths.fileURL(path).href);
  }

  // this is to aid debugging since privates are actually not visible in the debugger
  get files() {
    return this.#files;
  }

  async *readdir(
    path: string,
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    let dir =
      path === '' ? this.#files : this.#traverse(path.split('/'), 'directory');
    for (let [name, content] of Object.entries((dir as Dir).contents)) {
      yield {
        name,
        path: path === '' ? name : `${path}/${name}`,
        kind: content.kind,
      };
    }
  }

  async exists(path: LocalPath): Promise<boolean> {
    let maybeFilename = path.split('/').pop()!;
    try {
      // a quirk of our test file system's traverse is that it creates
      // directories as it goes--so do our best to determine if we are checking for
      // a file that exists (because of this behavior directories always exist)
      await this.#traverse(
        path.split('/'),
        maybeFilename.includes('.') ? 'file' : 'directory',
      );
      return true;
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        return false;
      }
      if (err.name === 'TypeMismatchError') {
        try {
          await this.#traverse(path.split('/'), 'file');
          return true;
        } catch (err: any) {
          if (err.name === 'NotFoundError') {
            return false;
          }
          throw err;
        }
      }
      throw err;
    }
  }

  async openFile(path: LocalPath): Promise<FileRef | undefined> {
    await this.#ready.promise;
    let content;
    try {
      content = this.#traverse(path.split('/'), 'file');
    } catch (err: any) {
      if (['TypeMismatchError', 'NotFoundError'].includes(err.name)) {
        return undefined;
      }
      throw err;
    }
    if (content.kind === 'directory') {
      return undefined;
    }

    if (!this.#loader) {
      throw new Error('bug: loader needs to be set in test adapter');
    }

    let value = content.content;

    let fileRefContent = '';

    if (path.endsWith('.json')) {
      let cardApi = await this.#loader.import<CardAPI>(
        `${baseRealm.url}card-api`,
      );
      if (cardApi.isCard(value)) {
        let doc = cardApi.serializeCard(value);
        fileRefContent = JSON.stringify(doc);
      } else {
        fileRefContent =
          typeof value === 'string' ? value : JSON.stringify(value);
      }
    } else if (hasExecutableExtension(path)) {
      if (typeof value === 'string') {
        fileRefContent = value;
      } else {
        fileRefContent = shimmedModuleIndicator;
      }
    } else {
      fileRefContent = value as string;
    }

    let fileRef: FileRef = {
      path,
      content: fileRefContent,
      lastModified: this.#lastModified.get(this.#paths.fileURL(path).href)!,
      created: this.#resourceCreatedAt.get(this.#paths.fileURL(path).href)!,
    };

    if (fileRefContent === shimmedModuleIndicator) {
      fileRef[Symbol.for('shimmed-module')] = value as object;
    }

    return fileRef;
  }

  async write(
    path: LocalPath,
    contents: string | object,
  ): Promise<FileWriteResult> {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    let exists = await this.exists(path);
    if (dir.kind === 'file') {
      throw new Error(`treated file as a directory`);
    }
    if (dir.contents[name]?.kind === 'directory') {
      throw new Error(
        `cannot write file over an existing directory at ${path}`,
      );
    }

    let updateEvent: FileAddedEventContent | FileUpdatedEventContent;

    let lastModified = unixTime(Date.now());
    this.#lastModified.set(this.#paths.fileURL(path).href, lastModified);

    if (dir.contents[name]) {
      updateEvent = {
        eventName: 'update',
        updated: path,
      };
    } else {
      updateEvent = {
        eventName: 'update',
        added: path,
      };

      this.#resourceCreatedAt.set(this.#paths.fileURL(path).href, lastModified);
    }

    dir.contents[name] = {
      kind: 'file',
      content:
        typeof contents === 'string'
          ? contents
          : JSON.stringify(contents, null, 2),
    };

    this.postUpdateEvent(updateEvent);

    return {
      path,
      lastModified,
      created: lastModified,
      isNew: !exists,
    };
  }

  postUpdateEvent(data: UpdateRealmEventContent) {
    this.#subscriber?.(data);
  }

  async remove(path: LocalPath) {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (dir.kind === 'file') {
      throw new Error(`tried to use file as directory`);
    }
    delete dir.contents[name];

    this.postUpdateEvent({
      eventName: 'update',
      removed: path,
    });
  }

  #traverse(
    segments: string[],
    targetKind: Kind,
    originalPath = segments.join('/'),
  ): File | Dir {
    let dir: Dir | File = this.#files;
    while (segments.length > 0) {
      if (dir.kind === 'file') {
        throw new Error(`tried to use file as directory`);
      }
      let name = segments.shift()!;
      if (name === '') {
        return dir;
      }
      if (dir.contents[name] === undefined) {
        if (
          segments.length > 0 ||
          (segments.length === 0 && targetKind === 'directory')
        ) {
          dir.contents[name] = { kind: 'directory', contents: {} };
        } else if (segments.length === 0 && targetKind === 'file') {
          let err = new Error(`${originalPath} not found`);
          err.name = 'NotFoundError'; // duck type to the same as what the FileSystem API looks like
          throw err;
        }
      }
      dir = dir.contents[name];
    }
    return dir;
  }

  createStreamingResponse(
    _request: Request,
    requestContext: RequestContext,
    responseInit: ResponseInit,
    cleanup: () => void,
  ) {
    let s = new WebMessageStream();
    let response = createResponse({
      body: s.readable,
      init: responseInit,
      requestContext,
    });
    messageCloseHandler(s.readable, cleanup);
    return { response, writable: s.writable };
  }

  get fileWatcherEnabled() {
    return false;
  }

  async subscribe(
    cb: (message: UpdateRealmEventContent) => void,
  ): Promise<void> {
    this.#subscriber = cb;
  }

  unsubscribe(): void {
    this.#subscriber = undefined;
  }

  async lintStub(
    request: Request,
    _requestContext: RequestContext,
  ): Promise<LintResult> {
    return {
      output: await request.text(),
      fixed: false,
      messages: [],
    };
  }
}
