import Service from '@ember/service';
import { type TestContext, getContext, visit } from '@ember/test-helpers';
import { findAll, waitUntil, waitFor, click } from '@ember/test-helpers';
import { buildWaiter } from '@ember/test-waiters';
import GlimmerComponent from '@glimmer/component';

import { formatRFC7231, parse } from 'date-fns';

import ms from 'ms';

import {
  Kind,
  RealmAdapter,
  FileRef,
  LooseSingleCardDocument,
  baseRealm,
  createResponse,
  RealmInfo,
  Deferred,
  executableExtensions,
  SupportedMimeType,
  type TokenClaims,
} from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';
import { LocalPath, RealmPaths } from '@cardstack/runtime-common/paths';
import { Realm } from '@cardstack/runtime-common/realm';

import type { UpdateEventData } from '@cardstack/runtime-common/realm';
import {
  RunnerOptionsManager,
  type RunState,
  type RunnerRegistration,
  type EntrySetter,
  type SearchEntryWithErrors,
} from '@cardstack/runtime-common/search-index';
import { getFileWithFallbacks } from '@cardstack/runtime-common/stream';

import CardPrerender from '@cardstack/host/components/card-prerender';

import type CardService from '@cardstack/host/services/card-service';
import type { CardSaveSubscriber } from '@cardstack/host/services/card-service';

import type MessageService from '@cardstack/host/services/message-service';

import {
  type CardDef,
  type FieldDef,
} from 'https://cardstack.com/base/card-api';

import percySnapshot from './percy-snapshot';

import { renderComponent } from './render-component';
import { WebMessageStream, messageCloseHandler } from './stream';
import visitOperatorMode from './visit-operator-mode';

export { percySnapshot };
export { visitOperatorMode };

const waiter = buildWaiter('@cardstack/host/test/helpers/index:onFetch-waiter');

type CardAPI = typeof import('https://cardstack.com/base/card-api');
const testMatrix = {
  url: new URL(`http://localhost:8008`),
  username: 'test_realm',
  password: 'password',
};

export function cleanWhiteSpace(text: string) {
  // this also normalizes non-breaking space characters which seem
  // to be appearing in date/time serialization in some envs
  // eslint-disable-next-line no-irregular-whitespace
  return text.replace(/[\s ]+/g, ' ').trim();
}

export function trimCardContainer(text: string) {
  return cleanWhiteSpace(text).replace(
    /<div .*? data-test-field-component-card>\s?[<!---->]*? (.*?) <\/div>/g,
    '$1',
  );
}

export function p(dateString: string): Date {
  return parse(dateString, 'yyyy-MM-dd', new Date());
}

export function getMonacoContent(): string {
  return (window as any).monaco.editor.getModels()[0].getValue();
}

export function setMonacoContent(content: string): string {
  return (window as any).monaco.editor.getModels()[0].setValue(content);
}

export async function waitForCodeEditor() {
  // need a moment for the monaco SDK to load
  return await waitFor('[data-test-editor]', { timeout: 3000 });
}

export async function waitForSyntaxHighlighting(
  textContent: string,
  color: string,
) {
  let codeTokens;
  let finalHighlightedToken: Element | undefined;

  await waitUntil(
    () => {
      codeTokens = findAll('.view-line span span');
      finalHighlightedToken = codeTokens.find(
        (t) => t.innerHTML === textContent,
      );
      return finalHighlightedToken;
    },
    {
      timeout: 10000, // need to wait for monaco to load
      timeoutMessage: `timed out waiting for \`${textContent}\` token`,
    },
  );

  await waitUntil(
    () =>
      finalHighlightedToken?.computedStyleMap()?.get('color')?.toString() ===
      color,
    {
      timeout: 2000,
      timeoutMessage: 'timed out waiting for syntax highlighting',
    },
  );
}
export async function showSearchResult(realmName: string, id: string) {
  await waitFor(`[data-test-realm="${realmName}"] [data-test-select]`);
  while (
    document.querySelector(
      `[data-test-realm="${realmName}"] [data-test-show-more-cards]`,
    ) &&
    !document.querySelector(
      `[data-test-realm="${realmName}"] [data-test-select="${id}"]`,
    )
  ) {
    await click(`[data-test-realm="${realmName}"] [data-test-show-more-cards]`);
  }
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
  expectEvents: (args: {
    assert: Assert;
    realm: Realm;
    expectedEvents?: { type: string; data: Record<string, any> }[];
    expectedNumberOfEvents?: number;
    onEvents?: (events: { type: string; data: Record<string, any> }[]) => void;
    callback: () => Promise<any>;
    opts?: { timeout?: number };
  }) => Promise<any>;
  subscribers: ((e: { type: string; data: string }) => void)[];
}

