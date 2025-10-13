import { action } from '@ember/object';
import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { join } from '@ember/runloop';
import { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  formattedError,
  CardError,
  SupportedMimeType,
  isCardError,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RenderError,
  parseRenderRouteOptions,
  serializeRenderRouteOptions,
} from '@cardstack/runtime-common';
import { serializableError } from '@cardstack/runtime-common/error';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  windowErrorHandler,
  errorJsonApiToErrorEntry,
} from '../lib/window-error-handler';

import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type RenderErrorStateService from '../services/render-error-state';
import type StoreService from '../services/store';

export type Model = { instance: CardDef; ready: boolean; nonce: string };

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare renderErrorState: RenderErrorStateService;

  private currentTransition: Transition | undefined;
  private lastStoreResetKey: string | undefined;
  private renderBaseParams: [string, string, string] | undefined;
  private lastSerializedError: string | undefined;

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
    (globalThis as any)._lazilyLoadLinks = undefined;
    (globalThis as any)._boxelRenderContext = undefined;
  };

  activate() {
    window.addEventListener('error', this.errorHandler);
    window.addEventListener('unhandledrejection', this.errorHandler);
    // this is for route errors, not window level error
    window.addEventListener('boxel-render-error', this.handleRenderError);
  }

  deactivate() {
    (globalThis as any)._lazilyLoadLinks = undefined;
    (globalThis as any)._boxelRenderContext = undefined;
    (globalThis as any).__renderInstance = undefined;
    window.removeEventListener('error', this.errorHandler);
    window.removeEventListener('unhandledrejection', this.errorHandler);
    window.removeEventListener('boxel-render-error', this.handleRenderError);
    this.lastStoreResetKey = undefined;
    this.renderBaseParams = undefined;
    this.lastSerializedError = undefined;
    this.renderErrorState.clear();
  }

  beforeModel() {
    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__lazilyLoadLinks = true;
    (globalThis as any).__boxelRenderContext = true;
  }

  async model(
    { id, nonce, options }: { id: string; nonce: string; options?: string },
    transition: Transition,
  ) {
    this.lastSerializedError = undefined;
    this.renderErrorState.clear();
    this.currentTransition = transition;
    let parsedOptions = parseRenderRouteOptions(options);
    let canonicalOptions = serializeRenderRouteOptions(parsedOptions);
    this.#setupTransitionHelper(id, nonce, canonicalOptions);

    // Opt in to reading the in-progress index, as opposed to the last completed
    // index. This matters for any related cards that we will be loading, not
    // for our own card, which we're going to load directly from source.
    let shouldResetLoader = parsedOptions.includesCodeChange === true;
    if (shouldResetLoader) {
      this.loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'render-route includesCodeChange',
      });
    }
    this.loaderService.setIsIndexing(true);
    if (parsedOptions.resetStore === true) {
      let resetKey = `${id}:${nonce}`;
      if (this.lastStoreResetKey !== resetKey) {
        this.store.resetCache();
        this.lastStoreResetKey = resetKey;
      }
    }
    // This is for host tests
    (globalThis as any).__renderInstance = undefined;

    let response = await this.network.authedFetch(id, {
      method: 'GET',
      headers: {
        Accept: SupportedMimeType.CardSource,
      },
    });

    let realmURL = response.headers.get('x-boxel-realm-url')!;
    let lastModified = new Date(response.headers.get('last-modified')!);
    let doc: LooseSingleCardDocument | CardErrorsJSONAPI =
      await response.json();
    let instance: CardDef | undefined;
    if ('errors' in doc) {
      throw new Error(JSON.stringify(doc.errors[0], null, 2));
    } else {
      await this.realm.ensureRealmMeta(realmURL);

      let enhancedDoc: LooseSingleCardDocument = {
        ...doc,
        data: {
          ...doc.data,
          id: id.replace(/\.json$/, ''),
          type: 'card',
          meta: {
            ...doc.data.meta,
            lastModified: lastModified.getTime(),
            realmURL,
            realmInfo: { ...this.realm.info(id) },
          },
        },
      };

      instance = await this.store.add(enhancedDoc, {
        relativeTo: new URL(id),
        realm: realmURL,
        doNotPersist: true,
      });
    }

    let state = new TrackedMap();
    state.set('ready', false);
    await this.store.loaded();
    state.set('ready', true);

    // this is to support in-browser rendering, where we actually don't have the
    // ability to lookup the parent route using RouterService.recognizeAndLoad()
    (globalThis as any).__renderInstance = instance;
    this.currentTransition = undefined;
    return {
      instance,
      nonce,
      get ready(): boolean {
        return Boolean(state.get('ready'));
      },
    };
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
    this.currentTransition?.abort();
    let serializedError: string;
    try {
      let cardError: CardError = JSON.parse(error.message);
      serializedError = JSON.stringify(
        {
          type: 'error',
          error: cardError,
        } as RenderError,
        null,
        2,
      );
    } catch (e) {
      let current: Transition['to'] | null = transition?.to;
      let id: string | undefined;
      do {
        id = current?.params?.id as string | undefined;
        if (!id) {
          current = current?.parent;
        }
      } while (current && !id);
      if (isCardError(error)) {
        // Preserve full CardError details including deps for prerender indexing
        serializedError = JSON.stringify(
          { type: 'error', error: serializableError(error) },
          null,
          2,
        );
      } else {
        let errorJSONAPI = formattedError(id, error).errors[0];
        let errorPayload = errorJsonApiToErrorEntry(errorJSONAPI);
        serializedError = JSON.stringify(errorPayload, null, 2);
      }
    }
    if (serializedError === this.lastSerializedError) {
      return;
    }
    this.lastSerializedError = serializedError;
    // Store the serialized error so the child render.error route can read it
    // even though this transition abort prevents its usual model hook from
    // running.
    this.renderErrorState.setReason(serializedError);
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
  };
}
