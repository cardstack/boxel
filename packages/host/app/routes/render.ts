import { action } from '@ember/object';
import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  formattedError,
  CardError,
  SupportedMimeType,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RenderError,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  renderErrorHandler,
  errorJsonApiToErrorEntry,
} from '../lib/render-error-handler';

import type EmberHealthService from '../services/ember-health';
import type LoaderService from '../services/loader-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

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
    renderErrorHandler({
      event,
      setPrerenderStatus(status) {
        let element: HTMLElement = document.querySelector('[data-prerender]')!;
        element.dataset.prerenderStatus = status;
      },
      setError(error) {
        let element: HTMLElement = document.querySelector('[data-prerender]')!;
        element.innerHTML = error;
      },
      healthCheck: this.emberHealth.isResponsive,
      currentURL: this.router.currentURL,
    });
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

  async model({ id, nonce: _nonce }: { id: string; nonce: string }) {
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
