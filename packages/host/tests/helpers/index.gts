import { parse } from 'date-fns';
import {
  Kind,
  RealmAdapter,
  FileRef,
  LooseSingleCardDocument,
  baseRealm,
} from '@cardstack/runtime-common';
import GlimmerComponent from '@glimmer/component';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { TestContext } from '@ember/test-helpers';
import { RealmPaths, LocalPath } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { renderComponent } from './render-component';
import WorkerRenderer from '@cardstack/host/services/worker-renderer';
import WorkerRender from '@cardstack/host/components/worker-render';
import { type Card } from 'https://cardstack.com/base/card-api';

type CardAPI = typeof import('https://cardstack.com/base/card-api');

export function cleanWhiteSpace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export interface Dir {
  [name: string]: string | Dir;
}

export const testRealmURL = 'http://test-realm/test/';

export interface CardDocFiles {
  [filename: string]: LooseSingleCardDocument;
}

// We use a rendered component to facilitate our indexing (this emulates
// the work that the service worker renderer is doing), which means that the
// `setupRenderingTest(hooks)` from ember-qunit must be used in your tests. 
export const TestRealm = {
  async create(
    flatFiles: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
    owner: TestContext['owner'],
    realmURL?: string
  ): Promise<Realm> {
    await makeRenderer();
    return makeRealm(new TestRealmAdapter(flatFiles), owner, realmURL);
  },

  async createWithAdapter(
    adapter: RealmAdapter,
    owner: TestContext['owner'],
    realmURL?: string
  ): Promise<Realm> {
    await makeRenderer();
    return makeRealm(adapter, owner, realmURL);
  },
};

async function makeRenderer() {
  // This emulates the application.hbs
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <template shadowroot="open">
          <WorkerRender/>
        </template>
      </template>
    }
  );
}

function makeRealm(
  adapter: RealmAdapter,
  owner: TestContext['owner'],
  realmURL = testRealmURL
) {
  let renderService = owner.lookup('service:worker-renderer') as WorkerRenderer;
  return new Realm(
    realmURL ?? testRealmURL,
    adapter,
    (_fetch: typeof fetch, staticResponses: Map<string, string>) =>
      async (url: string) => {
        let deferred = new Deferred<string>();
        await renderService.visit(
          `/render?url=${encodeURIComponent(url)}&format=isolated`,
          staticResponses,
          (html: string) => deferred.fulfill(html)
        );
        return await deferred.promise;
      }
  );
}

export async function saveCard(
  instance: Card,
  id: string,
  loader: Loader = Loader.getLoader()
) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  await api.updateFromSerialized(instance, doc);
}

export async function shimModule(
  moduleURL: string,
  module: Record<string, any>,
  loader?: Loader
) {
  // this allows the current run's loader to pick up the shimmed value as well
  // which is seeded from the global loader
  Loader.shimModule(moduleURL, module);

  if (loader) {
    loader.shimModule(moduleURL, module);
  }
  await Promise.all(
    Object.keys(module).map(async (name) => {
      let m = await Loader.import<any>(moduleURL);
      m[name];
    })
  );
}

export function setupCardLogs(
  hooks: NestedHooks,
  apiThunk: () => Promise<CardAPI>
) {
  hooks.afterEach(async function () {
    let api = await apiThunk();
    await api.flushLogs();
  });
}

export class TestRealmAdapter implements RealmAdapter {
  #files: Dir = {};
  #lastModified: Map<string, number> = new Map();
  #paths: RealmPaths;

  constructor(
    flatFiles: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
    realmURL = new URL(testRealmURL)
  ) {
    this.#paths = new RealmPaths(realmURL);
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

  // this is to aid debugging since privates are actually not visible in the debugger
  get files() {
    return this.#files;
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

  async exists(path: string): Promise<boolean> {
    try {
      await this.#traverse(path.split('/'), 'directory');
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
    let content;
    try {
      content = this.#traverse(path.split('/'), 'file');
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
      if (name === '') {
        return dir;
      }
      if (dir[name] === undefined) {
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
