import { parse } from 'date-fns';
import { Realm, Kind } from '@cardstack/runtime-common';

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export interface Dir {
  [name: string]: string | Dir;
}

export class TestRealm extends Realm {
  #files: Dir = {};
  #lastModified: Map<string, number> = new Map();

  constructor(flatFiles: Record<string, string | object>) {
    super('http://test-realm/');
    let now = Date.now();
    for (let [path, content] of Object.entries(flatFiles)) {
      let segments = path.split('/');
      let last = segments.pop()!;
      let dir = this.#traverse(segments, 'directory');
      if (typeof dir === 'string') {
        throw new Error(`tried to use file as directory`);
      }
      this.#lastModified.set(new URL(path, this.url).pathname, now);
      if (typeof content === 'string') {
        dir[last] = content;
      } else {
        dir[last] = JSON.stringify(content);
      }
    }
  }

  #traverse(
    segments: string[],
    targetKind: Kind,
    originalPath = segments.join('/')
  ): string | Dir {
    let dir: Dir | string = this.#files;
    segments = segments.filter(Boolean); // this emulates our actual traverse's trimming or leading and traililng /'s
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

  async *readdir(
    path: string
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    let dir =
      path === '' ? this.#files : this.#traverse(path.split('/'), 'directory');
    for (let [name, content] of Object.entries(dir)) {
      yield {
        name,
        path: path === '' ? name : `${path}${name}`,
        kind: typeof content === 'string' ? 'file' : 'directory',
      };
    }
  }

  async readFileAsText(path: string): Promise<string> {
    return super.readFileAsText(path);
  }

  get files() {
    return this.#files;
  }

  get lastModified() {
    return this.#lastModified;
  }

  async handle(request: Request): Promise<Response> {
    if (request.headers.get('Accept')?.includes('application/vnd.api+json')) {
      return await this.handleJSONAPI(request);
    } else if (
      request.headers.get('Accept')?.includes('application/vnd.card+source')
    ) {
      throw new Error(
        `TestRealm does not implement application/vnd.card+source requests: ${request.method} ${request.url}`
      );
    }
    throw new Error(
      `TestRealm does not implement request ${request.method} ${request.url}`
    );
  }

  async openFile(path: string): Promise<string> {
    let contents = this.#traverse(path.replace(/^\//, '').split('/'), 'file');
    if (typeof contents !== 'string') {
      throw new Error('treated directory as a file');
    }
    return contents;
  }

  protected async statFile(
    path: string
  ): Promise<{ lastModified: number } | undefined> {
    let lastModified = this.#lastModified.get(path);
    if (lastModified === undefined) {
      return undefined;
    }
    return { lastModified };
  }

  protected async write(
    path: string,
    contents: string | object
  ): Promise<{ lastModified: number }> {
    let segments = path.replace(/^\//, '').split('/');
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
    this.#lastModified.set(new URL(path, this.url).pathname, lastModified);
    return { lastModified };
  }
}
