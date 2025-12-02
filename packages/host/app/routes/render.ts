import type Controller from '@ember/controller';
import { action } from '@ember/object';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { join, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import { TrackedMap } from 'tracked-built-ins';

import {
  formattedError,
  baseRealm,
  SupportedMimeType,
  isCardError,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RenderError,
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
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
} from '../utils/render-timer-stub';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RenderErrorStateService from '../services/render-error-state';
import type RenderStoreService from '../services/render-store';

type RenderStatus = 'loading' | 'ready' | 'error' | 'unusable';

export type Model = {
  instance: CardDef;
  nonce: string;
  cardId: string;
  readonly status: RenderStatus;
  readonly ready: boolean;
  readyPromise: Promise<void>;
};

type ModelState = {
  state: TrackedMap<string, unknown>;
  readyDeferred: Deferred<void>;
  isReady: boolean;
};

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
  #cardTypeTracker = new RenderCardTypeTracker();
  #modelStates = new Map<Model, ModelState>();
  #pendingReadyModels = new Set<Model>();
  #modelPromises = new Map<string, Promise<Model>>();
  #authGuard = createAuthErrorGuard();
  #restoreRenderTimers: (() => void) | undefined;
  #releaseTimerBlock: (() => void) | undefined;

  errorHandler = (event: Event) => {
    windowErrorHandler({
      event,
      setStatusToUnusable() {
        let element: HTMLElement = document.querySelector('[data-prerender]')!;
        element.dataset.prerenderStatus = 'unusable';
      },
      setError(error) {
        let element: HTMLElement = document.querySelector('[data-prerender]')!;
        element.innerHTML = error;
      },
      currentURL: this.router.currentURL,
    });
    this.#setAllModelStatuses('unusable');
    // Only unset lazilyLoadLinks if we last set it
    if ((globalThis as any).__lazilyLoadLinksOwner === 'render') {
      (globalThis as any).__lazilyLoadLinks = undefined;
      (globalThis as any).__lazilyLoadLinksOwner = undefined;
    }
    (globalThis as any).__boxelRenderContext = undefined;
  };

  activate() {
    window.addEventListener('error', this.errorHandler);
    window.addEventListener('unhandledrejection', this.errorHandler);
    // this is for route errors, not window level error
    window.addEventListener('boxel-render-error', this.handleRenderError);
  }

  deactivate() {
    // Only unset lazilyLoadLinks if we last set it
    if ((globalThis as any).__lazilyLoadLinksOwner === 'render') {
      (globalThis as any).__lazilyLoadLinks = undefined;
      (globalThis as any).__lazilyLoadLinksOwner = undefined;
    }
    (globalThis as any).__boxelRenderContext = undefined;
    (globalThis as any).__renderInstance = undefined;
    window.removeEventListener('error', this.errorHandler);
    window.removeEventListener('unhandledrejection', this.errorHandler);
    window.removeEventListener('boxel-render-error', this.handleRenderError);
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
  }

  async beforeModel(transition: Transition) {
    await super.beforeModel?.(transition);
    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__lazilyLoadLinks = true;
    (globalThis as any).__lazilyLoadLinksOwner = 'render';
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
    (globalThis as any).__docsInFlight = () => this.store.docsInFlight.length;
    let key = `${id}|${nonce}|${canonicalOptions}`;
    let existing = this.#modelPromises.get(key);
    if (existing) {
      return await existing;
    }

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
    // This is for host tests
    (globalThis as any).__renderInstance = undefined;

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
      let derivedCardType = await this.#authGuard.race(() =>
        deriveCardTypeFromDoc(doc, id, this.loaderService.loader),
      );
      this.#cardTypeTracker.set(
        { cardId: canonicalId, nonce },
        derivedCardType,
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

      instance = await this.#authGuard.race(() =>
        this.store.add(enhancedDoc, {
          relativeTo: new URL(id),
          realm: realmURL,
          doNotPersist: true,
        }),
      );
      model.instance = instance;
    } catch (e: any) {
      console.warn(
        `Encountered error when deserializing doc for ${id}: ${e.message}: ${e.responseText}`,
      );
      this.#dispositionModel(model, 'error');
      throw e;
    }
    if (instance) {
      await this.#authGuard.race(() => this.#touchIsUsedFields(instance));
    }
    await this.#authGuard.race(() => this.store.loaded());
    if (instance) {
      model.instance = instance;
    }
    this.#scheduleReady(model);

    // this is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    (globalThis as any).__renderInstance = instance;
    this.currentTransition = undefined;
    return model;
  }

  async #touchIsUsedFields(instance: CardDef): Promise<void> {
    let cardApi = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    // a computed linksTo/linksToMany isn't a thing yet, but some day it
    // probably will be, so just optimistically including those
    let fields = cardApi.getFields(instance, { includeComputeds: true });
    for (let [fieldName, field] of Object.entries(fields)) {
      if (field?.isUsed) {
        try {
          // accessing the field triggers the lazy loading of the linked field
          (instance as any)[fieldName];
        } catch (error) {
          console.warn(
            `Failed to touch field '${fieldName}' on ${instance.constructor.name} for isUsed=true:`,
            error,
          );
        }
      }
    }
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
    this.#pendingReadyModels.add(model);
    scheduleOnce('afterRender', this, this.#processPendingReadyModels);
  }

  #processPendingReadyModels() {
    if (this.isDestroying || this.isDestroyed) {
      this.#pendingReadyModels.clear();
      return;
    }
    for (let model of this.#pendingReadyModels) {
      void this.#settleModelAfterRender(model).catch((error) => {
        this.#dispositionModel(model, 'error');
        this.handleRenderError(error);
      });
    }
    this.#pendingReadyModels.clear();
  }

  async #settleModelAfterRender(model: Model): Promise<void> {
    let modelState = this.#modelStates.get(model);
    if (!modelState || modelState.isReady) {
      return;
    }
    await this.#authGuard.race(() => this.store.loaded());
    modelState.state.set('status', 'ready');
    modelState.isReady = true;
    modelState.readyDeferred.fulfill();
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
      let withType = withCardType(normalized, cardType);
      return JSON.stringify(this.#stripLastKnownGoodHtml(withType), null, 2);
    }
    let current: Transition['to'] | null = transition?.to;
    let id: string | undefined;
    do {
      id = current?.params?.id as string | undefined;
      if (!id) {
        current = current?.parent;
      }
    } while (current && !id);
    if (isCardError(error)) {
      let normalized = normalizeRenderError(
        {
          type: 'error',
          error: serializableError(error),
        },
        normalizationContext,
      );
      let withType = withCardType(normalized, cardType);
      return JSON.stringify(this.#stripLastKnownGoodHtml(withType), null, 2);
    }
    let errorJSONAPI = formattedError(id, error).errors[0];
    let errorPayload = normalizeRenderError(
      errorJsonApiToErrorEntry(errorJSONAPI) as RenderError,
      normalizationContext,
    );
    return JSON.stringify(
      this.#stripLastKnownGoodHtml(
        withCardType(errorPayload as RenderError, cardType),
      ),
      null,
      2,
    );
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
    if (transition) {
      this.intermediateTransitionTo('render.error');
    } else {
      join(() => this.router.transitionTo('render.error'));
    }
  }
}
