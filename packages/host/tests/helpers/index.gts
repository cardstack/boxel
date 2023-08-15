import { parse } from 'date-fns';
import {
  Kind,
  RealmAdapter,
  FileRef,
  LooseSingleCardDocument,
  baseRealm,
  createResponse,
  RealmInfo,
  Deferred,
} from '@cardstack/runtime-common';
import GlimmerComponent from '@glimmer/component';
import { type TestContext, visit } from '@ember/test-helpers';
import { LocalPath } from '@cardstack/runtime-common/paths';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';
import { renderComponent } from './render-component';
import Service from '@ember/service';
import CardPrerender from '@cardstack/host/components/card-prerender';
import { type Card } from 'https://cardstack.com/base/card-api';
import {
  RunnerOptionsManager,
  type RunState,
  type RunnerRegistration,
  type EntrySetter,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';
import { WebMessageStream, messageCloseHandler } from './stream';
import type CardService from '@cardstack/host/services/card-service';
import type { CardSaveSubscriber } from '@cardstack/host/services/card-service';
import { file, Ready, isReady } from '@cardstack/host/resources/file';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import type MessageService from '@cardstack/host/services/message-service';
import Owner from '@ember/owner';
import { OpenFiles } from '@cardstack/host/controllers/code';

type CardAPI = typeof import('https://cardstack.com/base/card-api');

export function cleanWhiteSpace(text: string) {
  // this also normalizes non-breaking space characters which seem
  // to be appearing in date/time serialization in some envs
  return text.replace(/[\s ]+/g, ' ').trim();
}

export function trimCardContainer(text: string) {
  return cleanWhiteSpace(text).replace(
    /<div .*? data-test-field-component-card> (.*?) <\/div> <\/div>/,
    '$1'
  );
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export interface Dir {
  [name: string]: string | Dir;
}

export const testRealmURL = `http://test-realm/test/`;
export const testRealmInfo: RealmInfo = {
  name: 'Unnamed Workspace',
  backgroundURL: null,
  iconURL: null,
};

export interface CardDocFiles {
  [filename: string]: LooseSingleCardDocument;
}

export interface TestContextWithSave extends TestContext {
  onSave: (subscriber: CardSaveSubscriber) => void;
  unregisterOnSave: () => void;
}

export interface TestContextWithSSE extends TestContext {
  expectEvents: (
    assert: Assert,
    realm: Realm,
    adapter: TestRealmAdapter,
    expectedContents: string[],
    callback: () => Promise<any>,
  ) => Promise<any>;
  subscribers: ((e: { data: string }) => void)[];
}

interface Options {
  realmURL?: string;
  isAcceptanceTest?: true;
}

// We use a rendered component to facilitate our indexing (this emulates
// the work that the Fastboot renderer is doing), which means that the
// `setupRenderingTest(hooks)` from ember-qunit must be used in your tests.
export const TestRealm = {
  async create(
    loader: Loader,
    flatFiles: Record<string, string | LooseSingleCardDocument | CardDocFiles>,
    owner: Owner,
    opts?: Options
  ): Promise<Realm> {
    if (opts?.isAcceptanceTest) {
      await visit('/');
    } else {
      await makeRenderer();
    }
    return makeRealm(
      new TestRealmAdapter(flatFiles),
      loader,
      owner,
      opts?.realmURL
    );
  },

  async createWithAdapter(
    adapter: RealmAdapter,
    loader: Loader,
    owner: Owner,
    opts?: Options
  ): Promise<Realm> {
    if (opts?.isAcceptanceTest) {
      await visit('/acceptance-test-setup');
    } else {
      await makeRenderer();
    }
    return makeRealm(adapter, loader, owner, opts?.realmURL);
  },
};

async function makeRenderer() {
  // This emulates the application.hbs
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardPrerender />
      </template>
    }
  );
}

