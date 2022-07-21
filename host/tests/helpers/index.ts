import { parse } from 'date-fns';
import { Realm, Kind, RealmAdapter, FileRef } from '@cardstack/runtime-common';
import { RealmPaths, LocalPath } from '@cardstack/runtime-common/paths';
import type { Readable } from 'stream';

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export interface Dir {
  [name: string]: string | Dir;
}

export const TestRealm = {
  create(flatFiles: Record<string, string | object>, realmURL?: URL): Realm {
    return new Realm(
      realmURL?.href ?? 'http://test-realm/',
      new TestRealmAdapter(flatFiles)
    );
  },
  createWithAdapter(adapter: RealmAdapter, realmURL?: URL): Realm {
    return new Realm(realmURL?.href ?? 'http://test-realm/', adapter);
  },
};

export class TestRealmAdapter implements RealmAdapter {
  #files: Dir = {};
  #lastModified: Map<string, number> = new Map();
  #paths: RealmPaths;

  constructor(flatFiles: Record<string, string | object>, realmURL?: URL) {
    this.#paths = new RealmPaths(realmURL ?? new URL('http://test-realm/'));
    let now = Date.now();
    for (let [path, content] of Object.entries(flatFiles)) {
      let segments = path.split('/');
      let last = segments.pop()!;
      let dir = this.#traverse(segments, 'directory');
      if (typeof dir === 'string') {
        throw new Error(`tried to use file as directory`);
      }
      this.#lastModified.set(this.#paths.fileURL(path).href, now);
      if (typeof content === 'string') {
        dir[last] = content;
      } else {
        dir[last] = JSON.stringify(content);
      }
    }
  }

  get lastModified() {
    return this.#lastModified;
  }

  async *readdir(
    path: string
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

  async openFile(path: LocalPath): Promise<FileRef | undefined> {
    let content;
    try {
      content = this.#traverse(path.replace(/^\//, '').split('/'), 'file');
    } catch (err: any) {
      if (['TypeMismatchError', 'NotFoundError'].includes(err.name)) {
        return undefined;
      }
      throw err;
    }
    if (typeof content !== 'string') {
      throw new Error('treated directory as a file');
    }
    return {
      path,
      content,
      lastModified: this.#lastModified.get(this.#paths.fileURL(path).href)!,
    };
  }

  async write(
    path: LocalPath,
    contents: string | object
  ): Promise<{ lastModified: number }> {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (typeof dir === 'string') {
      throw new Error(`treated file as a directory`);
    }
    if (typeof dir[name] === 'object') {
      throw new Error(
        `cannot write file over an existing directory at ${path}`
      );
    }
    dir[name] =
      typeof contents === 'string'
        ? contents
        : JSON.stringify(contents, null, 2);
    let lastModified = Date.now();
    this.#lastModified.set(this.#paths.fileURL(path).href, lastModified);
    return { lastModified };
  }

  async remove(path: LocalPath) {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (typeof dir === 'string') {
      throw new Error(`tried to use file as directory`);
    }
    delete dir[name];
  }

  async streamToText(
    _stream: Readable | ReadableStream<Uint8Array>
  ): Promise<string> {
    throw new Error('streaming not yet implemented in tests');
  }

  #traverse(
    segments: string[],
    targetKind: Kind,
    originalPath = segments.join('/')
  ): string | Dir {
    let dir: Dir | string = this.#files;
    while (segments.length > 0) {
      if (typeof dir === 'string') {
        throw new Error(`tried to use file as directory`);
      }
      let name = segments.shift()!;
      if (!dir[name]) {
        if (
          segments.length > 0 ||
          (segments.length === 0 && targetKind === 'directory')
        ) {
          dir[name] = {};
        } else if (segments.length === 0 && targetKind === 'file') {
          let err = new Error(`${originalPath} not found`);
          err.name = 'NotFoundError'; // duck type to the same as what the FileSystem API looks like
          throw err;
        }
      }
      dir = dir[name];
    }
    return dir;
  }
}
