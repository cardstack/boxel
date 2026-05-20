import type Controller from '@ember/controller';
import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { join, schedule, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import RSVP from 'rsvp';

import { TrackedMap } from 'tracked-built-ins';

import {
  beginRuntimeDependencyTrackingSession,
  endRuntimeDependencyTrackingSession,
  formattedError,
  baseRealm,
  snapshotRuntimeDependencies,
  SupportedMimeType,
  isCardError,
  isBaseDefInstance,
  cardIdToURL,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RealmIdentifier,
  type RenderError,
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
  logger as runtimeLogger,
} from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import {
  coerceErrorMessage,
  serializableError,
} from '@cardstack/runtime-common/error';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  windowErrorHandler,
  errorJsonApiToErrorEntry,
} from '../lib/window-error-handler';
import { createAuthErrorGuard } from '../utils/auth-error-guard';
import { runDomDesyncCheck } from '../utils/render-desync-detector';
import {
  RenderCardTypeTracker,
  deriveCardTypeFromDoc,
  withCardType,
  coerceRenderError,
  normalizeRenderError,
} from '../utils/render-error';
import {
  enableRenderTimerStub,
  beginTimerBlock,
  appendRenderTimerSummaryToStack,
  resetRenderTimerStats,
  scheduleNativeTimeout,
} from '../utils/render-timer-stub';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RenderErrorStateService from '../services/render-error-state';
import type RenderStoreService from '../services/render-store';

type RenderStatus = 'loading' | 'ready' | 'error' | 'unusable';

export type Model = {
  instance?: CardDef;
  nonce: string;
  cardId: string;
  renderOptions: ReturnType<typeof parseRenderRouteOptions>;
  capturedDeps?: string[];
  readonly status: RenderStatus;
  readonly ready: boolean;
  readyPromise: Promise<void>;
};

type ModelState = {
  state: TrackedMap<string, unknown>;
  readyDeferred: Deferred<void>;
  isReady: boolean;
  readyWatchdogStarted?: boolean;
};

const renderReadyLogger = runtimeLogger('render-ready');
const READY_SETTLE_MAX_PASSES = 20;
const READY_SETTLE_REQUIRED_STABLE_PASSES = 2;
const SETTLE_LOG_PRECISION = 1;

export default class RenderRoute extends Route<Model> {
  @service('render-store') declare store: RenderStoreService;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare renderErrorState: RenderErrorStateService;