class MockLocalIndexer extends Service {
  url = new URL(testRealmURL);
  #adapter: RealmAdapter | undefined;
  #entrySetter: EntrySetter | undefined;
  #fromScratch: ((realmURL: URL) => Promise<RunState>) | undefined;
  #incremental:
    | ((
        prev: RunState,
        url: URL,
        operation: 'update' | 'delete'
      ) => Promise<RunState>)
    | undefined;
  setup(
    fromScratch: (realmURL: URL) => Promise<RunState>,
    incremental: (
      prev: RunState,
      url: URL,
      operation: 'update' | 'delete'
    ) => Promise<RunState>
  ) {
    this.#fromScratch = fromScratch;
    this.#incremental = incremental;
  }
  async configureRunner(
    registerRunner: RunnerRegistration,
    entrySetter: EntrySetter,
    adapter: RealmAdapter
  ) {
    if (!this.#fromScratch || !this.#incremental) {
      throw new Error(
        `fromScratch/incremental not registered with MockLocalIndexer`
      );
    }
    this.#entrySetter = entrySetter;
    this.#adapter = adapter;
    await registerRunner(
      this.#fromScratch.bind(this),
      this.#incremental.bind(this)
    );
  }
  async setEntry(url: URL, entry: SearchEntryWithErrors) {
    if (!this.#entrySetter) {
      throw new Error(`entrySetter not registered with MockLocalIndexer`);
    }
    this.#entrySetter(url, entry);
  }
  get adapter() {
    if (!this.#adapter) {
      throw new Error(`adapter has not been set on MockLocalIndexer`);
    }
    return this.#adapter;
  }
}

export function setupLocalIndexing(hooks: NestedHooks) {
  hooks.beforeEach(function () {
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });
}

class MockMessageService extends Service {
  subscribe() {
    return () => {};
  }
  register() {}
}

export function setupOnSave(hooks: NestedHooks) {
  hooks.beforeEach<TestContextWithSave>(function () {
    let cardService = this.owner.lookup('service:card-service') as CardService;
    this.onSave = cardService.onSave.bind(cardService);
    this.unregisterOnSave =
      cardService.unregisterSaveSubscriber.bind(cardService);
  });
}

export function setupMockMessageService(hooks: NestedHooks) {
  hooks.beforeEach(function () {
    this.owner.register('service:message-service', MockMessageService);
  });
}

export function setupServerSentEvents(hooks: NestedHooks) {
  hooks.beforeEach<TestContextWithSSE>(function () {
    this.subscribers = [];
    let self = this;

    class MockMessageService extends Service {
      register() {
        (globalThis as any)._CARDSTACK_REALM_SUBSCRIBE = this;
      }
      subscribe(_: never, cb: (e: { data: string }) => void) {
        self.subscribers.push(cb);
        return () => {};
      }
    }
    this.owner.register('service:message-service', MockMessageService);
    let messageService = this.owner.lookup(
      'service:message-service',
    ) as MessageService;
    messageService.register();

    this.expectEvents = async <T,>(
      assert: Assert,
      realm: Realm,
      adapter: TestRealmAdapter,
      expectedContents: string[],
      callback: () => Promise<T>,
    ): Promise<T> => {
      let defer = new Deferred<string[]>();
      let events: string[] = [];
      let response = await realm.handle(
        new Request(`${realm.url}_message`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
          },
        }),
      );
      if (!response.ok) {
        throw new Error(`failed to connect to realm: ${response.status}`);
      }
      let reader = response.body!.getReader();
      let timeout = setTimeout(() => {
        defer.reject(
          new Error(
            `expectEvent timed out, saw events ${JSON.stringify(events)}`,
          ),
        );
      }, 3000);
      let result = await callback();
      let decoder = new TextDecoder();
      while (events.length < expectedContents.length) {
        let { done, value } = await reader.read();
        if (done) {
          throw new Error('expected more events');
        }
        if (value) {
          let data = getUpdateData(decoder.decode(value, { stream: true }));
          if (data) {
            events.push(data);
            for (let subscriber of this.subscribers) {
              subscriber({ data });
            }
          }
        }
      }
      assert.deepEqual(events, expectedContents, 'sse response is correct');
      clearTimeout(timeout);
      adapter.unsubscribe();
      return result;
    };
  });
}

function getUpdateData(message: string) {
  let [type, data] = message.split('\n');
  if (type.trim().split(':')[1].trim() === 'update') {
    return data.split('data:')[1].trim();
  }
  return;
}

