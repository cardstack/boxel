import Service from '@ember/service';
import {
  type TestContext,
  getContext,
  visit,
  settled,
} from '@ember/test-helpers';
import { findAll, waitUntil, waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import ms from 'ms';

import { validate as uuidValidate } from 'uuid';

import {
  RealmAdapter,
  LooseSingleCardDocument,
  baseRealm,
  RealmPermissions,
  Worker,
  RunnerOptionsManager,
  type RealmInfo,
  type TokenClaims,
  IndexWriter,
  query,
  param,
  type RunnerRegistration,
  type IndexRunner,
  type IndexResults,
  insertPermissions,
  unixTime,
} from '@cardstack/runtime-common';

import {
  testHostModeRealmURL,
  testRealmInfo,
  testRealmURL,
  testRealmURLToUsername,
} from '@cardstack/runtime-common/helpers/const';
import { Loader } from '@cardstack/runtime-common/loader';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { Realm } from '@cardstack/runtime-common/realm';

import CardPrerender from '@cardstack/host/components/card-prerender';
import ENV from '@cardstack/host/config/environment';
import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';

import { RealmServerTokenClaims } from '@cardstack/host/services/realm-server';

import type { CardSaveSubscriber } from '@cardstack/host/services/store';

import {
  type CardStore,
  type CardDef,
  type FieldDef,
} from 'https://cardstack.com/base/card-api';

import { TestRealmAdapter } from './adapter';
import { testRealmServerMatrixUsername } from './mock-matrix';
import percySnapshot from './percy-snapshot';
import { renderComponent } from './render-component';
import visitOperatorMode from './visit-operator-mode';

import type { MockUtils } from './mock-matrix/_utils';

export {
  visitOperatorMode,
  testHostModeRealmURL,
  testRealmURL,
  testRealmInfo,
  percySnapshot,
};
export * from '@cardstack/runtime-common/helpers';
export * from './indexer';

export const testModuleRealm = 'http://localhost:4202/test/';

const { sqlSchema } = ENV;

type CardAPI = typeof import('https://cardstack.com/base/card-api');

const baseTestMatrix = {
  url: new URL(`http://localhost:8008`),
  username: 'test_realm',
  password: 'password',
};

export { provide as provideConsumeContext } from 'ember-provide-consume-context/test-support';

export function cleanWhiteSpace(text: string) {
  // this also normalizes non-breaking space characters which seem
  // to be appearing in date/time serialization in some envs

  return text.replace('<!---->', '').replace(/[\s]+/g, ' ').trim();
}

export function getMonacoContent(
  editor: 'main' | 'firstAvailable' = 'main',
): string {
  if (editor === 'main') {
    let monacoService = getService('monaco-service');
    return monacoService.getMonacoContent()!;
  } else {
    return (window as any).monaco.editor.getModels()[0].getValue();
  }
}

export function setMonacoContent(content: string): string {
  return (window as any).monaco.editor.getModels()[0].setValue(content);
}

export function cleanupMonacoEditorModels() {
  let diffEditors = (window as any).monaco.editor.getDiffEditors();
  for (let editor of diffEditors) {
    editor.dispose();
  }

  let models = (window as any).monaco.editor.getModels();
  for (let model of models) {
    model.dispose();
  }
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

export async function withSlowSave(
  delayMs: number,
  cb: () => Promise<void>,
): Promise<void> {
  let store = getService('store');
  (store as any)._originalPersist = (store as any).persistAndUpdate;
  (store as any).persistAndUpdate = async (
    card: CardDef,
    defaultRealmHref?: string,
  ) => {
    await delay(delayMs);
    await (store as any)._originalPersist(card, defaultRealmHref);
  };
  try {
    return cb();
  } finally {
    (store as any).persistAndUpdate = (store as any)._originalPersist;
  }
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

export async function capturePrerenderResult(
  capture: 'textContent' | 'innerHTML' | 'outerHTML',
  expectedStatus: 'ready' | 'error' = 'ready',
): Promise<{ status: 'ready' | 'error'; value: string }> {
  await waitFor(`[data-prerender-status="${expectedStatus}"]`);
  let element = document.querySelector('[data-prerender]') as HTMLElement;
  let status = element.dataset.prerenderStatus as 'ready' | 'error';
  if (status === 'error') {
    // there is a strange <anonymous> tag that is being appended to the innerHTML that this strips out
    return { status, value: element.innerHTML!.replace(/}[^}].*$/, '}') };
  } else {
    return { status, value: element.children[0][capture]! };
  }
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
        urls: URL[],
        realmURL: URL,
        operation: 'update' | 'delete',
        ignoreData: Record<string, string>,
      ) => Promise<IndexResults>)
    | undefined;
  setup(
    fromScratch: (realmURL: URL) => Promise<IndexResults>,
    incremental: (
      urls: URL[],
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
    let store = getService('store');
    await store.flushSaves();
    await store.loaded();
  });
}

