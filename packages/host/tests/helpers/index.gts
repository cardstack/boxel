import type Owner from '@ember/owner';
import Service from '@ember/service';
import {
  type TestContext,
  getContext,
  visit,
  settled,
} from '@ember/test-helpers';
import { findAll, waitUntil, waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';

import { validate as uuidValidate } from 'uuid';

import {
  baseRealm,
  CachingDefinitionLookup,
  ensureTrailingSlash,
  getCreatedTime,
  IndexWriter,
  insertPermissions,
  Loader,
  MatrixClient,
  Realm,
  testHostModeRealmURL,
  testRealmInfo,
  testRealmURL,
  testRealmURLToUsername,
  Worker,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  type DefinitionLookup,
  type LooseSingleCardDocument,
  type Prerenderer,
  type RealmAction,
  type RealmAdapter,
  type RealmInfo,
  type RealmPermissions,
  type RenderError,
} from '@cardstack/runtime-common';

import CardPrerender from '@cardstack/host/components/card-prerender';
import ENV from '@cardstack/host/config/environment';
import { render as renderIntoElement } from '@cardstack/host/lib/isolated-render';
import SQLiteAdapter from '@cardstack/host/lib/sqlite-adapter';
import type { CardSaveSubscriber } from '@cardstack/host/services/store';

import {
  coerceRenderError,
  normalizeRenderError,
} from '@cardstack/host/utils/render-error';

import type {
  CardStore,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';

import { TestRealmAdapter } from './adapter';
import { testRealmServerMatrixUsername } from './mock-matrix';
import percySnapshot from './percy-snapshot';
import { setupAuthEndpoints } from './realm-server-mock';
import { createJWT, testRealmSecretSeed } from './test-auth';
import { getTestRealmRegistry } from './test-realm-registry';
import visitOperatorMode from './visit-operator-mode';

import type { MockUtils } from './mock-matrix/_utils';

import type { SimpleElement } from '@simple-dom/interface';

export {
  visitOperatorMode,
  testHostModeRealmURL,
  testRealmURL,
  testRealmInfo,
  percySnapshot,
};
export { createJWT, testRealmSecretSeed } from './test-auth';
export {
  registerRealmAuthSessionRoomEnsurer,
  setupAuthEndpoints,
} from './realm-server-mock';
export { setupOperatorModeStateCleanup } from './operator-mode-state';
export * from '@cardstack/runtime-common/helpers';
export * from './indexer';

export const testModuleRealm = 'http://localhost:4202/test/';

export {
  catalogRealm,
  skillsRealm,
  skillCardURL,
  devSkillId,
  envSkillId,
} from '@cardstack/host/lib/utils';

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

  return text
    .replace(/<!---->/g, '')
    .replace(/[\s]+/g, ' ')
    .trim();
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
  // If there's no monaco, nothing to clean up
  if (!(window as any).monaco) return;
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
  await waitUntil(() => {
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    let errorElement = document.querySelector(
      '[data-prerender-error]',
    ) as HTMLElement | null;
    let errorText = (errorElement?.textContent ?? errorElement?.innerHTML ?? '')
      .trim()
      .trim();
    if (expectedStatus === 'error') {
      if (container) {
        let status = container.dataset.prerenderStatus ?? '';
        if (status === 'error' || status === 'unusable') {
          return true;
        }
      }
      return errorText.length > 0;
    }
    if (errorText.length > 0) {
      return true;
    }
    if (!container) {
      return false;
    }
    return (container.dataset.prerenderStatus ?? '') === expectedStatus;
  });
  let container = document.querySelector(
    '[data-prerender]',
  ) as HTMLElement | null;
  let errorElement = document.querySelector(
    '[data-prerender-error]',
  ) as HTMLElement | null;
  let errorText = (
    errorElement?.textContent ??
    errorElement?.innerHTML ??
    ''
  ).trim();
  if (errorText.length > 0) {
    return {
      status: 'error',
      value: normalizeCapturedErrorText(errorText),
    };
  }
  if (!container) {
    throw new Error(
      'capturePrerenderResult: missing [data-prerender] container after wait',
    );
  }
  let status = container.dataset.prerenderStatus as
    | 'ready'
    | 'error'
    | 'unusable'
    | undefined;
  if (status === 'error' || status === 'unusable') {
    return {
      status: 'error',
      value: normalizeCapturedErrorText(
        container.innerHTML!.replace(/}[^}]*$/, '}'),
      ),
    };
  }
  return { status: 'ready', value: container.children[0][capture]! };
}

