import { action } from '@ember/object';
import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  formattedError,
  isCardErrorJSONAPI,
  isCardError,
  CardError,
  type CardErrorsJSONAPI,
  type CardErrorJSONAPI,
  type LooseSingleCardDocument,
  type RenderError,
  type ErrorEntry,
} from '@cardstack/runtime-common';
import { serializableError } from '@cardstack/runtime-common/error';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import EmberHealthService from '../services/ember-health';
import LoaderService from '../services/loader-service';
import NetworkService from '../services/network';
import RealmService from '../services/realm';
import RealmServerService from '../services/realm-server';
import StoreService from '../services/store';

export type Model = { instance: CardDef; ready: boolean };

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare private network: NetworkService;
  @service declare emberHealth: EmberHealthService;

  errorHandler = (event: Event) => {
    let [_a, _b, encodedId] = (this.router.currentURL ?? '').split('/');
    let id = encodedId ? decodeURIComponent(encodedId) : undefined;
    let reason =
      'reason' in event
        ? (event as any).reason
        : (event as CustomEvent).detail?.reason;
    // Coerce stringified JSON into objects so our type guards work
    if (typeof reason === 'string') {
      try {
        reason = JSON.parse(reason);
      } catch (_e) {
        // leave as string
      }
    }
    let element: HTMLElement = document.querySelector('[data-prerender]')!;
    let errorPayload: RenderError;
    if (reason) {
      if (isCardError(reason)) {
        errorPayload = {
          type: 'error',
          error: { ...reason, stack: reason.stack },
        };
      } else if (isCardErrorJSONAPI(reason)) {
        errorPayload = errorJsonApiToErrorEntry({ ...reason });
      } else if (
        typeof reason === 'object' &&
        reason !== null &&
        'errors' in (reason as any) &&
        Array.isArray((reason as any).errors) &&
        (reason as any).errors.length > 0
      ) {
        errorPayload = errorJsonApiToErrorEntry({
          ...(reason as any).errors[0],
          id,
        });
      } else {
        errorPayload = {
          type: 'error',
          error:
            reason instanceof CardError
              ? { ...serializableError(reason) }
              : {
                  id,
                  message: reason.message,
                  stack: reason.stack,
                  status: 500,
                },
        };
      }
    } else {
      errorPayload = {
        type: 'error',
        error: new CardError('indexing failed', { status: 500, id }),
      };
    }
    element.innerHTML = `${JSON.stringify(errorPayload)}`;
    // Defer setting prerender status until we know Ember health
    void this.emberHealth
      .isResponsive()
      .then((alive) => {
        element.dataset.emberAlive = alive ? 'true' : 'false';
        element.dataset.prerenderStatus = alive ? 'error' : 'unusable';
      })
      .catch(() => {
        element.dataset.emberAlive = 'false';
        element.dataset.prerenderStatus = 'unusable';
      });

    event.preventDefault?.();
    (globalThis as any)._lazilyLoadLinks = undefined;
    (globalThis as any)._boxelRenderContext = undefined;
  };

  activate() {
    window.addEventListener('error', this.errorHandler);
    window.addEventListener('unhandledrejection', this.errorHandler);
    window.addEventListener('boxel-render-error', this.errorHandler);
  }

  deactivate() {
    (globalThis as any)._lazilyLoadLinks = undefined;
    (globalThis as any)._boxelRenderContext = undefined;
    (globalThis as any).__renderInstance = undefined;
    window.removeEventListener('error', this.errorHandler);
    window.removeEventListener('unhandledrejection', this.errorHandler);
    window.removeEventListener('boxel-render-error', this.errorHandler);
  }

  beforeModel() {
    // activate() doesn't run early enough for this to be set before the model()
    // hook is run
    (globalThis as any).__lazilyLoadLinks = true;
    (globalThis as any).__boxelRenderContext = true;
  }

  async model({ id }: { id: string }) {
    // Make it easy for Puppeteer to do regular Ember transitions
    (globalThis as any).boxelTransitionTo = (
      ...args: Parameters<RouterService['transitionTo']>
    ) => {
      this.router.transitionTo(...args);
    };

    // Opt in to reading the in-progress index, as opposed to the last completed
    // index. This matters for any related cards that we will be loading, not
    // for our own card, which we're going to load directly from source.
    this.loaderService.setIsIndexing(true);

    let response = await this.network.authedFetch(id, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.card+source',
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
    return {
      instance,
      get ready(): boolean {
        return Boolean(state.get('ready'));
      },
    };
  }

  @action
  error(error: any, transition: Transition) {
    transition.abort();
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
      let errorJSONAPI = formattedError(id, error).errors[0];
      let errorPayload = errorJsonApiToErrorEntry(errorJSONAPI);
      serializedError = JSON.stringify(errorPayload, null, 2);
    }
    this.router.transitionTo('render-error', serializedError);
    return false;
  }
}

function errorJsonApiToErrorEntry(errorJSONAPI: CardErrorJSONAPI): ErrorEntry {
  let error = CardError.fromCardErrorJsonAPI(errorJSONAPI);
  return {
    type: 'error',
    error,
  };
}