let runnerOptsMgr = new RunnerOptionsManager();
function makeRealm(
  adapter: RealmAdapter,
  loader: Loader,
  owner: Owner,
  realmURL = testRealmURL
) {
  let localIndexer = owner.lookup(
    'service:local-indexer'
  ) as unknown as MockLocalIndexer;
  return new Realm(
    realmURL,
    adapter,
    loader,
    async (optsId) => {
      let { registerRunner, entrySetter } = runnerOptsMgr.getOptions(optsId);
      await localIndexer.configureRunner(registerRunner, entrySetter, adapter);
    },
    runnerOptsMgr,
    async () =>
      `<html><body>Intentionally empty index.html (these tests will not exercise this capability)</body></html>`
  );
}

export async function saveCard(instance: Card, id: string, loader: Loader) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  await api.updateFromSerialized(instance, doc);
}

export async function shimModule(
  moduleURL: string,
  module: Record<string, any>,
  loader: Loader
) {
  if (loader) {
    loader.shimModule(moduleURL, module);
  }
  await Promise.all(
    Object.keys(module).map(async (name) => {
      let m = await loader.import<any>(moduleURL);
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
  #subscriber: ((message: Record<string, any>) => void) | undefined;

  constructor(
    flatFiles: Record<
      string,
      string | LooseSingleCardDocument | CardDocFiles | RealmInfo
    >,
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

    let type = dir[name] ? 'updated' : 'added';
    dir[name] =
      typeof contents === 'string'
        ? contents
        : JSON.stringify(contents, null, 2);
    let lastModified = Date.now();
    this.#lastModified.set(this.#paths.fileURL(path).href, lastModified);

    this.postUpdateEvent({ [type]: [path] });

    return { lastModified };
  }

  postUpdateEvent(data: Record<string, any>) {
    this.#subscriber?.(data);
  }

  async remove(path: LocalPath) {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (typeof dir === 'string') {
      throw new Error(`tried to use file as directory`);
    }
    delete dir[name];
    this.postUpdateEvent({ removed: path });
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

  createStreamingResponse(
    _request: Request,
    responseInit: ResponseInit,
    cleanup: () => void
  ) {
    let s = new WebMessageStream();
    let response = createResponse(s.readable, responseInit);
    messageCloseHandler(s.readable, cleanup);
    return { response, writable: s.writable };
  }

  async subscribe(cb: (message: Record<string, any>) => void): Promise<void> {
    this.#subscriber = cb;
  }

  unsubscribe(): void {
    this.#subscriber = undefined;
  }
}

export function delay(delayAmountMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayAmountMs);
  });
}

export async function getFileResource(
  context: TestContext,
  realmURL: string,
  openFiles: OpenFiles,
  lastModified?: string
): Promise<Ready> {
  if (openFiles.path === undefined) {
    throw new Error('Wrong relativePath undefined');
  }
  let relativePath = openFiles.path;
  let f = file(context, () => ({
    relativePath,
    realmURL: new RealmPaths(realmURL).url,
    onStateChange: (state) => {
      if (state === 'not-found') {
        openFiles.path = undefined;
      }
    },
  }));
  if (f.state == 'loading') {
    await f.ready(lastModified);
  }
  if (!isReady(f)) {
    throw new Error(
      `Resource is in ${f.state} state. It should be in Ready state`
    );
  }
  return f;
}

function changedEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number }
) {
  return listings.some(
    (item) =>
      item.path === entry.path && item.lastModified != entry.lastModified
  );
}

function hasEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number }
) {
  return listings.some((item) => item.path === entry.path);
}

export function diff(
  prevEntries: { path: string; lastModified?: number }[],
  currEntries: { path: string; lastModified?: number }[]
) {
  let changed = prevEntries.filter((entry) => changedEntry(currEntries, entry));
  let added = currEntries.filter((entry) => !hasEntry(prevEntries, entry));
  let removed = prevEntries.filter((entry) => !hasEntry(currEntries, entry));

  return {
    added: added.map((e) => e.path),
    removed: removed.map((e) => e.path),
    changed: changed.map((e) => e.path),
  };
}