export function setupOnSave(hooks: NestedHooks) {
  hooks.beforeEach<TestContextWithSave>(function () {
    let store = getService('store');
    this.onSave = store._onSave.bind(store);
    this.unregisterOnSave = store._unregisterSaveSubscriber.bind(store);
  });
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
  mockMatrixUtils,
}: {
  contents: RealmContents;
  realmURL?: string;
  permissions?: RealmPermissions;
  mockMatrixUtils: MockUtils;
}) {
  return await setupTestRealm({
    contents,
    realmURL,
    isAcceptanceTest: true,
    permissions,
    mockMatrixUtils,
  });
}

export async function setupIntegrationTestRealm({
  contents,
  realmURL,
  mockMatrixUtils,
}: {
  contents: RealmContents;
  realmURL?: string;
  mockMatrixUtils: MockUtils;
}) {
  return await setupTestRealm({
    contents,
    realmURL,
    isAcceptanceTest: false,
    mockMatrixUtils,
  });
}

export async function withoutLoaderMonitoring<T>(cb: () => Promise<T>) {
  (globalThis as any).__disableLoaderMonitoring = true;
  try {
    return (await cb()) as T;
  } finally {
    (globalThis as any).__disableLoaderMonitoring = undefined;
  }
}

export const testRealmSecretSeed = "shhh! it's a secret";
async function setupTestRealm({
  contents,
  realmURL,
  isAcceptanceTest,
  permissions = { '*': ['read', 'write'] },
  mockMatrixUtils,
}: {
  contents: RealmContents;
  realmURL?: string;
  isAcceptanceTest?: boolean;
  permissions?: RealmPermissions;
  mockMatrixUtils: MockUtils;
}) {
  let owner = (getContext() as TestContext).owner;
  let { virtualNetwork } = getService('network');
  let { queue } = getService('queue');

  realmURL = realmURL ?? testRealmURL;

  let realmServer = getService('realm-server');
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

  let adapter = new TestRealmAdapter(
    contents,
    new URL(realmURL),
    mockMatrixUtils,
    owner,
  );
  let indexRunner: IndexRunner = async (optsId) => {
    let { registerRunner, indexWriter } = runnerOptsMgr.getOptions(optsId);
    await localIndexer.configureRunner(registerRunner, adapter, indexWriter);
  };

  let dbAdapter = await getDbAdapter();
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    dbAdapter,
    queuePublisher: queue,
    runnerOptsManager: runnerOptsMgr,
    indexRunner,
    virtualNetwork,
    matrixURL: baseTestMatrix.url,
    secretSeed: testRealmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
  });

  realm = new Realm({
    url: realmURL,
    adapter,
    matrix: {
      ...baseTestMatrix,
      username: testRealmURLToUsername(realmURL),
    },
    secretSeed: testRealmSecretSeed,
    virtualNetwork,
    dbAdapter,
    queue,
    realmServerMatrixClient: new MatrixClient({
      matrixURL: baseTestMatrix.url,
      username: testRealmServerMatrixUsername,
      seed: testRealmSecretSeed,
    }),
  });

  // we use this to run cards that were added to the test filesystem
  adapter.setLoader(
    new Loader(realm.__fetchForTesting, virtualNetwork.resolveImport),
  );

  // TODO this is the only use of Realm.maybeHandle left--can we get rid of it?
  virtualNetwork.mount(realm.maybeHandle);
  await mockMatrixUtils.start();
  await adapter.ready;
  await worker.run();
  await realm.start();

  return { realm, adapter };
}