async function makeRenderer() {
  // This emulates the application.hbs
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardPrerender />
      </template>
    },
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
        operation: 'update' | 'delete',
      ) => Promise<RunState>)
    | undefined;
  setup(
    fromScratch: (realmURL: URL) => Promise<RunState>,
    incremental: (
      prev: RunState,
      url: URL,
      operation: 'update' | 'delete',
    ) => Promise<RunState>,
  ) {
    this.#fromScratch = fromScratch;
    this.#incremental = incremental;
  }
  async configureRunner(
    registerRunner: RunnerRegistration,
    entrySetter: EntrySetter,
    adapter: RealmAdapter,
  ) {
    if (!this.#fromScratch || !this.#incremental) {
      throw new Error(
        `fromScratch/incremental not registered with MockLocalIndexer`,
      );
    }
    this.#entrySetter = entrySetter;
    this.#adapter = adapter;
    await registerRunner(
      this.#fromScratch.bind(this),
      this.#incremental.bind(this),
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
      subscribe(_: never, cb: (e: { type: string; data: string }) => void) {
        self.subscribers.push(cb);
        return () => {};
      }
    }
    this.owner.register('service:message-service', MockMessageService);
    let messageService = this.owner.lookup(
      'service:message-service',
    ) as MessageService;
    messageService.register();

    this.expectEvents = async <T,>({
      assert,
      realm,
      expectedEvents,
      expectedNumberOfEvents,
      onEvents,
      callback,
      opts,
    }: {
      assert: Assert;
      realm: Realm;
      expectedEvents?: { type: string; data: Record<string, any> }[];
      expectedNumberOfEvents?: number;
      onEvents?: (
        events: { type: string; data: Record<string, any> }[],
      ) => void;
      callback: () => Promise<T>;
      opts?: { timeout?: number };
    }): Promise<T> => {
      let defer = new Deferred();
      let events: { type: string; data: Record<string, any> }[] = [];
      let numOfEvents = expectedEvents?.length ?? expectedNumberOfEvents;
      if (numOfEvents == null) {
        throw new Error(
          `expectEvents() must specify either 'expectedEvents' or 'expectedNumberOfEvents'`,
        );
      }
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
      let timeout = setTimeout(
        () =>
          defer.reject(
            new Error(
              `expectEvent timed out, saw events ${JSON.stringify(events)}`,
            ),
          ),
        opts?.timeout ?? 3000,
      );
      let result = await callback();
      let decoder = new TextDecoder();
      while (events.length < numOfEvents) {
        let { done, value } = await Promise.race([
          reader.read(),
          defer.promise as any, // this one always throws so type is not important
        ]);
        if (done) {
          throw new Error(
            `expected ${numOfEvents} events, saw ${events.length} events`,
          );
        }
        if (value) {
          let ev = getEventData(decoder.decode(value, { stream: true }));
          if (ev) {
            events.push(ev);
            for (let subscriber of this.subscribers) {
              let evWireFormat = {
                type: ev.type,
                data: JSON.stringify(ev.data),
              };
              subscriber(evWireFormat);
            }
          }
        }
      }
      if (expectedEvents) {
        let eventsWithoutClientRequestId = events.map((e) => {
          delete e.data.clientRequestId;
          return e;
        });
        assert.deepEqual(
          eventsWithoutClientRequestId,
          expectedEvents,
          'sse response is correct',
        );
      }
      if (onEvents) {
        onEvents(events);
      }
      clearTimeout(timeout);
      realm.unsubscribe();
      return result;
    };
  });
}

function getEventData(message: string) {
  let [rawType, data] = message.split('\n');
  let type = rawType.trim().split(':')[1].trim();
  if (['index', 'update'].includes(type)) {
    return {
      type,
      data: JSON.parse(data.split('data:')[1].trim()),
    };
  }
  return;
}

let runnerOptsMgr = new RunnerOptionsManager();

interface RealmContents {
  [key: string]:
    | CardDef
    | FieldDef
    | LooseSingleCardDocument
    | RealmInfo
    | Record<string, unknown>
    | string;
}
export async function setupAcceptanceTestRealm({
  loader,
  contents,
  realmURL,
  onFetch,
}: {
  loader: Loader;
  contents: RealmContents;
  realmURL?: string;
  onFetch?: (req: Request) => Promise<{
    req: Request;
    res: Response | null;
  }>;
}) {
  return await setupTestRealm({
    loader,
    contents,
    realmURL,
    onFetch,
    isAcceptanceTest: true,
  });
}

export async function setupIntegrationTestRealm({
  loader,
  contents,
  realmURL,
  onFetch,
}: {
  loader: Loader;
  contents: RealmContents;
  realmURL?: string;
  onFetch?: (req: Request) => Promise<{
    req: Request;
    res: Response | null;
  }>;
}) {
  return await setupTestRealm({
    loader,
    contents,
    realmURL,
    onFetch,
    isAcceptanceTest: false,
  });
}