function normalizeCapturedErrorText(errorText: string): string {
  let normalized = formatCapturedRenderError(errorText);
  return normalized ?? errorText;
}

function formatCapturedRenderError(errorText: string): string | undefined {
  let renderError = coerceRenderError(errorText);
  if (!renderError) {
    return undefined;
  }
  let normalized = flattenNestedRenderError(normalizeRenderError(renderError));
  return JSON.stringify(normalized, null, 2);
}

function flattenNestedRenderError(renderError: RenderError): RenderError {
  let cloned = JSON.parse(JSON.stringify(renderError)) as RenderError;
  let nested =
    extractNestedErrorPayload(cloned.error.message) ??
    extractNestedErrorPayload(cloned.error.title);
  if (!nested) {
    return cloned;
  }
  cloned.error = {
    ...cloned.error,
    ...nested,
  };
  return cloned;
}

function extractNestedErrorPayload(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  let trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }
  try {
    let nested = JSON.parse(trimmed);
    if (nested && typeof nested === 'object' && 'message' in nested) {
      return nested as Record<string, unknown>;
    }
  } catch (_err) {
    return undefined;
  }
  return undefined;
}

export function captureModuleResult(): {
  status: 'ready' | 'error';
  model: any;
  raw: string;
} {
  let container = document.querySelector(
    '[data-prerender-module]',
  ) as HTMLElement | null;
  if (!container) {
    throw new Error(
      'captureModuleResult: missing [data-prerender-module] container after wait',
    );
  }
  let status = (container.dataset.prerenderModuleStatus ?? 'ready') as
    | 'ready'
    | 'error';
  let pre = container.querySelector('pre');
  if (!pre) {
    throw new Error(
      'captureModuleResult: missing <pre> element inside [data-prerender-module]',
    );
  }
  let raw = pre.textContent ?? '';
  let model = raw ? JSON.parse(raw) : null;
  return { status, model, raw };
}

type RenderingContextWithPrerender = TestContext & {
  owner: Owner;
  __cardPrerenderElement?: HTMLElement;
};

export async function makeRenderer() {
  let context = getContext() as RenderingContextWithPrerender;
  let owner = context.owner;
  if (!owner) {
    throw new Error('makeRenderer: missing test owner');
  }

  let element = context.__cardPrerenderElement;
  if (!element) {
    element = document.createElement('div');
    element.dataset.testCardPrerenderRoot = 'true';
    document.body.appendChild(element);
    context.__cardPrerenderElement = element;
  }

  renderIntoElement(
    class CardPrerenderHost extends GlimmerComponent {
      <template>
        <CardPrerender />
      </template>
    },
    element as unknown as SimpleElement,
    owner,
  );
}

class MockLocalIndexer extends Service {
  @tracked renderError: string | undefined;
  @tracked prerenderStatus: 'ready' | 'loading' | 'unusable' | undefined;
  url = new URL(testRealmURL);
  #adapter: RealmAdapter | undefined;
  #indexWriter: IndexWriter | undefined;
  #prerenderer: Prerenderer | undefined;
  setup(prerenderer: Prerenderer) {
    if (this.#prerenderer) {
      return;
    }
    this.#prerenderer = prerenderer;
  }
  async configureRunner(adapter: RealmAdapter, indexWriter: IndexWriter) {
    this.#adapter = adapter;
    this.#indexWriter = indexWriter;
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
  get prerenderer() {
    if (!this.#prerenderer) {
      throw new Error(`prerenderer not registered with MockLocalIndexer`);
    }
    return this.#prerenderer;
  }
  setPrerenderStatus(status: 'ready' | 'loading' | 'unusable') {
    this.prerenderStatus = status;
  }
  setRenderError(error: string) {
    this.renderError = error;
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
    let context = this as RenderingContextWithPrerender;
    context.__cardPrerenderElement?.remove();
    context.__cardPrerenderElement = undefined;
    // reference counts should balance out automatically as components are destroyed
    store.resetCache({ preserveReferences: true });
    let renderStore = getService('render-store');
    renderStore.resetCache({ preserveReferences: true });
    let loaderService = getService('loader-service');
    loaderService.resetLoader({
      clearFetchCache: true,
      reason: 'test teardown',
    });
  });
}

