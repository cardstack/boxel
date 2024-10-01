import Service from '@ember/service';
import {
  type TestContext,
  getContext,
  visit,
  settled,
} from '@ember/test-helpers';
import { findAll, waitUntil, waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import ms from 'ms';

import {
  RealmAdapter,
  LooseSingleCardDocument,
  baseRealm,
  RealmPermissions,
  Deferred,
  Worker,
  RunnerOptionsManager,
  type RealmInfo,
  type TokenClaims,
  IndexWriter,
  type RunnerRegistration,
  type IndexRunner,
  type IndexResults,
  insertPermissions,
  unixTime,
} from '@cardstack/runtime-common';

import {
  testRealmInfo,
  testRealmURL,
} from '@cardstack/runtime-common/helpers/const';
import { Loader } from '@cardstack/runtime-common/loader';

import { Realm } from '@cardstack/runtime-common/realm';

import CardPrerender from '@cardstack/host/components/card-prerender';
import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import type CardService from '@cardstack/host/services/card-service';
import type { CardSaveSubscriber } from '@cardstack/host/services/card-service';

import type LoaderService from '@cardstack/host/services/loader-service';
import type MessageService from '@cardstack/host/services/message-service';

import type QueueService from '@cardstack/host/services/queue';

import RealmServerService from '@cardstack/host/services/realm-server';

import {
  type CardDef,
  type FieldDef,
} from 'https://cardstack.com/base/card-api';

import { TestRealmAdapter } from './adapter';
import percySnapshot from './percy-snapshot';
import { renderComponent } from './render-component';
import visitOperatorMode from './visit-operator-mode';

export { visitOperatorMode, testRealmURL, testRealmInfo, percySnapshot };
export * from '@cardstack/runtime-common/helpers';
export * from '@cardstack/runtime-common/helpers/indexer';

const { sqlSchema } = ENV;

type CardAPI = typeof import('https://cardstack.com/base/card-api');
const testMatrix = {
  url: new URL(`http://localhost:8008`),
  username: 'test_realm',
  password: 'password',
};

// Ignoring this TS error (Cannot find module 'ember-provide-consume-context/test-support')
// until https://github.com/customerio/ember-provide-consume-context/issues/24 is fixed
// @ts-ignore
export { provide as provideConsumeContext } from 'ember-provide-consume-context/test-support';

export function cleanWhiteSpace(text: string) {
  // this also normalizes non-breaking space characters which seem
  // to be appearing in date/time serialization in some envs
  // eslint-disable-next-line no-irregular-whitespace
  return text.replace(/[\s ]+/g, ' ').trim();
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

export async function getDbAdapter() {
  let dbAdapter = (globalThis as any).__sqliteAdapter as
    | SQLiteAdapter
    | undefined;
  if (!dbAdapter) {
    dbAdapter = new SQLiteAdapter(sqlSchema);
    (globalThis as any).__sqliteAdapter = dbAdapter;
  }
  return dbAdapter;
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
      window
        .getComputedStyle(finalHighlightedToken!)
        .getPropertyValue('color') === color,
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
  #indexWriter: IndexWriter | undefined;
  #fromScratch: ((realmURL: URL) => Promise<IndexResults>) | undefined;
  #incremental:
    | ((
        url: URL,
        realmURL: URL,
        operation: 'update' | 'delete',
        ignoreData: Record<string, string>,
      ) => Promise<IndexResults>)
    | undefined;
  setup(
    fromScratch: (realmURL: URL) => Promise<IndexResults>,
    incremental: (
      url: URL,
      realmURL: URL,
      operation: 'update' | 'delete',
      ignoreData: Record<string, string>,
    ) => Promise<IndexResults>,
  ) {
    this.#fromScratch = fromScratch;
    this.#incremental = incremental;
  }
  async configureRunner(
    registerRunner: RunnerRegistration,
    adapter: RealmAdapter,
    indexWriter: IndexWriter,
  ) {
    if (!this.#fromScratch || !this.#incremental) {
      throw new Error(
        `fromScratch/incremental not registered with MockLocalIndexer`,
      );
    }
    this.#adapter = adapter;
    this.#indexWriter = indexWriter;
    await registerRunner(
      this.#fromScratch.bind(this),
      this.#incremental.bind(this),
    );
  }
  get adapter() {
    if (!this.#adapter) {
      throw new Error(`adapter has not been set on MockLocalIndexer`);
    }
    return this.#adapter;
  }
  get indexWriter() {
    if (!this.#indexWriter) {
      throw new Error(`indexWriter not registered with MockLocalIndexer`);
    }
    return this.#indexWriter;
  }
}

export function setupLocalIndexing(hooks: NestedHooks) {
  hooks.beforeEach(async function () {
    let dbAdapter = await getDbAdapter();
    await dbAdapter.reset();
    this.owner.register('service:local-indexer', MockLocalIndexer);
  });

  hooks.afterEach(async function () {
    // This is here to allow card prerender component (which renders cards as part
    // of the indexer process) to come to a graceful stop before we tear a test
    // down (this should prevent tests from finishing before the prerender is still doing work).
    // Without this, we have been experiencing test failures related to a destroyed owner, e.g.
    // "Cannot call .factoryFor('template:index-card_error') after the owner has been destroyed"
    await settled();
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
      if (!response?.ok) {
        throw new Error(`failed to connect to realm: ${response?.status}`);
      }
      let reader = response.body!.getReader();
      let timeout = setTimeout(
        () =>
          defer.reject(
            new Error(
              `expectEvent timed out, saw events ${JSON.stringify(events)}`,
            ),
          ),
        opts?.timeout ?? 10000,
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
          eventsWithoutClientRequestId.forEach((e) =>
            e.data.invalidations?.sort(),
          ),
          expectedEvents.forEach((e) => e.data.invalidations?.sort()),
          'sse response is correct',
        );
      }
      if (onEvents) {
        onEvents(events);
      }
      clearTimeout(timeout);
      realm.unsubscribe();
      await settled();
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
  contents,
  realmURL,
  permissions,
}: {
  contents: RealmContents;
  realmURL?: string;
  permissions?: RealmPermissions;
}) {
  return await setupTestRealm({
    contents,
    realmURL,
    isAcceptanceTest: true,
    permissions,
  });
}

export async function setupIntegrationTestRealm({
  contents,
  realmURL,
}: {
  loader: Loader;
  contents: RealmContents;
  realmURL?: string;
}) {
  return await setupTestRealm({
    contents,
    realmURL,
    isAcceptanceTest: false,
  });
}

export function lookupLoaderService(): LoaderService {
  let owner = (getContext() as TestContext).owner;
  return owner.lookup('service:loader-service') as LoaderService;
}

export const testRealmSecretSeed = "shhh! it's a secret";
async function setupTestRealm({
  contents,
  realmURL,
  isAcceptanceTest,
  permissions = { '*': ['read', 'write'] },
}: {
  contents: RealmContents;
  realmURL?: string;
  isAcceptanceTest?: boolean;
  permissions?: RealmPermissions;
}) {
  let owner = (getContext() as TestContext).owner;
  let { virtualNetwork } = lookupLoaderService();
  let { queue } = owner.lookup('service:queue') as QueueService;

  realmURL = realmURL ?? testRealmURL;

  let realmServer = owner.lookup('service:realm-server') as RealmServerService;
  if (!realmServer.availableRealmURLs.includes(realmURL)) {
    realmServer.setAvailableRealmURLs([realmURL]);
  }

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

  let adapter = new TestRealmAdapter(contents, new URL(realmURL));
  let indexRunner: IndexRunner = async (optsId) => {
    let { registerRunner, indexWriter } = runnerOptsMgr.getOptions(optsId);
    await localIndexer.configureRunner(registerRunner, adapter, indexWriter);
  };

  let dbAdapter = await getDbAdapter();
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    runnerOptsManager: runnerOptsMgr,
    indexRunner,
    virtualNetwork,
    matrixURL: testMatrix.url,
    secretSeed: testRealmSecretSeed,
  });
  realm = new Realm({
    url: realmURL,
    adapter,
    matrix: testMatrix,
    secretSeed: testRealmSecretSeed,
    virtualNetwork,
    dbAdapter,
    queue,
  });
  // TODO this is the only use of Realm.maybeHandle left--can we get rid of it?
  virtualNetwork.mount(realm.maybeHandle);
  await adapter.ready;
  await worker.run();
  await realm.start();

  return { realm, adapter };
}

export async function saveCard(instance: CardDef, id: string, loader: Loader) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  await api.updateFromSerialized(instance, doc);
  return doc;
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

export function createJWT(
  claims: TokenClaims,
  expiration: string,
  secret: string,
) {
  let nowInSeconds = unixTime(Date.now());
  let expires = nowInSeconds + unixTime(ms(expiration));
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

export async function elementIsVisible(element: Element) {
  return new Promise((resolve) => {
    let intersectionObserver = new IntersectionObserver(function (entries) {
      intersectionObserver.unobserve(element);

      resolve(entries[0].isIntersecting);
    });

    intersectionObserver.observe(element);
  });
}