export const testRealmSecretSeed = "shhh! it's a secret";
async function setupTestRealm({
  loader,
  contents,
  realmURL,
  onFetch,
  isAcceptanceTest,
}: {
  loader: Loader;
  contents: RealmContents;
  realmURL?: string;
  onFetch?: (req: Request) => Promise<{
    req: Request;
    res: Response | null;
  }>;
  isAcceptanceTest?: boolean;
}) {
  let owner = (getContext() as TestContext).owner;

  realmURL = realmURL ?? testRealmURL;

  for (const [path, mod] of Object.entries(contents)) {
    if (path.endsWith('.gts') && typeof mod !== 'string') {
      let moduleURLString = `${realmURL}${path.replace(/\.gts$/, '')}`;
      await shimModule(moduleURLString, mod as object, loader);
    }
  }
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  for (const [path, value] of Object.entries(contents)) {
    if (path.endsWith('.json') && api.isCard(value)) {
      value.id = `${realmURL}${path.replace(/\.json$/, '')}`;
      api.setCardAsSavedForTest(value);
    }
  }
  for (const [path, value] of Object.entries(contents)) {
    if (path.endsWith('.json') && api.isCard(value)) {
      let doc = api.serializeCard(value);
      contents[path] = doc;
    }
  }

  let flatFiles: Record<string, string> = {};
  for (const [path, value] of Object.entries(contents)) {
    if (path.endsWith('.gts') && typeof value !== 'string') {
      flatFiles[path] = '// this file is shimmed';
    } else if (typeof value === 'string') {
      flatFiles[path] = value;
    } else {
      flatFiles[path] = JSON.stringify(value);
    }
  }
  let adapter = new TestRealmAdapter(flatFiles, new URL(realmURL));
  if (isAcceptanceTest) {
    await visit('/acceptance-test-setup');
  } else {
    // We use a rendered component to facilitate our indexing (this emulates
    // the work that the Fastboot renderer is doing), which means that the
    // `setupRenderingTest(hooks)` from ember-qunit must be used in your tests.
    await makeRenderer();
  }

  let localIndexer = owner.lookup(
    'service:local-indexer',
  ) as unknown as MockLocalIndexer;
  let realm: Realm;
  if (onFetch) {
    // we need to register this before the realm is created so
    // that it is in prime position in the url handlers list
    loader.registerURLHandler(async (req: Request) => {
      let token = waiter.beginAsync();
      try {
        let { req: newReq, res } = await onFetch(req);
        if (res) {
          return res;
        }
        req = newReq;
      } finally {
        waiter.endAsync(token);
      }

      return realm.maybeHandle(req);
    });
  }

  realm = new Realm({
    url: realmURL,
    adapter,
    loader,
    indexRunner: async (optsId) => {
      let { registerRunner, entrySetter } = runnerOptsMgr.getOptions(optsId);
      await localIndexer.configureRunner(registerRunner, entrySetter, adapter);
    },
    runnerOptsMgr,
    getIndexHTML: async () =>
      `<html><body>Intentionally empty index.html (these tests will not exercise this capability)</body></html>`,
    matrix: testMatrix,
    permissions: { '*': ['read', 'write'] },
    realmSecretSeed: testRealmSecretSeed,
  });
  loader.prependURLHandlers([
    (req) => sourceFetchRedirectHandle(req, adapter, realm),
    (req) => sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm)),
  ]);

  await realm.ready;
  return { realm, adapter };
}

export async function saveCard(instance: CardDef, id: string, loader: Loader) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  await api.updateFromSerialized(instance, doc);
  return doc;
}

export async function shimModule(
  moduleURL: string,
  module: Record<string, any>,
  loader: Loader,
) {
  if (loader) {
    loader.shimModule(moduleURL, module);
  }
  await Promise.all(
    Object.keys(module).map(async (name) => {
      let m = await loader.import<any>(moduleURL);
      m[name];
    }),
  );
}

export function setupCardLogs(
  hooks: NestedHooks,
  apiThunk: () => Promise<CardAPI>,
) {
  hooks.afterEach(async function () {
    let api = await apiThunk();
    await api.flushLogs();
  });
}
type FilesForTestAdapter = Record<
  string,
  string | LooseSingleCardDocument | CardDocFiles | RealmInfo
>;

