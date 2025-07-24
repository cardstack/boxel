import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

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

export type Model = CardDef;

export default class RenderRoute extends Route<Model> {
  @service declare store: StoreService;
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;
  @service declare private network: NetworkService;

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

    let localId = await this.store.create(enhancedDoc);
    if (typeof localId !== 'string') {
      throw new Error('todo: failed to instantiate');
    }
    let instance = await this.store.get(localId);
    if (!isCardInstance(instance)) {
      throw new Error('todo: failed to load');
    }
    return instance;
  }
}