export function setupUserSubscription(matrixRoomId: string) {
  const userResponseBody = {
    data: {
      type: 'user',
      id: 1,
      attributes: {
        matrixUserId: '@testuser:localhost',
        stripeCustomerId: 'stripe-id-1',
        creditsAvailableInPlanAllowance: 1000,
        creditsIncludedInPlanAllowance: 1000,
        extraCreditsAvailableInBalance: 100,
      },
      relationships: {
        subscription: {
          data: {
            type: 'subscription',
            id: 1,
          },
        },
      },
    },
    included: [
      {
        type: 'subscription',
        id: 1,
        attributes: {
          startedAt: '2024-10-15T03:42:11.000Z',
          endedAt: '2025-10-15T03:42:11.000Z',
          status: 'active',
        },
        relationships: {
          plan: {
            data: {
              type: 'plan',
              id: 1,
            },
          },
        },
      },
      {
        type: 'plan',
        id: 1,
        attributes: {
          name: 'Free',
          monthlyPrice: 0,
          creditsIncluded: 1000,
        },
      },
    ],
  };

  getService('network').mount(
    async (req: Request) => {
      if (req.url.includes('_user')) {
        return new Response(JSON.stringify(userResponseBody));
      }
      if (req.url.includes('_server-session')) {
        let data = await req.json();
        if (!data.challenge) {
          return new Response(
            JSON.stringify({
              challenge: 'test',
              room: matrixRoomId,
            }),
            {
              status: 401,
            },
          );
        } else {
          return new Response('Ok', {
            status: 200,
            headers: {
              Authorization: createJWT(
                {
                  user: '@testuser:localhost',
                  sessionRoom: matrixRoomId,
                },
                '1d',
                testRealmSecretSeed,
              ),
            },
          });
        }
      }
      return null;
    },
    { prepend: true },
  );
}

export async function saveCard(
  instance: CardDef,
  id: string,
  loader: Loader,
  store?: CardStore,
) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  await api.updateFromSerialized(instance, doc, store);
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
  claims: TokenClaims | RealmServerTokenClaims,
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

