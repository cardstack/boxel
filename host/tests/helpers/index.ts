import { parse } from 'date-fns';
import { Realm, Kind } from '@cardstack/runtime-common';

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

interface Dir {
  [name: string]: string | Dir;
}

export class TestRealm extends Realm {
  #files: Dir = {};

  constructor(flatFiles: Record<string, string | object>) {
    super('http://test-realm/');
    for (let [path, content] of Object.entries(flatFiles)) {
      let segments = path.split('/');
      let last = segments.pop()!;
      let dir = this.#traverse(segments);
      if (typeof dir === 'string') {
        throw new Error(`tried to use file as directory`);
      }
      if (typeof content === 'string') {
        dir[last] = content;
      } else {
        dir[last] = JSON.stringify(content);
      }
    }
  }

  #traverse(segments: string[]): string | Dir {
    let dir: Dir | string = this.#files;
    while (segments.length > 0) {
      if (typeof dir === 'string') {
        throw new Error(`tried to use file as directory`);
      }
      let name = segments.shift()!;
      if (!dir[name]) {
        dir[name] = {};
      }
      dir = dir[name];
    }
    return dir;
  }

  async *readdir(
    path: string
  ): AsyncGenerator<{ name: string; path: string; kind: Kind }, void> {
    let dir = path === '' ? this.#files : this.#traverse(path.split('/'));
    for (let [name, content] of Object.entries(dir)) {
      yield {
        name,
        path: path === '' ? name : `${path}/${name}`,
        kind: typeof content === 'string' ? 'file' : 'directory',
      };
    }
  }

  get files() {
    return this.#files;
  }

  async openFile(path: string): Promise<string> {
    let contents = this.#traverse(path.split('/'));
    if (typeof contents !== 'string') {
      throw new Error('treated directory as a file');
    }
    return contents;
  }
}