export function setupOnSave(hooks: NestedHooks) {
  hooks.beforeEach<TestContextWithSave>(function () {
    let store = getService('store');
    this.onSave = store._onSave.bind(store);
    this.unregisterOnSave = store._unregisterSaveSubscriber.bind(store);
  });
}

interface RealmContents {
  [key: string]:
    | CardDef
    | FieldDef
    | LooseSingleCardDocument
    | RealmInfo
    | Record<string, unknown>
    | string;
}

export const SYSTEM_CARD_FIXTURE_CONTENTS: RealmContents = {
  'ModelConfiguration/test-gpt.json': {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          cardTitle: 'OpenAI: GPT-5',
          cardDescription:
            'Test fixture model configuration referencing GPT-5.',
          cardThumbnailURL: null,
          notes: null,
        },
        modelId: 'openai/gpt-5',
        toolsSupported: true,
        reasoningEffort: 'minimal',
      },
      relationships: {
        'cardInfo.theme': {
          links: {
            self: null,
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/system-card',
          name: 'ModelConfiguration',
        },
      },
    },
  },
  'ModelConfiguration/test-claude-sonnet-45.json': {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          cardTitle: 'Anthropic: Claude Sonnet 4.5',
          cardDescription:
            'Test fixture model configuration referencing Claude Sonnet 4.5.',
          cardThumbnailURL: null,
          notes: null,
        },
        modelId: 'anthropic/claude-sonnet-4.5',
        toolsSupported: true,
      },
      relationships: {
        'cardInfo.theme': {
          links: {
            self: null,
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/system-card',
          name: 'ModelConfiguration',
        },
      },
    },
  },
  'ModelConfiguration/test-claude-37-sonnet.json': {
    data: {
      type: 'card',
      attributes: {
        cardInfo: {
          cardTitle: 'Anthropic: Claude 3.7 Sonnet',
          cardDescription:
            'Test fixture model configuration referencing Claude 3.7 Sonnet.',
          cardThumbnailURL: null,
          notes: null,
        },
        modelId: 'anthropic/claude-3.7-sonnet',
        toolsSupported: true,
      },
      relationships: {
        'cardInfo.theme': {
          links: {
            self: null,
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/system-card',
          name: 'ModelConfiguration',
        },
      },
    },
  },
  'SystemCard/default.json': {
    data: {
      type: 'card',
      attributes: {},
      relationships: {
        defaultModelConfiguration: {
          links: {
            self: '../ModelConfiguration/test-claude-sonnet-45',
          },
        },
        'modelConfigurations.0': {
          links: {
            self: '../ModelConfiguration/test-gpt',
          },
        },
        'modelConfigurations.1': {
          links: {
            self: '../ModelConfiguration/test-claude-sonnet-45',
          },
        },
        'modelConfigurations.2': {
          links: {
            self: '../ModelConfiguration/test-claude-37-sonnet',
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/system-card',
          name: 'SystemCard',
        },
      },
    },
  },
};
export async function setupAcceptanceTestRealm({
  contents = {},
  realmURL,
  permissions,
  mockMatrixUtils,
  startMatrix = true,
}: {
  contents: RealmContents;
  realmURL?: string;
  permissions?: RealmPermissions;
  mockMatrixUtils: MockUtils;
  startMatrix?: boolean;
}) {
  let resolvedRealmURL = ensureTrailingSlash(realmURL ?? testRealmURL);
  setupAuthEndpoints({
    [resolvedRealmURL]: deriveTestUserPermissions(permissions),
  });
  let result = await setupTestRealm({
    contents,
    realmURL: resolvedRealmURL,
    isAcceptanceTest: true,
    permissions,
    mockMatrixUtils,
    startMatrix,
  });
  getTestRealmRegistry().set(result.realm.url, {
    realm: result.realm,
    adapter: result.adapter,
  });
  return result;
}

export async function setupIntegrationTestRealm({
  contents = {},
  realmURL,
  permissions,
  mockMatrixUtils,
  startMatrix = true,
}: {
  contents: RealmContents;
  realmURL?: string;
  permissions?: RealmPermissions;
  mockMatrixUtils: MockUtils;
  startMatrix?: boolean;
}) {
  let resolvedRealmURL = ensureTrailingSlash(realmURL ?? testRealmURL);
  setupAuthEndpoints({
    [resolvedRealmURL]: deriveTestUserPermissions(permissions),
  });
  let result = await setupTestRealm({
    contents,
    realmURL: resolvedRealmURL,
    isAcceptanceTest: false,
    permissions: permissions as RealmPermissions,
    mockMatrixUtils,
    startMatrix,
  });
  getTestRealmRegistry().set(result.realm.url, {
    realm: result.realm,
    adapter: result.adapter,
  });
  return result;
}

export async function withoutLoaderMonitoring<T>(cb: () => Promise<T>) {
  (globalThis as any).__disableLoaderMonitoring = true;
  try {
    return (await cb()) as T;
  } finally {
    (globalThis as any).__disableLoaderMonitoring = undefined;
  }
}

export const createPrerenderAuth = (
  _userId: string,
  _permissions: RealmPermissions,
) => {
  // Host tests prerender via the in-app card-prerender component, so we don't need real JWT auth.
  return JSON.stringify({});
};
async function setupTestRealm({
  contents,
  realmURL,
  isAcceptanceTest,
  permissions = { '*': ['read', 'write'] },
  mockMatrixUtils,
  startMatrix = true,
}: {
  contents: RealmContents;
  realmURL?: string;
  isAcceptanceTest?: boolean;
  permissions?: RealmPermissions;
  mockMatrixUtils: MockUtils;
  startMatrix?: boolean;
}) {
  let owner = (getContext() as TestContext).owner;
  let { virtualNetwork } = getService('network');
  let { queue } = getService('queue');

  realmURL = realmURL ?? testRealmURL;

  if (isAcceptanceTest) {
    await visit('/acceptance-test-setup');
  } else {
    // We use a rendered component to facilitate our indexing (this emulates
    // the work that the prerenderer is doing), which means that the
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
  let dbAdapter = await getDbAdapter();
  let definitionLookup = owner.lookup('definition-lookup:main') as
    | DefinitionLookup
    | undefined;
  if (!definitionLookup) {
    owner.register(
      'definition-lookup:main',
      new CachingDefinitionLookup(
        dbAdapter,
        localIndexer.prerenderer,
        virtualNetwork,
        createPrerenderAuth,
      ),
      {
        instantiate: false,
      },
    );
    definitionLookup = owner.lookup(
      'definition-lookup:main',
    ) as DefinitionLookup;
  }

  await insertPermissions(dbAdapter, new URL(realmURL), permissions);
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    dbAdapter,
    queuePublisher: queue,
    virtualNetwork,
    matrixURL: baseTestMatrix.url,
    secretSeed: testRealmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer: localIndexer.prerenderer,
    createPrerenderAuth,
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
    realmServerURL: ensureTrailingSlash(ENV.realmServerURL),
    definitionLookup,
    cardSizeLimitBytes: Number(
      process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
    ),
  });

  // Register the realm early so realm-server mock _info lookups can resolve
  // without falling back to real network fetches.
  getTestRealmRegistry().set(realm.url, {
    realm,
    adapter,
  });

  // we use this to run cards that were added to the test filesystem
  adapter.setLoader(
    new Loader(realm.__fetchForTesting, virtualNetwork.resolveImport),
  );

  // TODO this is the only use of Realm.maybeHandle left--can we get rid of it?
  virtualNetwork.mount(realm.maybeHandle);
  if (startMatrix) {
    await mockMatrixUtils.start();
  }
  await adapter.ready;
  await worker.run();
  await realm.start();

  let realmServer = getService('realm-server');
  if (!realmServer.availableRealmURLs.includes(realmURL)) {
    await realmServer.setAvailableRealmURLs([realmURL]);
  }

  return { realm, adapter };
}

