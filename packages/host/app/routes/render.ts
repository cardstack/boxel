import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { TrackedMap } from 'tracked-built-ins';

import {
  isCardInstance,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';

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

  errorHandler = (event: Event) => {
    let element: HTMLElement = document.querySelector('[data-prerender]')!;
    element.innerHTML = `
      it broke
    `;
    element.dataset.prerenderStatus = 'error';

    event.preventDefault();
  };

  activate() {
    window.addEventListener('error', this.errorHandler);
    window.addEventListener('unhandledrejection', this.errorHandler);
  }

  deactivate() {
    window.removeEventListener('error', this.errorHandler);
    window.removeEventListener('unhandledrejection', this.errorHandler);
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
    let doc: LooseSingleCardDocument = await response.json();

    await this.realm.ensureRealmMeta(realmURL);

    let enhancedDoc: LooseSingleCardDocument = {
      ...doc,
      data: {
        ...doc.data,
        id,
        type: 'card',
        meta: {
          ...doc.data.meta,
          lastModified: lastModified.getTime(),
          realmURL,
          realmInfo: { ...this.realm.info(id) },
        },
      },
    };

    // We are fetching links so deeply that it seems very unlikely that we'll
    // ever have an unloaded link after awaiting the store.add
    let instance = await this.store.add(enhancedDoc, {
      relativeTo: new URL(id),
      doNotPersist: true,
    });
    if (!isCardInstance(instance)) {
      throw new Error('todo: failed to load');
    }

    // todo: Placeholder for checking in-flight loads
    let state = new TrackedMap();
    state.set('ready', false);
    Promise.resolve().then(() => {
      state.set('ready', true);
    });

    return {
      instance,
      get ready(): boolean {
        return Boolean(state.get('ready'));
      },
    };
  }
}
