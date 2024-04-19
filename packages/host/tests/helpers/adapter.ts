import {
  Loader,
  LocalPath,
  RealmAdapter,
  RealmPaths,
  baseRealm,
  createResponse,
} from '@cardstack/runtime-common';

import {
  FileRef,
  Kind,
  Realm,
  TokenClaims,
  UpdateEventData,
} from '@cardstack/runtime-common/realm';

import { WebMessageStream, messageCloseHandler } from './stream';

import { createJWT, testRealmURL } from '.';

interface Dir {
  kind: 'dir';
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
  #files: Dir = { kind: 'dir', contents: {} };
  #lastModified: Map<string, number> = new Map();
  #paths: RealmPaths;
  #subscriber: ((message: UpdateEventData) => void) | undefined;

  constructor(realmURL = new URL(testRealmURL)) {
    this.#paths = new RealmPaths(realmURL);
  }

  async setContents(contents: TestAdapterContents) {
    let now = Date.now();

    for (let [path, content] of Object.entries(contents)) {
      let segments = path.split('/');
      let last = segments.pop()!;
      let dir = this.#traverse(segments, 'directory');
      if (dir.kind === 'file') {
        throw new Error(`tried to use file as directory`);
      }
      this.#lastModified.set(this.#paths.fileURL(path).href, now);
      dir.contents[last] = { kind: 'file', content };
    }
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
      if (expiration > Date.now() / 1000) {
        throw new TokenExpiredError(`JWT token expired at ${expiration}`);
      }
      return claims;
    }
    throw new JsonWebTokenError(`unable to verify JWT: ${token}`);
  }

  get lastModified() {
    return this.#lastModified;
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
    for (let [name, content] of Object.entries(dir)) {
      yield {
        name,
        path: path === '' ? name : `${path}/${name}`,
        kind: typeof content === 'string' ? 'file' : 'directory',
      };
    }
  }

  async exists(path: string): Promise<boolean> {
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

  async openFile(
    path: LocalPath,
    loader: Loader,
  ): Promise<FileRef | undefined> {
    let content;
    try {
      content = this.#traverse(path.split('/'), 'file');
    } catch (err: any) {
      if (['TypeMismatchError', 'NotFoundError'].includes(err.name)) {
        return undefined;
      }
      throw err;
    }
    if (content.kind === 'dir') {
      return undefined;
    }

    let value = content.content;
    if (path.endsWith('.json')) {
      let cardApi = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
      if (cardApi.isCard(value)) {
        // shimmmed card instance
        value.id = `${this.#paths.url}${path.replace(/\.json$/, '')}`;
        cardApi.setCardAsSavedForTest(value);
      }
    }

    if (path.endsWith('.gts') && typeof value !== 'string') {
      // shimmed module. Load it through the loader so it gets into the identity map
      let moduleURLString = `${this.#paths.url}${path.replace(/\.gts$/, '')}`;
      loader.shimModule(moduleURLString, value as object);
    }

    let fileRef: FileRef = {
      path,
      content,
      lastModified: this.#lastModified.get(this.#paths.fileURL(path).href)!,
    };

    if (content === shimmedModuleIndicator) {
      fileRef[Symbol.for('shimmed-module')] = this.#contents[path] as object;
    }

    return fileRef;
  }

  async write(
    path: LocalPath,
    contents: string | object,
  ): Promise<{ lastModified: number }> {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (dir.kind === 'file') {
      throw new Error(`treated file as a directory`);
    }
    if (dir.contents[name].kind === 'dir') {
      throw new Error(
        `cannot write file over an existing directory at ${path}`,
      );
    }

    let type = dir.contents[name] ? 'updated' : 'added';
    dir.contents[name] = {
      kind: 'file',
      content:
        typeof contents === 'string'
          ? contents
          : JSON.stringify(contents, null, 2),
    };
    let lastModified = Date.now();
    this.#lastModified.set(this.#paths.fileURL(path).href, lastModified);

    this.postUpdateEvent({ [type]: path } as
      | { added: string }
      | { updated: string });

    return { lastModified };
  }

  postUpdateEvent(data: UpdateEventData) {
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
    this.postUpdateEvent({ removed: path });
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
          dir.contents[name] = { kind: 'dir', contents: {} };
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
    realm: Realm,
    _request: Request,
    responseInit: ResponseInit,
    cleanup: () => void,
  ) {
    let s = new WebMessageStream();
    let response = createResponse(realm, s.readable, responseInit);
    messageCloseHandler(s.readable, cleanup);
    return { response, writable: s.writable };
  }

  async subscribe(cb: (message: UpdateEventData) => void): Promise<void> {
    this.#subscriber = cb;
  }

  unsubscribe(): void {
    this.#subscriber = undefined;
  }
}