export function createJWT(
  claims: TokenClaims,
  expiration: string,
  secret: string,
) {
  let nowInSeconds = Math.floor(Date.now() / 1000);
  let expires = nowInSeconds + ms(expiration) / 1000;
  let header = { alg: 'none', typ: 'JWT' };
  let payload = {
    iat: nowInSeconds,
    exp: expires,
    ...claims,
  };
  let stringifiedHeader = JSON.stringify(header);
  let stringifiedPayload = JSON.stringify(payload);
  let headerAndPayload = `${btoa(stringifiedHeader)}.${btoa(
    stringifiedPayload,
  )}`;
  // this is our silly JWT--we don't sign with crypto since we are running in the
  // browser so the secret is the signature
  return `${headerAndPayload}.${secret}`;
}

class TokenExpiredError extends Error {}
class JsonWebTokenError extends Error {}

export class TestRealmAdapter implements RealmAdapter {
  #files: Dir = {};
  #lastModified: Map<string, number> = new Map();
  #paths: RealmPaths;
  #subscriber: ((message: UpdateEventData) => void) | undefined;

  constructor(
    flatFiles: FilesForTestAdapter,
    realmURL = new URL(testRealmURL),
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
      return undefined;
    }
    return {
      path,
      content,
      lastModified: this.#lastModified.get(this.#paths.fileURL(path).href)!,
    };
  }

  async write(
    path: LocalPath,
    contents: string | object,
  ): Promise<{ lastModified: number }> {
    let segments = path.split('/');
    let name = segments.pop()!;
    let dir = this.#traverse(segments, 'directory');
    if (typeof dir === 'string') {
      throw new Error(`treated file as a directory`);
    }
    if (typeof dir[name] === 'object') {
      throw new Error(
        `cannot write file over an existing directory at ${path}`,
      );
    }

    let type = dir[name] ? 'updated' : 'added';
    dir[name] =
      typeof contents === 'string'
        ? contents
        : JSON.stringify(contents, null, 2);
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
    if (typeof dir === 'string') {
      throw new Error(`tried to use file as directory`);
    }
    delete dir[name];
    this.postUpdateEvent({ removed: path });
  }

  #traverse(
    segments: string[],
    targetKind: Kind,
    originalPath = segments.join('/'),
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

export function delay(delayAmountMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayAmountMs);
  });
}

function changedEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number },
) {
  return listings.some(
    (item) =>
      item.path === entry.path && item.lastModified != entry.lastModified,
  );
}

function hasEntry(
  listings: { path: string; lastModified?: number }[],
  entry: { path: string; lastModified?: number },
) {
  return listings.some((item) => item.path === entry.path);
}

export function diff(
  prevEntries: { path: string; lastModified?: number }[],
  currEntries: { path: string; lastModified?: number }[],
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

function isCardSourceFetch(request: Request) {
  return (
    request.method === 'GET' &&
    request.headers.get('Accept') === SupportedMimeType.CardSource &&
    request.url.includes(testRealmURL)
  );
}

export async function sourceFetchReturnUrlHandle(
  request: Request,
  defaultHandle: (req: Request) => Promise<Response | null>,
) {
  if (isCardSourceFetch(request)) {
    let r = await defaultHandle(request);
    if (r) {
      return new MockRedirectedResponse(r.body, r, request.url) as Response;
    }
  }
  return null;
}

export async function sourceFetchRedirectHandle(
  request: Request,
  adapter: RealmAdapter,
  realm: Realm,
) {
  let urlParts = new URL(request.url).pathname.split('.');
  if (
    isCardSourceFetch(request) &&
    urlParts.length === 1 //has no extension
  ) {
    const realmPaths = new RealmPaths(realm.url);
    const localPath = realmPaths.local(request.url);
    const ref = await getFileWithFallbacks(
      localPath,
      adapter.openFile.bind(adapter),
      executableExtensions,
    );
    let maybeExtension = ref?.path.split('.').pop();
    let responseUrl = maybeExtension
      ? `${request.url}.${maybeExtension}`
      : request.url;

    if (
      ref &&
      (ref.content instanceof ReadableStream ||
        ref.content instanceof Uint8Array ||
        typeof ref.content === 'string')
    ) {
      let r = createResponse(realm, ref.content, {
        headers: {
          'last-modified': formatRFC7231(ref.lastModified),
        },
      });
      return new MockRedirectedResponse(r.body, r, responseUrl) as Response;
    }
  }
  return null;
}

export class MockRedirectedResponse extends Response {
  private _mockUrl: string;

  constructor(
    body?: BodyInit | null | undefined,
    init?: ResponseInit,
    url?: string,
  ) {
    super(body, init);
    this._mockUrl = url || '';
  }

  get redirected() {
    return true;
  }

  get url() {
    return this._mockUrl;
  }
}

export async function elementIsVisible(element: Element) {
  return new Promise((resolve) => {
    let intersectionObserver = new IntersectionObserver(function (entries) {
      intersectionObserver.unobserve(element);

      resolve(entries[0].isIntersecting);
    });

    intersectionObserver.observe(element);
  });
}
