import type Controller from '@ember/controller';
import { action } from '@ember/object';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { join, scheduleOnce } from '@ember/runloop';
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
  type RenderError,
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
  logger as runtimeLogger,
} from '@cardstack/runtime-common';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { serializableError } from '@cardstack/runtime-common/error';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  windowErrorHandler,
  errorJsonApiToErrorEntry,
} from '../lib/window-error-handler';
import { createAuthErrorGuard } from '../utils/auth-error-guard';
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
    (globalThis as any).__renderModel = undefined;
    (globalThis as any).__docsInFlight = undefined;
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
    // this is a tool for our prerenderer to understand if a timed out render is salvageable
    (globalThis as any).__docsInFlight = () =>
      this.store.cardDocsInFlight.length +
      this.store.fileMetaDocsInFlight.length;
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
        resource.id ? new URL(resource.id) : undefined,
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
                realmURL,
                realmInfo: { ...this.realm.info(id) },
              },
            },
          };

          let hydratedInstance = await this.store.add(enhancedDoc, {
            relativeTo: cardIdToURL(id),
            realm: realmURL,
            doNotPersist: true,
          });
          if (hydratedInstance) {
            await this.#touchIsUsedFields(hydratedInstance);
          }
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
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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
  }

  async #waitForRenderLoadStability(cardId: string): Promise<void> {
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
  #setupTransitionHelper(id: string, nonce: string, options: string) {
    let baseParams: [string, string, string] = [id, nonce, options];
    this.renderBaseParams = baseParams;
    (globalThis as any).boxelTransitionTo = (
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
    this.#applyErrorMetadata(context);
    this.#transitionToErrorRoute(transition);
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
    return JSON.stringify(
      this.#stripLastKnownGoodHtml(withRuntimeDeps),
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

  #applyErrorMetadata(context: { cardId?: string; nonce?: string }) {
    if (typeof document === 'undefined') {
      return;
    }
    let container = document.querySelector(
      '[data-prerender]',
    ) as HTMLElement | null;
    if (container) {
      container.dataset.prerenderStatus = 'error';
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