  private currentTransition: Transition | undefined;
  private lastStoreResetKey: string | undefined;
  private renderBaseParams: [string, string, string] | undefined;
  private lastRenderErrorSignature: string | undefined;
  #windowListenersAttached = false;
  #cardTypeTracker = new RenderCardTypeTracker();
  #modelStates = new Map<Model, ModelState>();
  #pendingReadyModels = new Set<Model>();
  #modelPromises = new Map<string, Promise<Model>>();
  #authGuard = createAuthErrorGuard();
  #restoreRenderTimers: (() => void) | undefined;
  #releaseTimerBlock: (() => void) | undefined;
  #handleUnhandledError = (error: any) => {
    if (
      error?.name === 'TransitionAborted' ||
      error?.code === 'TRANSITION_ABORTED'
    ) {
      return;
    }
    this.#markPrerenderUnusable(error);
    this.#setAllModelStatuses('unusable');
    this.handleRenderError(error);
  };

  errorHandler = (event: Event) => {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    let elements = this.#ensurePrerenderElements();
    windowErrorHandler({
      event,
      setStatusToUnusable: () => {
        if (elements.container) {
          elements.container.dataset.prerenderStatus = 'unusable';
        }
      },
      setError: (error) =>
        this.#writePrerenderError(elements.errorElement, error),
      currentURL: this.router.currentURL,
    });
    this.#setAllModelStatuses('unusable');
    if (isTesting()) {
      (globalThis as any).__boxelRenderContext = undefined;
    }
  };

  activate() {
    // this is for route errors, not window level error
    window.addEventListener('boxel-render-error', this.handleRenderError);
  }

  deactivate() {
    if (isTesting()) {
      (globalThis as any).__boxelRenderContext = undefined;
    }
    // Drop any pending `_federated-search` in-flight entries the
    // render-context coalescer accumulated during this visit. Entries
    // self-clear on settle, but a deactivate while one is still
    // in-flight could otherwise let a same-key caller arriving in the
    // next render coalesce onto a promise belonging to the previous
    // visit. The window is small (typically <1s per search) but the
    // cost of an explicit clear is also small.
    this.store.clearInFlightSearch();
    // The resolved-doc search cache is INTENTIONALLY NOT cleared
    // here. A single indexing job renders many cards in the same
    // prerender tab — each card navigation activates and deactivates
    // this route, but all those visits share one `__boxelJobId` and
    // a stable view of the consuming realm's `boxel_index`. Cached
    // entries from earlier renders in the job are the entire point;
    // dropping them per-render would defeat the cache. Cross-job
    // invalidation is handled by `fetchSearchDoc`'s entry-time
    // jobId-change clear (and by `resetState` on harder resets).
    (globalThis as any).__renderModel = undefined;
    (globalThis as any).__docsInFlight = undefined;
    (globalThis as any).__boxelRenderStage = undefined;
    // CS-10872: also tear down the stage setter + timestamp. Without
    // this, an in-flight task that fires after deactivate (e.g. a
    // straggler promise) could resume stage writes against the next
    // render's timeline and confuse a subsequent timeout capture.
    (globalThis as any).__boxelSetRenderStage = undefined;
    (globalThis as any).__boxelRenderStageSetAt = undefined;
    (globalThis as any).__boxelRenderDiagnostics = undefined;
    (globalThis as any).__waitForRenderLoadStability = undefined;
    window.removeEventListener('boxel-render-error', this.handleRenderError);
    this.#detachWindowErrorListeners();
    this.lastStoreResetKey = undefined;
    this.renderBaseParams = undefined;
    this.lastRenderErrorSignature = undefined;
    this.renderErrorState.clear();
    this.#modelStates.clear();
    this.#pendingReadyModels.clear();
    this.#modelPromises.clear();
    this.#authGuard.unregister();
    this.#cardTypeTracker.clear();
    this.#restoreRenderTimers?.();
    this.#restoreRenderTimers = undefined;
    this.#releaseTimerBlock?.();
    this.#releaseTimerBlock = undefined;
    endRuntimeDependencyTrackingSession();
  }

  async beforeModel(transition: Transition) {
    await super.beforeModel?.(transition);
    resetRenderTimerStats();
    if (!isTesting()) {
      // tests have their own way of dealing with window level errors in card-prerender.gts
      this.#attachWindowErrorListeners();
      this.realm.restoreSessionsFromStorage();
    }

    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__boxelRenderContext = true;
    this.#registerGlobalsDestructor();
    this.#authGuard.register();
    if (!isTesting()) {
      await this.store.ensureSetupComplete();
      this.#restoreRenderTimers = enableRenderTimerStub();
      this.#releaseTimerBlock = beginTimerBlock();
    }
  }

  async model(
    { id, nonce, options }: { id: string; nonce: string; options?: string },
    transition: Transition,
  ) {
    this.lastRenderErrorSignature = undefined;
    this.renderErrorState.clear();
    this.currentTransition = transition;
    let parsedOptions = parseRenderRouteOptions(options);
    let canonicalOptions = serializeRenderRouteOptions(parsedOptions);
    this.#setupTransitionHelper(id, nonce, canonicalOptions);
    // Stamp the "consuming realm" — the realm that owns the card being
    // rendered — onto a global the store-service's federated-search
    // wrapper reads. The realm-server's job-scoped search cache pairs
    // this with `x-boxel-job-id` to gate same-realm-only caching:
    // cross-realm reads bypass the cache because peer realms can swap
    // independently.
    try {
      let consumingRealm = this.realm.realmOf(new URL(id));
      (
        globalThis as unknown as { __boxelConsumingRealm?: string }
      ).__boxelConsumingRealm = consumingRealm
        ? String(consumingRealm)
        : undefined;
    } catch {
      (
        globalThis as unknown as { __boxelConsumingRealm?: string }
      ).__boxelConsumingRealm = undefined;
    }
    // CS-10872: render-stage breadcrumb. `model()` running means we
    // made it past route setup and are about to build the render
    // model. Each long-running stage below updates this slot so the
    // prerender's render-timeout error document can answer "where
    // was the render when it stalled?".
    (globalThis as any).__boxelRenderStage = 'model:start';
    (globalThis as any).__boxelRenderStageSetAt = Date.now();
    // CS-10872: every `__boxelRenderStage = X` write should also bump
    // `__boxelRenderStageSetAt` so the timeout capture can report
    // `stageAgeMs`. The setter wrapper below is the single place
    // that enforces it; callers write via `__boxelSetRenderStage`.
    (globalThis as any).__boxelSetRenderStage = (stage: string) => {
      (globalThis as any).__boxelRenderStage = stage;
      (globalThis as any).__boxelRenderStageSetAt = Date.now();
    };
    // this is a tool for our prerenderer to understand if a timed out render is salvageable
    (globalThis as any).__docsInFlight = () =>
      this.store.cardDocsInFlight.length +
      this.store.fileMetaDocsInFlight.length;
    // CS-10872: structured diagnostics hook preferred by the
    // prerender's render-timeout capture path. Returns URL lists,
    // in-flight module imports, in-flight query-field loads and the
    // current stage so operators can tell loader-stall from query-
    // stall from render-stall without reverse-engineering the DOM.
    (globalThis as any).__boxelRenderDiagnostics = () => {
      let loader = this.loaderService.loader;
      let storeService = this.store as unknown as {
        cardDocsInFlight: string[];
        fileMetaDocsInFlight: string[];
        queryLoadsInFlight?: () => Array<Record<string, unknown>>;
        cardDocLoadsInFlight?: () => Array<{ url: string; ageMs: number }>;
        fileMetaDocLoadsInFlight?: () => Array<{ url: string; ageMs: number }>;
        recentCardDocLoads?: () => Array<{ url: string; ms: number }>;
        recentFileMetaLoads?: () => Array<{ url: string; ms: number }>;
        recentQueryLoads?: () => Array<Record<string, unknown>>;
      };
      let stage = (globalThis as any).__boxelRenderStage ?? null;
      let stageSetAt = (globalThis as any).__boxelRenderStageSetAt ?? null;
      let stageAgeMs =
        typeof stageSetAt === 'number' ? Date.now() - stageSetAt : null;
      let loaderAny = loader as unknown as {
        inFlightModuleImports?: string[];
        currentlyEvaluatingModule?: string | null;
        recentModuleEvaluations?: Array<{ url: string; ms: number }>;
      };
      return {
        renderStage: stage,
        stageAgeMs,
        currentId: id,
        currentNonce: nonce,
        cardDocsInFlight: storeService.cardDocsInFlight ?? [],
        fileMetaDocsInFlight: storeService.fileMetaDocsInFlight ?? [],
        cardDocLoadsInFlight: storeService.cardDocLoadsInFlight?.() ?? [],
        fileMetaDocLoadsInFlight:
          storeService.fileMetaDocLoadsInFlight?.() ?? [],
        recentCardDocLoads: storeService.recentCardDocLoads?.() ?? [],
        recentFileMetaLoads: storeService.recentFileMetaLoads?.() ?? [],
        inFlightModuleImports: loaderAny?.inFlightModuleImports ?? [],
        currentlyEvaluatingModule: loaderAny?.currentlyEvaluatingModule ?? null,
        recentModuleEvaluations: loaderAny?.recentModuleEvaluations ?? [],
        queryLoadsInFlight: storeService.queryLoadsInFlight?.() ?? [],
        recentQueryLoads: storeService.recentQueryLoads?.() ?? [],
      };
    };
    (globalThis as any).__waitForRenderLoadStability = async () => {
      try {
        await this.#authGuard.race(() =>
          this.#waitForRenderLoadStability(this.#normalizeCardId(id)),
        );
      } catch (error) {
        if (this.#authGuard.isAuthError(error)) {
          this.#processRenderError(error);
          return;
        }
        throw error;
      }
    };
    let key = `${id}|${nonce}|${canonicalOptions}`;
    let existing = this.#modelPromises.get(key);
    if (existing) {
      return await existing;
    }
    beginRuntimeDependencyTrackingSession({
      sessionKey: key,
      rootURL: id,
      rootKind:
        parsedOptions.fileExtract || parsedOptions.fileRender
          ? 'file'
          : 'instance',
    });

    // the window.boxelTransitionTo() function helper first normalizes the base
    // params by transitioning the router back to 'render' before it goes on to
    // 'render.html', 'render.meta', etc. That’s why you see the /render model
    // hook fire twice per prerender step: every format capture goes through a
    // parent transition (render), then to the actual child route, so the parent
    // model executes twice per prerender, hence the need to share the work.
    let promise = this.#buildModel({ id, nonce }, parsedOptions);
    this.#modelPromises.set(key, promise);
    return await promise;
  }

  async #buildModel(
    { id, nonce }: { id: string; nonce: string },
    parsedOptions: ReturnType<typeof parseRenderRouteOptions>,
  ): Promise<Model> {
    if (parsedOptions.clearCache) {
      this.loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'render-route clearCache',
      });
      let resetKey = `${id}:${nonce}`;
      if (this.lastStoreResetKey !== resetKey) {
        this.store.resetCache();
        this.lastStoreResetKey = resetKey;
      }
    }
    if (parsedOptions.fileExtract) {
      let state = new TrackedMap<string, unknown>();
      state.set('status', 'ready');
      let readyDeferred = new Deferred<void>();
      readyDeferred.fulfill();
      let model: Model = {
        instance: undefined,
        nonce,
        cardId: id,
        renderOptions: parsedOptions,
        get status(): RenderStatus {
          return (state.get('status') as RenderStatus) ?? 'loading';
        },
        get ready(): boolean {
          return (state.get('status') as RenderStatus) === 'ready';
        },
        readyPromise: readyDeferred.promise,
      };
      this.#modelStates.set(model, {
        state,
        readyDeferred,
        isReady: true,
      });
      (globalThis as any).__renderModel = model;
      this.currentTransition = undefined;
      return model;
    }
    if (parsedOptions.fileRender) {
      let fileRenderData = (globalThis as any).__boxelFileRenderData as
        | { resource: any; fileDefCodeRef: { module: string; name: string } }
        | undefined;
      if (!fileRenderData) {
        throw new Error('fileRender mode requires __boxelFileRenderData');
      }
      let { resource } = fileRenderData;
      let doc = { data: resource };
      let instance = (await this.store.addFileMeta(
        resource,
        doc,
        resource.id ? cardIdToURL(resource.id) : undefined,
      )) as unknown as CardDef;

      let state = new TrackedMap<string, unknown>();
      state.set('status', 'ready');
      let readyDeferred = new Deferred<void>();
      readyDeferred.fulfill();
      let model: Model = {
        instance,
        nonce,
        cardId: id,
        renderOptions: parsedOptions,
        get status(): RenderStatus {
          return (state.get('status') as RenderStatus) ?? 'loading';
        },
        get ready(): boolean {
          return (state.get('status') as RenderStatus) === 'ready';
        },
        readyPromise: readyDeferred.promise,
      };
      this.#modelStates.set(model, {
        state,
        readyDeferred,
        isReady: true,
      });
      (globalThis as any).__renderModel = model;
      this.currentTransition = undefined;
      return model;
    }
    // This is for host tests
    (globalThis as any).__renderModel = undefined;

    (globalThis as any).__boxelSetRenderStage?.('buildModel:fetching-source');
    let response: Response;
    try {
      response = await this.#authGuard.race(() =>
        this.network.authedFetch(id, {
          method: 'GET',
          headers: {
            Accept: SupportedMimeType.CardSource,
          },
        }),
      );
    } catch (err: any) {
      if (this.#authGuard.isAuthError(err)) {
        this.#processRenderError(err);
        throw err;
      }
      throw err;
    }

    let realmURL = response.headers.get('x-boxel-realm-url')!;
    let lastModified = new Date(response.headers.get('last-modified')!);
    let doc: LooseSingleCardDocument | CardErrorsJSONAPI =
      await response.json();
    let canonicalId = id.replace(/\.json$/, '');

    let state = new TrackedMap<string, unknown>();
    state.set('status', 'loading');

    // the rendering of the templates is what pulls on the linked fields to load
    // them. before the card templates are rendered there are no in-flight
    // requests for linked fields. so in order to properly wait for the linked
    // fields to load we must first render the /render/html route (preferably
    // the isolated format), and then the store will start tracking the
    // in-flight link requests. after the store settles the prerendered output
    // will be ready to capture. this readyDeferred will let us know when the
    // prerendered output is ready for capture.
    let readyDeferred = new Deferred<void>();
    let modelState: ModelState = {
      state,
      readyDeferred,
      isReady: false,
    };
    let model: Model = {
      instance: undefined as unknown as CardDef,
      nonce,
      cardId: canonicalId,
      renderOptions: parsedOptions,
      get status(): RenderStatus {
        return (state.get('status') as RenderStatus) ?? 'loading';
      },
      get ready(): boolean {
        return (state.get('status') as RenderStatus) === 'ready';
      },
      readyPromise: readyDeferred.promise,
    };
    this.#modelStates.set(model, modelState);

    let instance: CardDef | undefined;
    try {
      if ('errors' in doc) {
        this.#dispositionModel(model, 'error');
        this.#cardTypeTracker.set({ cardId: canonicalId, nonce }, undefined);
        throw new Error(JSON.stringify(doc.errors[0], null, 2));
      }
      (globalThis as any).__boxelSetRenderStage?.('buildModel:deriving-type');
      let { derivedCardType, hydratedInstance } = await this.#authGuard.race(
        async () => {
          let derivedCardType = await deriveCardTypeFromDoc(
            doc,
            id,
            this.loaderService.loader,
          );

          await this.realm.ensureRealmMeta(realmURL);

          let enhancedDoc: LooseSingleCardDocument = {
            ...doc,
            data: {
              ...doc.data,
              id: canonicalId,
              type: 'card',
              meta: {
                ...doc.data.meta,
                lastModified: lastModified.getTime(),
                realmURL: realmURL as RealmIdentifier,
                realmInfo: { ...this.realm.info(id) },
              },
            },
          };

          (globalThis as any).__boxelSetRenderStage?.('buildModel:hydrating');
          let hydratedInstance = await this.store.add(enhancedDoc, {
            relativeTo: cardIdToURL(id),
            realm: realmURL,
            doNotPersist: true,
          });
          if (hydratedInstance) {
            (globalThis as any).__boxelSetRenderStage?.(
              'buildModel:touching-used-fields',
            );
            await this.#touchIsUsedFields(hydratedInstance);
          }
          (globalThis as any).__boxelSetRenderStage?.(
            'buildModel:store-settle',
          );
          await this.store.loaded();
          return { derivedCardType, hydratedInstance };
        },
      );
      this.#cardTypeTracker.set(
        { cardId: canonicalId, nonce },
        derivedCardType,
      );
      instance = hydratedInstance;
      model.instance = instance;
    } catch (e: any) {
      console.warn(
        `Encountered error when deserializing doc for ${id}: ${e.message}: ${e.responseText}`,
        e?.stack,
      );
      this.#dispositionModel(model, 'error');
      throw e;
    }
    if (instance) {
      model.instance = instance;
    }
    this.#scheduleReady(model);

    // this is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    (globalThis as any).__renderModel = model;
    this.currentTransition = undefined;
    return model;
  }

  async #touchIsUsedFields(instance: CardDef): Promise<void> {
    let cardApi = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    this.#touchIsUsedRelationships(
      cardApi,
      instance,
      new WeakSet<object>(),
      new WeakMap<object, boolean>(),
    );
  }

  #touchFieldSafely(container: any, fieldName: string): unknown {
    try {
      // accessing the field triggers lazy loading for links
      return container?.[fieldName];
    } catch (error) {
      console.warn(
        `Failed to touch field '${fieldName}' on ${container?.constructor?.name ?? 'Unknown'} for isUsed=true:`,
        error,
      );
      return undefined;
    }
  }

  #touchIsUsedRelationships(
    cardApi: typeof CardAPI,
    value: unknown,
    visited: WeakSet<object>,
    typeHasUsedRelationshipCache: WeakMap<object, boolean>,
  ): void {
    if (Array.isArray(value)) {
      for (let item of value) {
        this.#touchIsUsedRelationships(
          cardApi,
          item,
          visited,
          typeHasUsedRelationshipCache,
        );
      }
      return;
    }
    if (!isBaseDefInstance(value)) {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    let fields = cardApi.getFields(value, { includeComputeds: true });
    for (let [fieldName, field] of Object.entries(fields)) {
      if (!field) {
        continue;
      }
      if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
        if (field.isUsed) {
          this.#touchFieldSafely(value, fieldName);
        }
        continue;
      }
      if (
        field.fieldType === 'contains' ||
        field.fieldType === 'containsMany'
      ) {
        if (
          !this.#typeHasIsUsedRelationship(
            cardApi,
            field.card as CardAPI.BaseDefConstructor,
            new WeakSet<object>(),
            typeHasUsedRelationshipCache,
          )
        ) {
          continue;
        }
        let nested = this.#touchFieldSafely(value, fieldName);
        this.#touchIsUsedRelationships(
          cardApi,
          nested,
          visited,
          typeHasUsedRelationshipCache,
        );
      }
    }
  }

  #typeHasIsUsedRelationship(
    cardApi: typeof CardAPI,
    type: CardAPI.BaseDefConstructor,
    visitedTypes: WeakSet<object>,
    cache: WeakMap<object, boolean>,
  ): boolean {
    if (cache.has(type)) {
      return cache.get(type)!;
    }
    if (visitedTypes.has(type)) {
      return false;
    }
    visitedTypes.add(type);

    let fields = cardApi.getFields(type, { includeComputeds: true });
    for (let field of Object.values(fields)) {
      if (!field) {
        continue;
      }
      if (
        (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') &&
        field.isUsed
      ) {
        cache.set(type, true);
        return true;
      }
      if (
        (field.fieldType === 'contains' ||
          field.fieldType === 'containsMany') &&
        this.#typeHasIsUsedRelationship(
          cardApi,
          field.card as CardAPI.BaseDefConstructor,
          visitedTypes,
          cache,
        )
      ) {
        cache.set(type, true);
        return true;
      }
    }

    cache.set(type, false);
    return false;
  }

  setupController(controller: Controller, model: Model) {
    super.setupController(controller, model);
    this.#scheduleReady(model);
  }

  #scheduleReady(model: Model) {
    let modelState = this.#modelStates.get(model);
    if (!modelState || modelState.isReady) {
      return;
    }
    renderReadyLogger.debug(
      `scheduling ready settlement for cardId=${model.cardId}`,
    );
    this.#pendingReadyModels.add(model);
    scheduleOnce('afterRender', this, this.#processPendingReadyModels);
    this.#startReadyWatchdog(model);
  }

  #processPendingReadyModels() {
    if (this.isDestroying || this.isDestroyed) {
      this.#pendingReadyModels.clear();
      return;
    }
    for (let model of this.#pendingReadyModels) {
      void this.#settleModelAfterRenderSafely(model);
    }
    this.#pendingReadyModels.clear();
  }

  // In rare cases the afterRender queue does not fire, leaving prerender
  // status stuck at "loading" forever. This watchdog forces the ready path
  // after a few animation frames so we can unblock prerenders.
  #startReadyWatchdog(model: Model) {
    let modelState = this.#modelStates.get(model);
    if (
      !modelState ||
      modelState.isReady ||
      modelState.readyWatchdogStarted ||
      typeof requestAnimationFrame !== 'function'
    ) {
      return;
    }
    modelState.readyWatchdogStarted = true;
    let attempts = 0;
    let tick = () => {
      let current = this.#modelStates.get(model);
      if (
        !current ||
        current.isReady ||
        this.isDestroying ||
        this.isDestroyed
      ) {
        return;
      }
      if (attempts++ >= 2) {
        void this.#settleModelAfterRenderSafely(model);
        return;
      }
      requestAnimationFrame(tick); // eslint-disable-line @cardstack/boxel/no-raf-for-state -- prerender render-loop timing
    };
    requestAnimationFrame(tick); // eslint-disable-line @cardstack/boxel/no-raf-for-state -- prerender render-loop timing
  }

  async #settleModelAfterRender(model: Model): Promise<void> {
    let modelState = this.#modelStates.get(model);
    if (!modelState || modelState.isReady) {
      return;
    }
    renderReadyLogger.debug(
      `settleModelAfterRender start cardId=${model.cardId} status=${model.status}`,
    );
    await this.#authGuard.race(() =>
      this.#waitForRenderLoadStability(model.cardId),
    );
    renderReadyLogger.debug(
      `settleModelAfterRender store.loaded resolved cardId=${model.cardId}`,
    );
    modelState.state.set('status', 'ready');
    modelState.isReady = true;
    modelState.readyDeferred.fulfill();
    await modelState.readyDeferred.promise;
    model.capturedDeps = snapshotRuntimeDependencies({
      excludeQueryOnly: true,
    }).deps;
    renderReadyLogger.debug(
      `settleModelAfterRender done cardId=${model.cardId} deps=${model.capturedDeps?.length ?? 0}`,
    );
    // Kick off a one-shot DOM desync check that guards against the
    // runloop-swallowed-exception class of render failures. See
    // `render-desync-detector.ts` for the full mechanism + the
    // false-positive chart. Fire-and-forget; the check runs async and
    // surfaces any detected desync directly to the DOM.
    void runDomDesyncCheck({
      cardId: model.cardId,
      nonce: model.nonce,
      isDestroyed: () => this.isDestroying || this.isDestroyed,
      isReady: () => this.#modelStates.get(model)?.isReady ?? false,
      modelStatus: () => model.status,
      scheduleNativeTimeout,
      ensurePrerenderElements: () => this.#ensurePrerenderElements(),
      appendStackSummary: (stack) => appendRenderTimerSummaryToStack(stack),
      microtaskYields: (globalThis as any).__boxelDomDesyncMicrotaskYields,
      settleHopsMs: (globalThis as any).__boxelDomDesyncSettleHopsMs,
    });
  }

  async #waitForRenderLoadStability(cardId: string): Promise<void> {
    (globalThis as any).__boxelSetRenderStage?.('waiting-stability');
    let settleStartMs = nowMs();
    let stablePasses = 0;
    let passesCompleted = 0;
    let generationChanges = 0;
    let storeLoadWaitMs = 0;
    let frameWaitMs = 0;
    let observedGeneration = this.store.loadGeneration;
    for (let pass = 0; pass < READY_SETTLE_MAX_PASSES; pass++) {
      let storeLoadStartMs = nowMs();
      await this.store.loaded();
      storeLoadWaitMs += nowMs() - storeLoadStartMs;
      let frameWaitStartMs = nowMs();
      await this.#waitForNextRenderFrame();
      frameWaitMs += nowMs() - frameWaitStartMs;
      passesCompleted = pass + 1;
      let nextGeneration = this.store.loadGeneration;
      let generationChanged = nextGeneration !== observedGeneration;
      if (generationChanged) {
        observedGeneration = nextGeneration;
        stablePasses = 0;
        generationChanges++;
      } else {
        stablePasses++;
      }
      renderReadyLogger.debug(
        `waitForRenderLoadStability pass=${pass + 1}/${READY_SETTLE_MAX_PASSES} cardId=${cardId} generation=${nextGeneration} stablePasses=${stablePasses}`,
      );
      if (stablePasses >= READY_SETTLE_REQUIRED_STABLE_PASSES) {
        break;
      }
    }
    let finalStoreLoadStartMs = nowMs();
    await this.store.loaded();
    storeLoadWaitMs += nowMs() - finalStoreLoadStartMs;
    let totalSettleMs = nowMs() - settleStartMs;
    let reachedMaxPasses = passesCompleted >= READY_SETTLE_MAX_PASSES;

    renderReadyLogger.debug(
      `waitForRenderLoadStability settled cardId=${cardId} passes=${passesCompleted}/${READY_SETTLE_MAX_PASSES} stablePasses=${stablePasses} generationChanges=${generationChanges} totalMs=${formatMs(totalSettleMs)} storeLoadMs=${formatMs(storeLoadWaitMs)} frameWaitMs=${formatMs(frameWaitMs)} reachedMaxPasses=${reachedMaxPasses}`,
    );
    if (
      reachedMaxPasses &&
      stablePasses < READY_SETTLE_REQUIRED_STABLE_PASSES
    ) {
      renderReadyLogger.warn(
        `waitForRenderLoadStability hit max passes cardId=${cardId} stablePasses=${stablePasses} requiredStablePasses=${READY_SETTLE_REQUIRED_STABLE_PASSES} totalMs=${formatMs(totalSettleMs)}`,
      );
    }
  }

  async #waitForNextRenderFrame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
      await Promise.resolve();
      return;
    }
    // In the prerender context, requestAnimationFrame is throttled in
    // background tabs (~1 frame/10s) and may be slow in headless browsers.
    // Use a native setTimeout(0) instead — this yields to the event loop so
    // Ember's runloop can flush, without being subject to RAF throttling.
    // The timer bypasses the prerender timer stub via scheduleNativeTimeout.
    if ((globalThis as any).__boxelRenderContext) {
      await new Promise<void>((resolve) => scheduleNativeTimeout(resolve, 0));
      return;
    }
    await new Promise<void>((resolve) =>
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- needs actual paint callback for render timing
      requestAnimationFrame(() => resolve()),
    );
  }

  #settleModelAfterRenderSafely(model: Model) {
    return this.#settleModelAfterRender(model).catch((error) => {
      this.#dispositionModel(model, 'error');
      this.handleRenderError(error);
    });
  }

  #dispositionModel(model: Model, status: RenderStatus = 'error') {
    let modelState = this.#modelStates.get(model);
    if (!modelState) {
      return;
    }
    this.#pendingReadyModels.delete(model);
    modelState.state.set('status', status);
    if (!modelState.isReady) {
      modelState.isReady = true;
      modelState.readyDeferred.fulfill();
    }
  }

  #rejectAllModelStates(status: RenderStatus = 'error') {
    for (let model of this.#modelStates.keys()) {
      this.#dispositionModel(model, status);
    }
  }

  #setAllModelStatuses(status: RenderStatus) {
    for (let model of this.#modelStates.keys()) {
      this.#dispositionModel(model, status);
    }
  }

  #writePrerenderError(errorElement: HTMLElement | null, error: any) {
    if (!errorElement) {
      return;
    }
    try {
      errorElement.textContent =
        typeof error === 'string' ? error : JSON.stringify(error, null, 2);
    } catch {
      // best-effort; avoid throwing while handling an error
    }
  }

  // Headless prerendering drives Ember via this hook, and it may repeatedly
  // transition between render subroutes while the parent render route is
  // already active. Ember already provides the contexts (id, nonce,
  // options) for nested routes, so blindly calling
  // transitionTo(...args) can end up with duplicate or stale arguments,
  // triggering "More context objects were passed" errors. This wrapper
  // normalizes the parameter list: if we get a full render transition we
  // pass the canonical base params; for render.* routes we strip any existing
  // base params (or establish them first if they changed) before handing off
  // to the router. Everything runs inside Ember's run loop via join().
  #transitionHelperDestructorRegistered = false;
  #lastTransitionFn: Function | undefined;
  #globalsDestructorRegistered = false;

  #registerGlobalsDestructor() {
    if (this.#globalsDestructorRegistered) {
      return;
    }
    this.#globalsDestructorRegistered = true;
    registerDestructor(this, () => {
      // Clear globals on owner destroy. deactivate() also clears these on
      // normal route teardown, but in tests the owner can be destroyed
      // without deactivate firing, leaving these closures pinning `this`
      // (and the entire ApplicationInstance) on globalThis.
      (globalThis as any).__boxelRenderContext = undefined;
      (globalThis as any).__renderModel = undefined;
      (globalThis as any).__docsInFlight = undefined;
      (globalThis as any).__waitForRenderLoadStability = undefined;
    });
  }

  #setupTransitionHelper(id: string, nonce: string, options: string) {
    let baseParams: [string, string, string] = [id, nonce, options];
    this.renderBaseParams = baseParams;
    let transitionFn = (
      routeName: Parameters<RouterService['transitionTo']>[0],
      ...params: any[]
    ) => {
      if (routeName === 'render') {
        if (params.length >= 3) {
          baseParams = params.slice(0, 3) as [string, string, string];
        }
        this.renderBaseParams = baseParams;
        join(() =>
          this.router.transitionTo(
            routeName as never,
            ...(baseParams as unknown as never[]),
          ),
        );
        return;
      }
      if (typeof routeName === 'string' && routeName.startsWith('render.')) {
        let normalized = [...params];
        if (
          normalized.length >= 3 &&
          normalized[0] === baseParams[0] &&
          normalized[1] === baseParams[1] &&
          normalized[2] === baseParams[2]
        ) {
          normalized = normalized.slice(3);
        } else if (normalized.length >= 3) {
          let targetBase = normalized.slice(0, 3) as [string, string, string];
          join(() => this.router.transitionTo('render', ...targetBase));
          baseParams = targetBase;
          this.renderBaseParams = baseParams;
          normalized = normalized.slice(3);
        }
        join(() => this.router.transitionTo(routeName, ...normalized));
        return;
      }
      join(() =>
        this.router.transitionTo(routeName as never, ...(params as never[])),
      );
    };
    (globalThis as any).boxelTransitionTo = transitionFn;
    this.#lastTransitionFn = transitionFn;
    if (!this.#transitionHelperDestructorRegistered) {
      this.#transitionHelperDestructorRegistered = true;
      registerDestructor(this, () => {
        // Only clear if the global still points at the last function we
        // installed. This avoids both pinning this route (and its owner)
        // via globalThis and clobbering another live route's helper.
        if ((globalThis as any).boxelTransitionTo === this.#lastTransitionFn) {
          delete (globalThis as any).boxelTransitionTo;
        }
      });
    }
  }

  @action
  error(error: any, transition: Transition) {
    if (isTesting() && !(globalThis as any).__doNotSuppressRenderRouteError) {
      // don't hijack routing in the host tests
      return false;
    }

    transition.abort();
    this.handleRenderError(error, transition);
    return false;
  }

  private handleRenderError = (errorOrEvent: any, transition?: Transition) => {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    let event =
      'reason' in errorOrEvent || 'detail' in errorOrEvent
        ? errorOrEvent
        : undefined;
    let error: any;
    if (event) {
      error =
        'reason' in event
          ? (event as any).reason
          : (event as CustomEvent).detail?.reason;
    } else {
      error = errorOrEvent;
    }
    this.#processRenderError(error, transition);
  };

  #processRenderError(error: any, transition?: Transition) {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    this.currentTransition?.abort();
    this.#rejectAllModelStates('error');
    let context = this.#deriveErrorContext(transition);
    let cardType = this.#cardTypeTracker.get({
      cardId: context.cardId,
      nonce: context.nonce,
    });
    let serializedError = this.#serializeRenderError(
      error,
      transition,
      cardType,
      context,
    );
    let signature = this.#makeErrorSignature(serializedError, context);
    if (signature === this.lastRenderErrorSignature) {
      return;
    }
    this.lastRenderErrorSignature = signature;
    this.renderErrorState.setError({
      reason: serializedError,
      cardId: context.cardId,
      nonce: context.nonce,
    });
    this.#applyErrorMetadataAttrs(context);
    let canTransitionToErrorRoute = this.renderBaseParams !== undefined;
    this.#transitionToErrorRoute(transition);

    // The prerender server's wait condition treats data-prerender-status='error'
    // as "DOM is settled, snapshot now". Writing it synchronously alongside the
    // transition means the server can poll between the status flip and Glimmer
    // flushing the render.error template, capturing an empty <pre data-prerender-error>
    // (CS-11024). Defer the status flip to afterRender so the readiness signal
    // is only raised once the error template's textContent has been written.
    //
    // Skip the schedule when #transitionToErrorRoute took its early-failure
    // fallback (no renderBaseParams — error fired before model() ran). That
    // path writes data-prerender-status='unusable' synchronously to force page
    // eviction, and the error textContent is also written synchronously on
    // the same path, so deferring isn't needed — and overwriting 'unusable'
    // with 'error' here would defeat the eviction signal.
    if (canTransitionToErrorRoute) {
      schedule('afterRender', this, this.#applyErrorStatus, context);
    }
  }

  #serializeRenderError(
    error: any,
    transition?: Transition,
    cardType?: string,
    context?: { cardId?: string; nonce?: string },
  ): string {
    let transitionId = this.#transitionCardId(transition);
    let fallbackDeps = this.#fallbackDepsFromIds([
      context?.cardId,
      transitionId,
    ]);
    let normalizationContext = {
      cardId: context?.cardId,
      normalizeCardId: (id: string) => this.#normalizeCardId(id),
    };
    let coerceFromMessage =
      typeof error?.message === 'string'
        ? coerceRenderError(error.message)
        : undefined;
    let coerceFromValue = coerceFromMessage ?? coerceRenderError(error);
    if (coerceFromValue) {
      let normalized = normalizeRenderError(
        coerceFromValue,
        normalizationContext,
      );
      return this.#serializeNormalizedRenderError(
        normalized,
        cardType,
        fallbackDeps,
      );
    }
    if (isCardError(error)) {
      let normalized = normalizeRenderError(
        {
          type: 'instance-error',
          error: serializableError(error),
        },
        normalizationContext,
      );
      return this.#serializeNormalizedRenderError(
        normalized,
        cardType,
        fallbackDeps,
      );
    }
    let id = transitionId;
    let errorJSONAPI = formattedError(id, error).errors[0];
    let errorPayload = normalizeRenderError(
      errorJsonApiToErrorEntry(errorJSONAPI) as RenderError,
      normalizationContext,
    );
    return this.#serializeNormalizedRenderError(
      errorPayload as RenderError,
      cardType,
      fallbackDeps,
    );
  }

  #serializeNormalizedRenderError(
    renderError: RenderError,
    cardType?: string,
    fallbackDeps: string[] = [],
  ): string {
    let withType = withCardType(renderError, cardType);
    let withTimerSummary = this.#appendTimerSummary(withType);
    let withRuntimeDeps = this.#appendRuntimeDeps(
      withTimerSummary,
      fallbackDeps,
    );
    // The persisted error doc is useless if `message` is empty or
    // undefined — the indexer's index-writer guard refuses such rows
    // and fails the whole indexing job. Guarantee a non-empty message
    // here as the last stop before serialization to the DOM.
    let withGuaranteedMessage: RenderError = {
      ...withRuntimeDeps,
      error: {
        ...withRuntimeDeps.error,
        message: coerceErrorMessage(
          withRuntimeDeps.error,
          'Render failed (host produced no error message)',
        ),
      },
    };
    return JSON.stringify(
      this.#stripLastKnownGoodHtml(withGuaranteedMessage),
      null,
      2,
    );
  }

  #appendRuntimeDeps(
    renderError: RenderError,
    fallbackDeps: string[],
  ): RenderError {
    let runtimeDeps = snapshotRuntimeDependencies({
      excludeQueryOnly: true,
    }).deps;
    let mergedDeps = [
      ...new Set([...(renderError.error.deps ?? []), ...runtimeDeps]),
    ];
    if (mergedDeps.length === 0 && fallbackDeps.length > 0) {
      mergedDeps = [...new Set(fallbackDeps)];
    }
    return {
      ...renderError,
      error: {
        ...renderError.error,
        deps: mergedDeps,
      },
    };
  }

  #appendTimerSummary(renderError: RenderError): RenderError {
    let updatedStack = appendRenderTimerSummaryToStack(
      renderError?.error?.stack ?? undefined,
    );
    if (
      updatedStack === undefined ||
      updatedStack === renderError.error.stack
    ) {
      return renderError;
    }
    return {
      ...renderError,
      error: {
        ...renderError.error,
        stack: updatedStack,
      },
    };
  }

  #stripLastKnownGoodHtml<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) =>
        this.#stripLastKnownGoodHtml(item),
      ) as unknown as T;
    }
    if (value && typeof value === 'object') {
      let entries = Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [key, val]) => {
          if (key === 'lastKnownGoodHtml') {
            return acc;
          }
          acc[key] = this.#stripLastKnownGoodHtml(val);
          return acc;
        },
        {},
      );
      return entries as T;
    }

    // also strip out query params in URL like ?noCache
    if (
      value &&
      typeof value === 'string' &&
      !value.includes(' ') &&
      (value.startsWith('http://') || value.startsWith('https://'))
    ) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(value);
      } catch (e) {
        return value;
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.href as T;
    }
    return value;
  }

  #deriveErrorContext(transition?: Transition): {
    cardId?: string;
    nonce?: string;
  } {
    let cardId: string | undefined;
    let nonce: string | undefined;
    let base = this.renderBaseParams;
    if (base) {
      cardId = this.#normalizeCardId(base[0]);
      nonce = base[1];
    }
    if ((!cardId || !nonce) && transition) {
      let current: Transition['to'] | null = transition.to;
      while (current) {
        let params = current.params as Record<string, unknown> | undefined;
        if (params) {
          if (!cardId && typeof params.id === 'string') {
            cardId = this.#normalizeCardId(params.id);
          }
          if (!nonce && typeof params.nonce === 'string') {
            nonce = params.nonce;
          }
        }
        current = current.parent;
      }
    }
    return { cardId, nonce };
  }

  #makeErrorSignature(
    serializedError: string,
    context: { cardId?: string; nonce?: string },
  ): string {
    return JSON.stringify({
      reason: serializedError,
      cardId: context.cardId ?? null,
      nonce: context.nonce ?? null,
    });
  }

  #normalizeCardId(id: string): string {
    try {
      let decoded = decodeURIComponent(id);
      return decoded.replace(/\.json$/, '');
    } catch {
      return id.replace(/\.json$/, '');
    }
  }

  #applyErrorMetadataAttrs(context: { cardId?: string; nonce?: string }) {
    if (typeof document === 'undefined') {
      return;
    }
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    if (container) {
      if (context.cardId) {
        container.dataset.prerenderId = context.cardId;
      }
      if (context.nonce) {
        container.dataset.prerenderNonce = context.nonce;
      }
    }
    let errorElement = document.querySelector(
      '[data-prerender-error]',
    ) as HTMLElement | null;
    if (errorElement) {
      if (context.cardId) {
        errorElement.dataset.prerenderId = context.cardId;
      }
      if (context.nonce) {
        errorElement.dataset.prerenderNonce = context.nonce;
      }
    }
  }

  #applyErrorStatus(context: { cardId?: string; nonce?: string }) {
    if (this.isDestroying || this.isDestroyed) {
      return;
    }
    if (typeof document === 'undefined') {
      return;
    }
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    if (!container) {
      return;
    }
    container.dataset.prerenderStatus = 'error';
    if (context.cardId && !container.dataset.prerenderId) {
      container.dataset.prerenderId = context.cardId;
    }
    if (context.nonce && !container.dataset.prerenderNonce) {
      container.dataset.prerenderNonce = context.nonce;
    }
  }

  #markPrerenderUnusable(error?: any) {
    if (typeof document === 'undefined') {
      return;
    }
    let { container, errorElement } = this.#ensurePrerenderElements();
    if (container) {
      container.dataset.prerenderStatus = 'unusable';
    }
    if (error) {
      this.#writePrerenderError(errorElement, error);
    }
  }

  #attachWindowErrorListeners() {
    if (this.#windowListenersAttached || typeof window === 'undefined') {
      return;
    }
    window.addEventListener('error', this.errorHandler);
    window.addEventListener('unhandledrejection', this.errorHandler);
    RSVP.on('error', this.#handleUnhandledError);
    this.#windowListenersAttached = true;
  }

  #detachWindowErrorListeners() {
    if (!this.#windowListenersAttached || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('error', this.errorHandler);
    window.removeEventListener('unhandledrejection', this.errorHandler);
    RSVP.off('error', this.#handleUnhandledError);
    this.#windowListenersAttached = false;
  }

  #ensurePrerenderElements(): {
    container: HTMLElement | null;
    errorElement: HTMLElement | null;
  } {
    if (typeof document === 'undefined') {
      return { container: null, errorElement: null };
    }
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-prerender', '');
      document.body.appendChild(container);
    }
    let errorElement = document.querySelector(
      '[data-prerender-error]',
    ) as HTMLElement | null;
    if (!errorElement) {
      errorElement = document.createElement('pre');
      errorElement.setAttribute('data-prerender-error', '');
      container.appendChild(errorElement);
    }
    return { container, errorElement };
  }

  #transitionToErrorRoute(transition?: Transition) {
    let baseParams = this.renderBaseParams;
    if (baseParams) {
      if (transition) {
        // During the initial render transition Ember expects to finalize the
        // parent route, so stick with intermediateTransitionTo to avoid
        // queueing a second render transition with missing params.
        this.intermediateTransitionTo('render.error', ...baseParams);
      } else {
        // Once the render route is already active we can safely let the router
        // handle the subroute transition, but schedule it within the run loop to
        // avoid the hangs we saw when using intermediateTransitionTo.
        join(() => this.router.transitionTo('render.error', ...baseParams));
      }
      return;
    }

    // If we hit an error before the model hook runs, base params are not yet set.
    // Create the prerender markers manually so the prerenderer can capture the error
    // without trying to transition and triggering a router param error. We've given up
    // on Ember's routing here, so mark the result as unusable to force eviction.
    let params = transition?.to?.params as
      | { id?: string; nonce?: string; options?: string }
      | undefined;
    let { container, errorElement } = this.#ensurePrerenderElements();
    let reason = this.renderErrorState.reason ?? '';
    let parsedReason: any;
    let fallbackDeps = this.#fallbackDepsFromTransitionParams(params);
    try {
      parsedReason = JSON.parse(reason);
    } catch {
      parsedReason = undefined;
    }
    if (parsedReason && typeof parsedReason === 'object') {
      if (parsedReason.error && typeof parsedReason.error === 'object') {
        parsedReason.error.deps = [
          ...new Set([...(parsedReason.error.deps ?? []), ...fallbackDeps]),
        ];
      }
      parsedReason.evict = true;
      reason = JSON.stringify(parsedReason, null, 2);
    } else {
      reason = JSON.stringify(
        {
          type: 'instance-error',
          error: {
            status: 500,
            title: 'Render failed',
            message: reason || 'Render failed before model hook',
            additionalErrors: null,
            deps: fallbackDeps,
          },
          evict: true,
        },
        null,
        2,
      );
    }
    if (container) {
      container.dataset.prerenderStatus = 'unusable';
      if (params?.id) {
        container.dataset.prerenderId = this.#normalizeCardId(params.id);
      }
      if (params?.nonce) {
        container.dataset.prerenderNonce = params.nonce;
      }
    }
    if (errorElement) {
      if (params?.id) {
        errorElement.dataset.prerenderId = this.#normalizeCardId(params.id);
      }
      if (params?.nonce) {
        errorElement.dataset.prerenderNonce = params.nonce;
      }
      this.#writePrerenderError(errorElement, reason);
    }
  }

  #fallbackDepsFromTransitionParams(
    params?:
      | {
          id?: string;
        }
      | undefined,
  ): string[] {
    // When render fails before model() initializes, runtime dependency capture
    // has not started yet. Recover the requested card id from transition params
    // (or URL path as a last resort) so the error doc still carries enough deps
    // for downstream invalidation/error propagation.
    let id = params?.id;
    if (!id && typeof window !== 'undefined') {
      try {
        let path = window.location.pathname;
        let match = /\/render\/([^/]+)\//.exec(path);
        if (match?.[1]) {
          id = decodeURIComponent(match[1]);
        }
      } catch (_err) {
        // best effort only
      }
    }
    return this.#fallbackDepsFromIds([id]);
  }

  #transitionCardId(transition?: Transition): string | undefined {
    let current: Transition['to'] | null = transition?.to;
    let id: string | undefined;
    do {
      id = current?.params?.id as string | undefined;
      if (!id) {
        current = current?.parent;
      }
    } while (current && !id);
    return id;
  }

  #fallbackDepsFromIds(ids: (string | undefined)[]): string[] {
    // Seed dependency ids in every shape we might see in index/module rows:
    // original id, normalized card id, and `.json` variants. This keeps error
    // propagation resilient when callers provide extensionless ids while index
    // entries are stored with concrete instance urls.
    let deps = new Set<string>();
    for (let id of ids) {
      if (!id) {
        continue;
      }
      deps.add(id);
      let normalized = this.#normalizeCardId(id);
      deps.add(normalized);
      if (!id.endsWith('.json')) {
        deps.add(`${id}.json`);
      }
      if (!normalized.endsWith('.json')) {
        deps.add(`${normalized}.json`);
      }
    }
    return [...deps];
  }
}

function nowMs(): number {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
  ) {
    return performance.now();
  }
  return Date.now();
}

function formatMs(value: number): string {
  return value.toFixed(SETTLE_LOG_PRECISION);
}