// --- Created-at test utilities ---
// Returns created_at (epoch seconds) from realm_file_meta for a given local file path like 'Pet/mango.json'.
export async function getFileCreatedAt(
  realm: Realm,
  localPath: string,
): Promise<number | null> {
  let db = await getDbAdapter();
  let rows = await query(db, [
    'SELECT created_at FROM realm_file_meta WHERE realm_url =',
    param(realm.url),
    'AND file_path =',
    param(localPath),
  ]);
  if (rows.length === 0) return null;
  let created = rows[0]['created_at'];
  if (created == null) return null;
  return typeof created === 'string' ? parseInt(created) : Number(created);
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

type RealmServerEndpoint = {
  route: string;
  getResponse: (req: Request) => Promise<Response>;
};
export function setupRealmServerEndpoints(
  hooks: NestedHooks,
  endpoints?: RealmServerEndpoint[],
) {
  let defaultEndpoints: RealmServerEndpoint[] = [
    {
      route: '_server-session',
      getResponse: async function (req: Request) {
        let data = await req.json();
        if (!data.challenge) {
          return new Response(
            JSON.stringify({
              challenge: 'test',
              room: 'boxel-session-room-id',
            }),
            {
              status: 401,
            },
          );
        } else {
          return new Response('Ok', {
            status: 200,
            headers: {
              Authorization: createJWT(
                {
                  user: '@testuser:localhost',
                  sessionRoom: 'boxel-session-room-id',
                },
                '1d',
                testRealmSecretSeed,
              ),
            },
          });
        }
      },
    },
    {
      route: '_user',
      getResponse: async function (_req: Request) {
        return new Response(
          JSON.stringify({
            data: {
              type: 'user',
              id: 1,
              attributes: {
                matrixUserId: '@testuser:localhost',
                stripeCustomerId: 'stripe-id-1',
                creditsAvailableInPlanAllowance: null,
                creditsIncludedInPlanAllowance: null,
                extraCreditsAvailableInBalance: null,
              },
              relationships: {
                subscription: null,
              },
            },
            included: null,
          }),
        );
      },
    },
    {
      route: '_stripe-links',
      getResponse: async function (_req: Request) {
        return new Response(
          JSON.stringify({
            data: [
              {
                type: 'customer-portal-link',
                id: '1',
                attributes: {
                  url: 'https://customer-portal-link',
                },
              },
              {
                type: 'starter-plan-payment-link',
                id: 'starter-plan-payment-link',
                attributes: {
                  url: 'https://buy.stripe.com/starter-plan-payment-link',
                },
              },
              {
                type: 'creator-plan-payment-link',
                id: 'creator-plan-payment-link',
                attributes: {
                  url: 'https://buy.stripe.com/creator-plan-payment-link',
                },
              },
              {
                type: 'power-user-plan-payment-link',
                id: 'power-user-plan-payment-link',
                attributes: {
                  url: 'https://buy.stripe.com/power-user-plan-payment-link',
                },
              },
              {
                type: 'extra-credits-payment-link',
                id: 'plink_1QP4pEPUHhctoJxaEp1D3my!',
                attributes: {
                  url: 'https://extra-credits-payment-link-1250',
                  metadata: {
                    creditReloadAmount: 1250,
                    price: 5,
                  },
                },
              },
              {
                type: 'extra-credits-payment-link',
                id: 'plink_1QP4pEPUHhctoJxaEp1D3myP',
                attributes: {
                  url: 'https://extra-credits-payment-link-15000',
                  metadata: {
                    creditReloadAmount: 15000,
                    price: 30,
                  },
                },
              },
              {
                type: 'extra-credits-payment-link',
                id: 'plink_1QP4pEPUHhctoJxaEp1D3my!',
                attributes: {
                  url: 'https://extra-credits-payment-link-80000',
                  metadata: {
                    creditReloadAmount: 80000,
                    price: 100,
                  },
                },
              },
            ],
          }),
        );
      },
    },
  ];

  let handleRealmServerRequest = async (req: Request) => {
    let endpoint = endpoints?.find((e) => req.url.includes(e.route));
    if (endpoint) {
      return await endpoint.getResponse(req);
    }

    endpoint = defaultEndpoints.find((e) => req.url.includes(e.route));
    if (endpoint) {
      return await endpoint.getResponse(req);
    }

    return null;
  };

  hooks.beforeEach(function () {
    getService('network').mount(handleRealmServerRequest, { prepend: true });
  });
}

export async function assertMessages(
  assert: Assert,
  messages: {
    from: string;
    message?: string;
    cards?: { id: string; title?: string; realmIconUrl?: string }[];
    files?: { name: string; sourceUrl: string }[];
  }[],
) {
  assert.dom('[data-test-message-idx]').exists({ count: messages.length });
  for (let [index, { from, message, cards, files }] of messages.entries()) {
    assert
      .dom(
        `[data-test-message-idx="${index}"][data-test-boxel-message-from="${from}"]`,
      )
      .exists({ count: 1 });
    if (message != null) {
      assert
        .dom(`[data-test-message-idx="${index}"] .content`)
        .containsText(message);
    }
    if (cards?.length) {
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-items]`)
        .exists({ count: 1 });
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-attached-card]`)
        .exists({ count: cards.length });
      cards.map((card) => {
        if (card.title) {
          if (message != null && card.title.includes(message)) {
            throw new Error(
              `This is not a good test since the message '${message}' overlaps with the asserted card text '${card.title}'`,
            );
          }
          assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"]`,
            )
            .containsText(card.title);
        }

        if (card.realmIconUrl) {
          assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"] [data-test-realm-icon-url="${card.realmIconUrl}"]`,
            )
            .exists({ count: 1 });
        }
      });
    }

    if (files?.length) {
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-items]`)
        .exists({ count: 1 });
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-attached-file]`)
        .exists({ count: files.length });
      files.map((file) => {
        assert
          .dom(
            `[data-test-message-idx="${index}"] [data-test-attached-file="${file.sourceUrl}"]`,
          )
          .containsText(file.name);
      });
    }

    if (!files?.length && !cards?.length) {
      assert
        .dom(`[data-test-message-idx="${index}"] [data-test-message-items]`)
        .doesNotExist();
    }
  }
}