function deriveTestUserPermissions(
  permissions?: RealmPermissions,
): RealmAction[] {
  const TEST_MATRIX_USER = '@testuser:localhost';
  if (!permissions) {
    return ['read', 'write'];
  }
  let forTestUser = permissions[TEST_MATRIX_USER];
  if (forTestUser) {
    return forTestUser as RealmAction[];
  }
  let wildcard = permissions['*'];
  if (wildcard) {
    return wildcard as RealmAction[];
  }
  let firstEntry = Object.values(permissions)[0];
  if (firstEntry) {
    return firstEntry as RealmAction[];
  }
  return ['read', 'write'];
}

export function setupUserSubscription() {
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
  realmURL?: string,
) {
  let api = await loader.import<CardAPI>(`${baseRealm.url}card-api`);
  let doc = api.serializeCard(instance);
  doc.data.id = id;
  if (realmURL) {
    doc.data.meta = {
      ...(doc.data.meta ?? {}),
      realmURL,
    };
  }
  await api.updateFromSerialized(instance, doc, store);
  await persistDocumentToTestRealm(id, doc);
  return doc;
}

async function persistDocumentToTestRealm(
  id: string,
  doc: LooseSingleCardDocument,
) {
  if (!id) {
    return;
  }
  let url = new URL(id);
  let registry = getTestRealmRegistry();
  let matching = [...registry.values()].find(({ realm }) =>
    realm.paths.inRealm(url),
  );
  if (!matching) {
    return;
  }
  let owner = matching.adapter.owner as
    | (Owner & { isDestroying?: boolean; isDestroyed?: boolean })
    | undefined;
  if (owner?.isDestroying || owner?.isDestroyed) {
    getTestRealmRegistry().delete(matching.realm.url);
    return;
  }
  let localPath: string;
  try {
    localPath = matching.realm.paths.local(url);
  } catch {
    return;
  }
  if (!localPath.endsWith('.json')) {
    localPath = `${localPath}.json`;
  }
  await matching.adapter.write(localPath, JSON.stringify(doc, null, 2));
  await matching.realm.realmIndexUpdater.update(
    [matching.realm.paths.fileURL(localPath)],
    {
      async onInvalidation() {},
    },
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
): Promise<number | undefined> {
  let db = await getDbAdapter();
  return getCreatedTime(db, realm.url, localPath);
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
      route: '_realm-auth',
      getResponse: async function (_req: Request) {
        return new Response(JSON.stringify({}), { status: 200 });
      },
    },
    {
      route: '_server-session',
      getResponse: async function (req: Request) {
        let data = await req.json();
        if (!data.access_token) {
          return new Response(
            JSON.stringify({
              errors: [`Request body missing 'access_token' property`],
            }),
            { status: 400 },
          );
        }
        return new Response(null, {
          status: 201,
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
    let pathname = new URL(req.url).pathname;
    let endpoint = endpoints?.find((e) => pathname === `/${e.route}`);
    if (endpoint) {
      return await endpoint.getResponse(req);
    }

    endpoint = defaultEndpoints.find((e) => pathname === `/${e.route}`);
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
    cards?: { id: string; cardTitle?: string; realmIconUrl?: string }[];
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
        if (card.cardTitle) {
          if (message != null && card.cardTitle.includes(message)) {
            throw new Error(
              `This is not a good test since the message '${message}' overlaps with the asserted card text '${card.cardTitle}'`,
            );
          }
          assert
            .dom(
              `[data-test-message-idx="${index}"] [data-test-attached-card="${card.id}"]`,
            )
            .containsText(card.cardTitle);
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

export const cardInfo = Object.freeze({
  name: null,
  summary: null,
  cardThumbnailURL: null,
  notes: null,
});

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