export const cardInfo = {
  title: null,
  description: null,
  thumbnailURL: null,
  notes: null,
};

// UI interaction helpers for acceptance tests

/**
 * Verifies that a specific submode is active in the submode switcher
 */
export async function verifySubmode(assert: Assert, submode: string) {
  await waitFor(`[data-test-submode-switcher=${submode}]`);
  assert.dom(`[data-test-submode-switcher=${submode}]`).exists();
}

/**
 * Toggles the file browser tree panel open/closed
 */
export async function toggleFileTree() {
  await waitFor('[data-test-file-browser-toggle]');
  await click('[data-test-file-browser-toggle]');
}

// File tree navigation and verification helpers for acceptance tests

/**
 * Opens a directory path in the file tree by clicking through the folder hierarchy
 */
export async function openDir(assert: Assert, path: string) {
  const isFilePath = !path.endsWith('/');
  const pathToProcess = isFilePath
    ? path.substring(0, path.lastIndexOf('/'))
    : path;

  const pathSegments = pathToProcess
    .split('/')
    .filter((segment) => segment.length > 0);

  let currentPath = '';

  for (const segment of pathSegments) {
    currentPath = currentPath ? `${currentPath}${segment}/` : `${segment}/`;

    let selector = `[data-test-directory="${currentPath}"] .icon`;
    let element = document.querySelector(selector);

    if ((element as HTMLElement)?.classList.contains('closed')) {
      await click(`[data-test-directory="${currentPath}"]`);
    }

    assert.dom(selector).hasClass('open');
  }

  let finalSelector = `[data-test-directory="${pathToProcess}"] .icon`;
  let finalElement = document.querySelector(finalSelector);
  let dirName = finalElement?.getAttribute('data-test-directory');
  return dirName;
}

/**
 * Verifies a folder with UUID pattern exists in the file tree and validates the UUID
 */
export async function verifyFolderWithUUIDInFileTree(
  assert: Assert,
  dirNamePrefix: string, // name without UUID
) {
  await waitFor(`[data-test-directory^="${dirNamePrefix}-"]`);
  const element = document.querySelector(
    `[data-test-directory^="${dirNamePrefix}-"]`,
  );
  const dirName = element?.getAttribute('data-test-directory');
  const uuid = dirName?.replace(`${dirNamePrefix}-`, '').replace('/', '') || '';
  const { validate: uuidValidate } = await import('uuid');
  assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');
  return dirName;
}

/**
 * Verifies a file exists in the file tree
 */
export async function verifyFileInFileTree(assert: Assert, fileName: string) {
  const fileSelector = `[data-test-file="${fileName}"]`;
  await waitFor(fileSelector);
  assert.dom(fileSelector).exists();
}

/**
 * Verifies a JSON file with UUID pattern exists in a folder and validates the UUID
 * TODO: this api is not very good because it looks for the first file in the directory and users may not assume that
 */

export async function verifyJSONWithUUIDInFolder(
  assert: Assert,
  dirPath: string,
) {
  const fileSelector = `[data-test-file^="${dirPath}"]`;
  await waitFor(fileSelector);
  assert.dom(fileSelector).exists();
  const element = document.querySelector(fileSelector);
  const filePath = element?.getAttribute('data-test-file');
  let parts = filePath?.split('/');
  if (parts) {
    let fileName = parts[parts.length - 1];
    let uuid = fileName.replace(`.json`, '');
    assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');
    return filePath;
  } else {
    throw new Error(
      'file name shape not as expected when checking for [uuid].[extension]',
    );
  }
}
